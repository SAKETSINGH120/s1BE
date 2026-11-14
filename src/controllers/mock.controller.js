import { setTimeout as sleep } from 'node:timers/promises';
import * as mockService from '../services/mock.service.js';
import { isReservedMockHeader } from '../validators/mock.validators.js';

export async function listMocks(req, res) {
  const [mockKey, mocks] = await Promise.all([
    mockService.ensureMockKey(req.workspace),
    mockService.listMocks(req.workspace),
  ]);
  res.json({ mockKey, mocks });
}

export async function createMock(req, res) {
  const mock = await mockService.createMock(req.workspace, req.body);
  res.status(201).json({ mock });
}

export async function updateMock(req, res) {
  const mock = await mockService.updateMock(req.workspace, req.params.mockId, req.body);
  res.json({ mock });
}

export async function deleteMock(req, res) {
  await mockService.deleteMock(req.workspace, req.params.mockId);
  res.status(204).end();
}

export async function rotateMockKey(req, res) {
  res.json({ mockKey: await mockService.rotateMockKey(req.workspace) });
}

// Mocks are user-authored content served from the API's own domain. The sandbox CSP gives any
// document an opaque origin (scripts cannot reach the API or its cookies), and nosniff stops a
// JSON body from being read as HTML or script.
const SAFE_HEADERS = {
  'Content-Security-Policy': "sandbox; default-src 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'cross-origin',
  'Cache-Control': 'no-store',
  'X-Reqora-Mock': 'true',
};

function inferContentType(body) {
  try {
    JSON.parse(body);
    return 'application/json; charset=utf-8';
  } catch {
    return 'text/plain; charset=utf-8';
  }
}

function sendError(res, status, message, headers = {}) {
  res
    .status(status)
    .set({ ...headers, ...SAFE_HEADERS })
    .json({ error: { message } });
}

/** Public: answers any request under /api/v1/m/<mockKey>/... with the matching mock. */
export async function serveMock(req, res) {
  const { mockKey } = req.params;
  const path = req.path.slice(mockKey.length + 1) || '/';
  const match = await mockService.findMockForRequest(mockKey, req.method, path);
  if (!match) {
    sendError(res, 404, `No mock for ${req.method} ${path}`);
    return;
  }

  const { mock, params } = match;
  const retryAfter = mockService.takeRateLimit(mock);
  if (retryAfter) {
    sendError(res, 429, 'Rate limit exceeded (simulated by Reqora chaos mode)', {
      'Retry-After': String(retryAfter),
    });
    return;
  }

  mockService.recordMockHit(mock);
  const { delayMs, failureRate, failureStatus } = mock.chaos ?? {};
  if (delayMs) await sleep(delayMs);
  if (failureRate && Math.random() * 100 < failureRate) {
    sendError(res, failureStatus ?? 500, 'Simulated failure (Reqora chaos mode)');
    return;
  }

  const body = mockService.renderMockBody(mock.body, { params, query: req.query });
  const headers = Object.fromEntries(
    mock.headers
      .filter(({ key }) => !isReservedMockHeader(key))
      .map(({ key, value }) => [key, value]),
  );
  const hasContentType = Object.keys(headers).some((key) => key.toLowerCase() === 'content-type');
  if (!hasContentType) headers['Content-Type'] = inferContentType(body);

  res
    .status(mock.status)
    .set({ ...headers, ...SAFE_HEADERS })
    .send(body);
}
