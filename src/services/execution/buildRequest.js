import crypto from 'node:crypto';
import { AppError } from '../../utils/AppError.js';
import { resolveDynamicVariable } from './dynamicVariables.js';
import { parseTargetUrl } from './networkPolicy.js';

// {{name}} for environment variables, {{$name}} for built-in dynamic values.
const VARIABLE_PATTERN = /\{\{\s*(\$?[\w.-]+)\s*\}\}/g;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const INVALID_HEADER_VALUE = /[\r\n\0]/;

// Managed by the HTTP client or meaningless for a single proxied request.
const DROPPED_HEADERS = new Set([
  'host',
  'content-length',
  'connection',
  'keep-alive',
  'proxy-connection',
  'proxy-authorization',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
  'expect',
]);

const DEFAULT_HEADERS = [
  ['User-Agent', 'Relay/1.0'],
  ['Accept', '*/*'],
  ['Accept-Encoding', 'gzip, deflate, br'],
];

export function createResolver(variables) {
  const unresolved = new Set();
  const resolve = (text = '') =>
    text.replace(VARIABLE_PATTERN, (match, name) => {
      const value = name.startsWith('$') ? resolveDynamicVariable(name) : variables.get(name);
      if (value !== undefined) return value;
      unresolved.add(name);
      return match;
    });
  return { resolve, unresolved };
}

const enabledPairs = (pairs = []) => pairs.filter((pair) => pair.enabled !== false && pair.key);

class HeaderList {
  constructor() {
    this.entries = [];
  }

  has(name) {
    const lower = name.toLowerCase();
    return this.entries.some(([key]) => key.toLowerCase() === lower);
  }

  add(name, value) {
    const trimmedName = name.trim();
    if (DROPPED_HEADERS.has(trimmedName.toLowerCase())) return;
    if (!HEADER_NAME.test(trimmedName)) {
      throw new AppError(400, `Invalid header name: "${trimmedName}"`, { code: 'INVALID_HEADER' });
    }
    if (INVALID_HEADER_VALUE.test(value)) {
      throw new AppError(400, `Header "${trimmedName}" contains invalid characters`, {
        code: 'INVALID_HEADER',
      });
    }
    this.entries.push([trimmedName, value]);
  }

  set(name, value) {
    const lower = name.toLowerCase();
    this.entries = this.entries.filter(([key]) => key.toLowerCase() !== lower);
    this.add(name, value);
  }

  setDefault(name, value) {
    if (!this.has(name)) this.add(name, value);
  }
}

function withDefaultScheme(url) {
  return /^[a-z][a-z\d+.-]*:\/\//i.test(url) ? url : `https://${url}`;
}

// Returns the lower-cased names of headers it set, so they can be dropped on cross-origin redirects.
function applyAuth(auth, { headers, url, resolve }) {
  switch (auth?.type) {
    case 'bearer':
      headers.set('Authorization', `Bearer ${resolve(auth.token)}`);
      return ['authorization'];
    case 'basic': {
      const credentials = `${resolve(auth.username)}:${resolve(auth.password)}`;
      headers.set('Authorization', `Basic ${Buffer.from(credentials, 'utf8').toString('base64')}`);
      return ['authorization'];
    }
    case 'apikey': {
      const key = resolve(auth.key).trim();
      if (!key) return [];
      if (auth.addTo === 'query') {
        url.searchParams.set(key, resolve(auth.value));
        return [];
      }
      headers.set(key, resolve(auth.value));
      return [key.toLowerCase()];
    }
    default:
      return [];
  }
}

// Field names follow the HTML multipart encoding rules for quotes and line breaks.
function encodeFieldName(name) {
  return name.replace(/"/g, '%22').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

function buildMultipart(fields) {
  const boundary = `----RelayFormBoundary${crypto.randomBytes(12).toString('hex')}`;
  const parts = fields.map(
    ([name, value]) =>
      `--${boundary}\r\nContent-Disposition: form-data; name="${encodeFieldName(name)}"\r\n\r\n${value}\r\n`,
  );
  return {
    body: Buffer.from(`${parts.join('')}--${boundary}--\r\n`, 'utf8'),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function buildBody(body, resolve) {
  const resolvePairs = (pairs) =>
    enabledPairs(pairs).map(({ key, value }) => [resolve(key), resolve(value)]);

  switch (body?.mode) {
    case 'json':
      return { body: Buffer.from(resolve(body.raw), 'utf8'), contentType: 'application/json' };
    case 'raw':
      return { body: Buffer.from(resolve(body.raw), 'utf8'), contentType: 'text/plain' };
    case 'urlencoded':
      return {
        body: Buffer.from(new URLSearchParams(resolvePairs(body.urlencoded)).toString(), 'utf8'),
        contentType: 'application/x-www-form-urlencoded',
      };
    case 'form-data':
      return buildMultipart(resolvePairs(body.formData));
    default:
      return { body: null, contentType: null };
  }
}

// Turns a stored request definition into a concrete HTTP request, resolving {{variables}}.
export function buildHttpRequest(spec, variables = new Map()) {
  const { resolve, unresolved } = createResolver(variables);

  const url = parseTargetUrl(withDefaultScheme(resolve(spec.url).trim()));
  for (const { key, value } of enabledPairs(spec.params)) {
    url.searchParams.append(resolve(key), resolve(value));
  }

  const headers = new HeaderList();
  for (const { key, value } of enabledPairs(spec.headers)) {
    headers.add(resolve(key), resolve(value));
  }
  const authHeaders = applyAuth(spec.auth, { headers, url, resolve });

  const { body, contentType } = buildBody(spec.body, resolve);
  // A multipart body is only valid with its own boundary, so it overrides any manual value.
  if (spec.body?.mode === 'form-data') headers.set('Content-Type', contentType);
  else if (contentType) headers.setDefault('Content-Type', contentType);
  for (const [name, value] of DEFAULT_HEADERS) headers.setDefault(name, value);

  return {
    method: spec.method,
    url,
    headers: headers.entries,
    authHeaders,
    body,
    unresolvedVariables: [...unresolved],
  };
}
