import { env } from '../config/env.js';
import { RequestHistory } from '../models/requestHistory.model.js';
import { findInWorkspace } from './workspace.service.js';

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'x-api-key',
  'x-auth-token',
]);
const AUTH_SECRET_FIELDS = ['token', 'password', 'value'];
const REDACTED = '[redacted]';
const VARIABLE_ONLY = /^\s*\{\{[\w.-]+\}\}\s*$/;

// A value that is only a {{variable}} reference is kept: the secret itself lives in the environment.
function redact(value) {
  return value && !VARIABLE_ONLY.test(value) ? REDACTED : value;
}

function redactSecrets(entry) {
  const headers = entry.headers?.map((header) =>
    SENSITIVE_HEADERS.has(header.key.trim().toLowerCase())
      ? { ...header, value: redact(header.value) }
      : header,
  );

  const auth = entry.auth && { ...entry.auth };
  for (const field of AUTH_SECRET_FIELDS) {
    if (auth?.[field]) auth[field] = redact(auth[field]);
  }

  return { ...entry, headers, auth };
}

async function pruneHistory(workspaceId) {
  const overflow = await RequestHistory.find({ workspaceId })
    .sort({ createdAt: -1, _id: -1 })
    .skip(env.HISTORY_MAX_ENTRIES)
    .select('_id');

  if (overflow.length) {
    await RequestHistory.deleteMany({ _id: { $in: overflow.map((entry) => entry._id) } });
  }
}

export function listHistory(workspace) {
  return RequestHistory.find({ workspaceId: workspace._id })
    .sort({ createdAt: -1, _id: -1 })
    .limit(env.HISTORY_MAX_ENTRIES);
}

export async function recordHistory(workspace, entry) {
  const historyEntry = await RequestHistory.create({
    ...redactSecrets(entry),
    workspaceId: workspace._id,
  });
  await pruneHistory(workspace._id);
  return historyEntry;
}

export async function deleteHistoryEntry(workspace, entryId) {
  const entry = await findInWorkspace(RequestHistory, workspace._id, entryId, 'History entry');
  await entry.deleteOne();
}

export async function clearHistory(workspace) {
  await RequestHistory.deleteMany({ workspaceId: workspace._id });
}
