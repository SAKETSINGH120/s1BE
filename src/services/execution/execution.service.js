import { env } from '../../config/env.js';
import { getVariablesForExecution, saveCapturedVariables } from '../environment.service.js';
import { recordHistory } from '../history.service.js';
import { buildHttpRequest, createResolver } from './buildRequest.js';
import { sendHttpRequest } from './httpClient.js';
import { createResponseContext, evaluateAssertions, extractCaptures } from './responseChecks.js';

const TEXT_CONTENT_TYPE =
  /^(text\/|application\/([\w.+-]+\+)?(json|xml|javascript|ecmascript|x-www-form-urlencoded|graphql|yaml|x-yaml|csv|x-ndjson)\b)/i;

function findHeader(headers, name) {
  const lower = name.toLowerCase();
  return headers.find(([key]) => key.toLowerCase() === lower)?.[1];
}

function looksLikeText(buffer) {
  const sample = buffer.subarray(0, 1024);
  if (sample.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(sample);
    return true;
  } catch {
    // A multi-byte character cut at the sample boundary is not a reason to treat it as binary.
    return sample.length === 1024;
  }
}

function encodeBody(body, contentType) {
  const isText = contentType ? TEXT_CONTENT_TYPE.test(contentType) : looksLikeText(body);
  return isText
    ? { body: body.toString('utf8'), bodyEncoding: 'utf8' }
    : { body: body.toString('base64'), bodyEncoding: 'base64' };
}

function headersSize(headers) {
  return headers.reduce((total, [name, value]) => total + name.length + value.length + 4, 0);
}

function formatResponse(result, unresolvedVariables) {
  const contentType = findHeader(result.headers, 'content-type') ?? null;
  return {
    status: result.status,
    statusText: result.statusText,
    headers: result.headers,
    contentType,
    ...encodeBody(result.body, contentType),
    sizeBytes: result.body.length,
    headersSizeBytes: headersSize(result.headers),
    truncated: result.truncated,
    timeMs: result.timeMs,
    redirects: result.redirects,
    unresolvedVariables,
  };
}

// History stores the unresolved definition, so secrets from environments are never persisted there.
async function saveToHistory(workspace, spec, response) {
  try {
    await recordHistory(workspace, { ...spec, response });
  } catch (error) {
    console.error('Failed to record request history', error);
  }
}

export async function executeRequest(workspace, input, { signal } = {}) {
  const { environmentId, followRedirects = true, ...spec } = input;
  const activeEnvironmentId =
    environmentId === undefined ? workspace.activeEnvironmentId : environmentId;

  const variables = await getVariablesForExecution(workspace, activeEnvironmentId);
  const prepared = buildHttpRequest(spec, variables);

  try {
    const result = await sendHttpRequest(prepared, {
      timeoutMs: env.EXECUTION_TIMEOUT_MS,
      maxResponseBytes: env.EXECUTION_MAX_RESPONSE_BYTES,
      maxRedirects: env.EXECUTION_MAX_REDIRECTS,
      allowPrivateNetworks: env.EXECUTION_ALLOW_PRIVATE_NETWORKS,
      followRedirects,
      signal,
    });

    await saveToHistory(workspace, spec, {
      status: result.status,
      timeMs: result.timeMs,
      sizeBytes: result.body.length,
    });

    const response = formatResponse(result, prepared.unresolvedVariables);
    const checks = await runResponseChecks(workspace, spec, response, {
      variables,
      environmentId: activeEnvironmentId,
    });
    return { ...response, ...checks };
  } catch (error) {
    await saveToHistory(workspace, spec, { error: error.message });
    throw error;
  }
}

/**
 * Evaluates assertions and stores captured values in the environment. Captured values are never
 * returned: the response only says which variables were saved, so a captured token stays on the
 * server like any other environment value.
 */
async function runResponseChecks(workspace, spec, response, { variables, environmentId }) {
  const context = createResponseContext({
    status: response.status,
    timeMs: response.timeMs,
    headers: response.headers,
    bodyEncoding: response.bodyEncoding,
    bodyText: response.body,
  });
  const { resolve } = createResolver(variables);
  const tests = evaluateAssertions(spec.assertions, context, resolve);

  const extracted = extractCaptures(spec.captures, context);
  const found = extracted.filter((capture) => capture.value !== undefined);
  let saved = new Set();
  if (found.length && environmentId) {
    saved = new Set(await saveCapturedVariables(workspace, environmentId, found));
  }

  const captures = extracted.map(({ variable, error }) => {
    if (error) return { variable, saved: false, message: error };
    if (!environmentId) return { variable, saved: false, message: 'No active environment' };
    return { variable, saved: saved.has(variable) };
  });

  return { tests, captures };
}
