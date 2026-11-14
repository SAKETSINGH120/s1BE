import crypto from 'node:crypto';
import { MockRoute } from '../models/mockRoute.model.js';
import { Workspace } from '../models/workspace.model.js';
import { AppError } from '../utils/AppError.js';
import { resolveDynamicVariable } from './execution/dynamicVariables.js';
import { findInWorkspace } from './workspace.service.js';

export const MAX_MOCKS_PER_WORKSPACE = 200;

// 16 URL-safe characters (96 random bits): mocks are public, so the key is what keeps them private.
const newMockKey = () => crypto.randomBytes(12).toString('base64url');

export async function ensureMockKey(workspace) {
  if (workspace.mockKey) return workspace.mockKey;
  workspace.mockKey = newMockKey();
  await workspace.save();
  return workspace.mockKey;
}

// A new key invalidates every URL that used the old one, e.g. after a URL was shared too widely.
export async function rotateMockKey(workspace) {
  workspace.mockKey = newMockKey();
  await workspace.save();
  return workspace.mockKey;
}

export function listMocks(workspace) {
  return MockRoute.find({ workspaceId: workspace._id }).sort({ path: 1, method: 1 });
}

async function saveUnique(mock) {
  try {
    return await mock.save();
  } catch (error) {
    if (error?.code === 11000) {
      throw new AppError(409, `A ${mock.method} mock for ${mock.path} already exists`);
    }
    throw error;
  }
}

export async function createMock(workspace, fields) {
  const count = await MockRoute.countDocuments({ workspaceId: workspace._id });
  if (count >= MAX_MOCKS_PER_WORKSPACE) {
    throw new AppError(409, `A workspace can have up to ${MAX_MOCKS_PER_WORKSPACE} mocks`);
  }
  return saveUnique(new MockRoute({ ...fields, workspaceId: workspace._id }));
}

export async function updateMock(workspace, mockId, { chaos, ...fields }) {
  const mock = await findInWorkspace(MockRoute, workspace._id, mockId, 'Mock');
  mock.set(fields);
  if (chaos) mock.chaos = { ...mock.chaos.toObject(), ...chaos };
  return saveUnique(mock);
}

export async function deleteMock(workspace, mockId) {
  const mock = await findInWorkspace(MockRoute, workspace._id, mockId, 'Mock');
  await mock.deleteOne();
}

// Matches "/orders/42" against "/orders/:id" and returns { id: '42' }, or null.
export function matchMockPath(pattern, path) {
  const patternSegments = pattern.split('/').filter(Boolean);
  const pathSegments = path.split('/').filter(Boolean);
  if (patternSegments.length !== pathSegments.length) return null;

  const params = {};
  for (const [index, segment] of patternSegments.entries()) {
    if (segment.startsWith(':')) {
      try {
        params[segment.slice(1)] = decodeURIComponent(pathSegments[index]);
      } catch {
        return null;
      }
    } else if (segment !== pathSegments[index]) {
      return null;
    }
  }
  return params;
}

const paramCount = (path) => path.split('/').filter((segment) => segment.startsWith(':')).length;

/** The enabled mock answering `method path` for a mock key: { mock, params } or null. */
export async function findMockForRequest(mockKey, method, path) {
  const workspace = await Workspace.findOne({ mockKey }).select('_id');
  if (!workspace) return null;

  const mocks = await MockRoute.find({
    workspaceId: workspace._id,
    method: method === 'HEAD' ? 'GET' : method,
    enabled: true,
  });
  // The most specific route wins: "/orders/latest" before "/orders/:id".
  mocks.sort((a, b) => paramCount(a.path) - paramCount(b.path));
  for (const mock of mocks) {
    const params = matchMockPath(mock.path, path);
    if (params) return { mock, params };
  }
  return null;
}

const TEMPLATE = /\{\{\s*(\$[\w]+|params\.[\w]+|query\.[\w]+)\s*\}\}/g;

// Fills {{params.id}}, {{query.page}} and {{$uuid}}-style dynamic values; unknown ones stay as typed.
export function renderMockBody(body, { params, query }) {
  return body.replace(TEMPLATE, (match, name) => {
    if (name.startsWith('$')) return resolveDynamicVariable(name) ?? match;
    const [scope, key] = name.split('.');
    const source = scope === 'params' ? params : query;
    const value = Object.hasOwn(source, key) ? source[key] : undefined;
    return typeof value === 'string' ? value : match;
  });
}

// Per-mock request counts for the simulated rate limit. In memory: with several server instances
// each one counts separately, which is acceptable for a simulation.
const rateWindows = new Map();

/** Returns the seconds until the window resets when this request is over the limit, else 0. */
export function takeRateLimit(mock, now = Date.now()) {
  const limit = mock.chaos?.rateLimitPerMinute ?? 0;
  if (!limit) return 0;
  const id = String(mock._id);
  const window = rateWindows.get(id);
  if (!window || now - window.start >= 60_000) {
    rateWindows.set(id, { start: now, count: 1 });
    return 0;
  }
  window.count += 1;
  return window.count > limit ? Math.ceil((window.start + 60_000 - now) / 1000) : 0;
}

export function recordMockHit(mock) {
  MockRoute.updateOne({ _id: mock._id }, { $inc: { hits: 1 }, $set: { lastHitAt: new Date() } })
    .exec()
    .catch(() => {});
}
