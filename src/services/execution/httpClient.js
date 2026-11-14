import http from 'node:http';
import https from 'node:https';
import { performance } from 'node:perf_hooks';
import { pipeline } from 'node:stream';
import zlib from 'node:zlib';
import { AppError } from '../../utils/AppError.js';
import { assertIpLiteralAllowed, createSafeLookup, parseTargetUrl } from './networkPolicy.js';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const CREDENTIAL_HEADERS = new Set(['authorization', 'cookie', 'proxy-authorization']);
const BODY_HEADERS = new Set(['content-type', 'content-length', 'content-encoding']);

const TLS_ERROR_CODES = new Set([
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

const executionError = (status, code, message) => new AppError(status, message, { code });

function toExecutionError(error, { timeoutMs, signal }) {
  if (error instanceof AppError) return error;
  if (signal.reason === 'timeout') {
    return executionError(504, 'TIMEOUT', `The request timed out after ${timeoutMs / 1000}s`);
  }
  if (signal.aborted) return executionError(499, 'CANCELLED', 'The request was cancelled');

  switch (error.code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return executionError(502, 'DNS_LOOKUP_FAILED', 'Could not resolve the host name');
    case 'ECONNREFUSED':
      return executionError(502, 'CONNECTION_REFUSED', 'The server refused the connection');
    case 'ECONNRESET':
    case 'EPIPE':
      return executionError(502, 'CONNECTION_RESET', 'The connection was closed unexpectedly');
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return executionError(502, 'HOST_UNREACHABLE', 'The host is unreachable');
    case 'ERR_INVALID_CHAR':
    case 'ERR_INVALID_HTTP_TOKEN':
      return executionError(400, 'INVALID_HEADER', 'A header contains invalid characters');
    default:
      break;
  }
  if (TLS_ERROR_CODES.has(error.code) || error.code?.startsWith('ERR_TLS')) {
    return executionError(502, 'TLS_ERROR', `TLS certificate problem (${error.code})`);
  }
  if (error.code === 'Z_DATA_ERROR' || error.code === 'ERR_BROTLI_DECOMPRESSION_FAILED') {
    return executionError(502, 'DECODE_FAILED', 'The response body could not be decompressed');
  }
  return executionError(502, 'REQUEST_FAILED', 'The request could not be completed');
}

function sendOnce({ method, url, headers, body }, { lookup, signal }) {
  const transport = url.protocol === 'https:' ? https : http;
  // With raw array headers Node does not add Host itself; user-supplied Host is never forwarded.
  const rawHeaders = ['Host', url.host, ...headers.flat()];
  if (body) rawHeaders.push('Content-Length', String(body.length));

  return new Promise((resolve, reject) => {
    // agent: false gives every request its own socket, so the safe lookup always runs.
    const request = transport.request(url, {
      method,
      headers: rawHeaders,
      lookup,
      signal,
      agent: false,
    });
    request.on('response', resolve);
    request.on('error', reject);
    request.end(body ?? undefined);
  });
}

function createDecoder(contentEncoding) {
  switch (contentEncoding?.trim().toLowerCase()) {
    case 'gzip':
    case 'x-gzip':
      return zlib.createGunzip();
    case 'deflate':
      return zlib.createInflate();
    case 'br':
      return zlib.createBrotliDecompress();
    default:
      return null;
  }
}

// pipeline() forwards errors and premature closes from the response into the decoder; a plain
// pipe() would leave the decoder waiting forever if the upstream connection is cut or aborted.
function decodedStream(response) {
  const decoder = createDecoder(response.headers['content-encoding']);
  if (!decoder) return response;
  pipeline(response, decoder, () => {}); // errors surface through the decoder's iterator
  return decoder;
}

// The limit applies to decompressed bytes so small compressed payloads cannot expand unbounded.
async function readBody(response, maxBytes, signal) {
  // Aborting (timeout or cancel) must end the read even while waiting for the next chunk.
  const abortRead = () => response.destroy(new Error('aborted'));
  if (signal.aborted) abortRead();
  signal.addEventListener('abort', abortRead, { once: true });

  try {
    return await collectBody(decodedStream(response), maxBytes, response);
  } finally {
    signal.removeEventListener('abort', abortRead);
  }
}

async function collectBody(stream, maxBytes, response) {
  const chunks = [];
  let size = 0;
  let truncated = false;

  for await (const chunk of stream) {
    const remaining = maxBytes - size;
    if (chunk.length > remaining) {
      chunks.push(chunk.subarray(0, remaining));
      truncated = true;
      break;
    }
    chunks.push(chunk);
    size += chunk.length;
  }

  if (truncated) response.destroy();
  return { body: Buffer.concat(chunks), truncated };
}

function resolveRedirectUrl(location, baseUrl) {
  let resolved;
  try {
    resolved = new URL(location, baseUrl).href;
  } catch {
    throw executionError(502, 'INVALID_REDIRECT', 'The server redirected to an invalid URL');
  }
  return parseTargetUrl(resolved);
}

function nextRedirectRequest(current, response, status) {
  const nextUrl = resolveRedirectUrl(response.headers.location, current.url);
  const changesToGet =
    status === 303 || ((status === 301 || status === 302) && current.method === 'POST');
  const isCrossOrigin = nextUrl.origin !== current.url.origin;
  // Standard credential headers plus whatever the auth settings added (e.g. an API key header).
  const credentialHeaders = new Set([...CREDENTIAL_HEADERS, ...(current.authHeaders ?? [])]);

  const headers = current.headers.filter(([name]) => {
    const lower = name.toLowerCase();
    if (isCrossOrigin && credentialHeaders.has(lower)) return false;
    if (changesToGet && BODY_HEADERS.has(lower)) return false;
    return true;
  });

  return {
    method: changesToGet && current.method !== 'HEAD' ? 'GET' : current.method,
    url: nextUrl,
    headers,
    authHeaders: current.authHeaders,
    body: changesToGet ? null : current.body,
  };
}

function headerPairs(rawHeaders) {
  const pairs = [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    pairs.push([rawHeaders[index], rawHeaders[index + 1]]);
  }
  return pairs;
}

/**
 * Sends a prepared request with SSRF checks on every hop, a total timeout covering all redirects,
 * and a cap on the decoded response size.
 */
export async function sendHttpRequest(request, options) {
  const { timeoutMs, maxResponseBytes, maxRedirects, followRedirects, allowPrivateNetworks } =
    options;
  const policy = { allowPrivateNetworks };
  const lookup = createSafeLookup(policy, options.resolve);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
  const onExternalAbort = () => controller.abort('cancelled');
  options.signal?.addEventListener('abort', onExternalAbort, { once: true });

  const startedAt = performance.now();
  const redirects = [];
  let current = request;

  try {
    for (;;) {
      assertIpLiteralAllowed(current.url, policy);
      const response = await sendOnce(current, { lookup, signal: controller.signal });
      const status = response.statusCode;

      if (followRedirects && REDIRECT_STATUSES.has(status) && response.headers.location) {
        response.resume();
        if (redirects.length >= maxRedirects) {
          throw executionError(
            502,
            'TOO_MANY_REDIRECTS',
            `Stopped after ${maxRedirects} redirects`,
          );
        }
        current = nextRedirectRequest(current, response, status);
        redirects.push({ status, url: current.url.href });
        continue;
      }

      const { body, truncated } =
        current.method === 'HEAD'
          ? { body: Buffer.alloc(0), truncated: false }
          : await readBody(response, maxResponseBytes, controller.signal);

      return {
        status,
        statusText: response.statusMessage ?? '',
        headers: headerPairs(response.rawHeaders),
        body,
        truncated,
        redirects,
        timeMs: Math.round(performance.now() - startedAt),
      };
    }
  } catch (error) {
    throw toExecutionError(error, { timeoutMs, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onExternalAbort);
  }
}
