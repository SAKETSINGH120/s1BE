import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { MockRoute } from '../src/models/mockRoute.model.js';
import { matchMockPath, renderMockBody, takeRateLimit } from '../src/services/mock.service.js';
import { signUp } from './helpers.js';

const app = createApp();

let user;
let mockKey;
beforeEach(async () => {
  user = await signUp(app);
  ({ mockKey } = (await user.agent.get(user.url('/mocks'))).body);
});

const createMock = (body) => user.agent.post(user.url('/mocks')).send(body);
const callMock = (path) => request(app).get(`/api/v1/m/${mockKey}${path}`);

describe('mock management', () => {
  it('gives each workspace a stable, unguessable key', async () => {
    expect(mockKey).toMatch(/^[\w-]{16}$/);
    const again = await user.agent.get(user.url('/mocks'));
    expect(again.body).toEqual({ mockKey, mocks: [] });

    const other = await signUp(app);
    const otherKey = (await other.agent.get(other.url('/mocks'))).body.mockKey;
    expect(otherKey).not.toBe(mockKey);
  });

  it('creates, updates (merging chaos settings) and deletes mocks', async () => {
    const created = await createMock({
      method: 'POST',
      path: 'orders/',
      status: 201,
      body: '{"id":"ord_1"}',
      chaos: { delayMs: 100 },
    });
    expect(created.status).toBe(201);
    expect(created.body.mock).toMatchObject({
      method: 'POST',
      path: '/orders',
      status: 201,
      enabled: true,
      hits: 0,
      chaos: { delayMs: 100, failureRate: 0, failureStatus: 500, rateLimitPerMinute: 0 },
    });

    const mockUrl = user.url(`/mocks/${created.body.mock.id}`);
    const updated = await user.agent.patch(mockUrl).send({ chaos: { failureRate: 25 } });
    expect(updated.body.mock.chaos).toMatchObject({ delayMs: 100, failureRate: 25 });

    const duplicate = await createMock({ method: 'POST', path: '/orders' });
    expect(duplicate.status).toBe(409);

    expect((await user.agent.delete(mockUrl)).status).toBe(204);
    expect((await user.agent.get(user.url('/mocks'))).body.mocks).toEqual([]);
  });

  it('rejects reserved headers and invalid paths', async () => {
    const cookie = await createMock({ path: '/x', headers: [{ key: 'Set-Cookie', value: 'a=b' }] });
    expect(cookie.status).toBe(400);
    const csp = await createMock({
      path: '/x',
      headers: [{ key: 'content-security-policy', value: '' }],
    });
    expect(csp.status).toBe(400);
    expect((await createMock({ path: '/a b' })).status).toBe(400);
  });

  it('keeps mocks private to their workspace', async () => {
    const { body } = await createMock({ path: '/mine' });
    const other = await signUp(app);
    const res = await other.agent.patch(other.url(`/mocks/${body.mock.id}`)).send({ status: 500 });
    expect(res.status).toBe(404);
  });

  it('rotating the key retires the old URLs', async () => {
    await createMock({ path: '/ping', body: 'pong' });
    const rotated = await user.agent.post(user.url('/mocks/rotate-key'));
    expect(rotated.body.mockKey).not.toBe(mockKey);

    expect((await callMock('/ping')).status).toBe(404);
    mockKey = rotated.body.mockKey;
    expect((await callMock('/ping')).text).toBe('pong');
  });
});

describe('serving mocks', () => {
  it('answers with the status, headers and templated body, behind safe headers', async () => {
    await createMock({
      path: '/users/:id',
      status: 200,
      headers: [{ key: 'X-Source', value: 'mock' }],
      body: '{"id":"{{params.id}}","page":"{{query.page}}","trace":"{{$uuid}}"}',
    });

    const res = await callMock('/users/42?page=3').set('Origin', 'https://my-frontend.example');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.headers['x-source']).toBe('mock');
    expect(res.headers['content-security-policy']).toBe("sandbox; default-src 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.body).toMatchObject({ id: '42', page: '3' });
    expect(res.body.trace).toMatch(/^[\da-f-]{36}$/);

    const [stored] = await MockRoute.find({ path: '/users/:id' });
    await expect.poll(async () => (await MockRoute.findById(stored._id)).hits).toBe(1);
  });

  it('prefers exact paths over :params and ignores disabled mocks', async () => {
    await createMock({ path: '/orders/:id', body: 'by id' });
    const latest = await createMock({ path: '/orders/latest', body: 'latest' });

    expect((await callMock('/orders/latest')).text).toBe('latest');
    expect((await callMock('/orders/7')).text).toBe('by id');

    await user.agent.patch(user.url(`/mocks/${latest.body.mock.id}`)).send({ enabled: false });
    expect((await callMock('/orders/latest')).text).toBe('by id');
  });

  it('returns 404 for unknown paths, methods and keys', async () => {
    await createMock({ path: '/only-get' });
    expect((await callMock('/missing')).status).toBe(404);
    expect((await request(app).post(`/api/v1/m/${mockKey}/only-get`)).status).toBe(404);
    expect((await request(app).get('/api/v1/m/not-a-real-key/only-get')).status).toBe(404);
  });

  it('answers CORS preflights from any origin', async () => {
    const res = await request(app)
      .options(`/api/v1/m/${mockKey}/anything`)
      .set('Origin', 'https://my-frontend.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('simulates failures and delays', async () => {
    await createMock({
      path: '/flaky',
      body: 'ok',
      chaos: { failureRate: 100, failureStatus: 503 },
    });
    const failed = await callMock('/flaky');
    expect(failed.status).toBe(503);
    expect(failed.body.error.message).toMatch(/Simulated failure/);

    await createMock({ path: '/slow', body: 'ok', chaos: { delayMs: 300 } });
    const started = Date.now();
    expect((await callMock('/slow')).text).toBe('ok');
    expect(Date.now() - started).toBeGreaterThanOrEqual(280);
  });

  it('simulates a rate limit with Retry-After', async () => {
    await createMock({ path: '/limited', body: 'ok', chaos: { rateLimitPerMinute: 2 } });
    expect((await callMock('/limited')).status).toBe(200);
    expect((await callMock('/limited')).status).toBe(200);
    const limited = await callMock('/limited');
    expect(limited.status).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  });
});

describe('mock helpers', () => {
  it('matches paths with params', () => {
    expect(matchMockPath('/users/:id/posts/:postId', '/users/7/posts/a%20b')).toEqual({
      id: '7',
      postId: 'a b',
    });
    expect(matchMockPath('/users/:id', '/users')).toBeNull();
    expect(matchMockPath('/', '/')).toEqual({});
  });

  it('leaves unknown template values untouched', () => {
    expect(
      renderMockBody('{{params.missing}} {{$nope}} {{query.q}}', {
        params: {},
        query: { q: 'hi' },
      }),
    ).toBe('{{params.missing}} {{$nope}} hi');
  });

  it('resets the simulated rate-limit window after a minute', () => {
    const mock = { _id: 'window-test', chaos: { rateLimitPerMinute: 1 } };
    expect(takeRateLimit(mock, 0)).toBe(0);
    expect(takeRateLimit(mock, 30_000)).toBe(30);
    expect(takeRateLimit(mock, 60_000)).toBe(0);
  });
});
