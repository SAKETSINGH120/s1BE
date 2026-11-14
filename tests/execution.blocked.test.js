import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { signUp } from './helpers.js';
import { startTargetServer } from './targetServer.js';

// Uses the default configuration, where private networks are blocked.
const app = createApp();

let target;
let user;

beforeAll(async () => {
  target = await startTargetServer();
});
afterAll(() => target.close());
beforeEach(async () => {
  user = await signUp(app);
});

function execute(body) {
  return user.agent.post(user.url('/execute')).send({ method: 'GET', ...body });
}

describe('execution SSRF protection (default policy)', () => {
  it.each([
    ['loopback IP', () => target.url('/echo')],
    ['localhost name', () => `http://localhost:${target.port}/echo`],
    ['decimal loopback', () => `http://2130706433:${target.port}/echo`],
    ['IPv6 loopback', () => `http://[::1]:${target.port}/echo`],
    ['cloud metadata', () => 'http://169.254.169.254/latest/meta-data/'],
    ['unspecified address', () => `http://0.0.0.0:${target.port}/echo`],
  ])('blocks %s', async (label, buildUrl) => {
    const res = await execute({ url: buildUrl() });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('DESTINATION_BLOCKED');
  });

  it('rejects unsupported protocols', async () => {
    const res = await execute({ url: 'file:///etc/passwd' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UNSUPPORTED_PROTOCOL');
  });

  it('resolves variables before checking the destination', async () => {
    await user.agent
      .post(user.url('/environments'))
      .send({ name: 'Sneaky', variables: [{ key: 'host', value: '127.0.0.1' }] })
      .then((res) =>
        user.agent.patch(user.url()).send({ activeEnvironmentId: res.body.environment.id }),
      );

    const res = await execute({ url: `http://{{host}}:${target.port}/echo` });

    expect(res.body.error.code).toBe('DESTINATION_BLOCKED');
  });

  it('requires authentication and workspace ownership', async () => {
    const other = await signUp(app);
    const res = await other.agent
      .post(user.url('/execute'))
      .send({ method: 'GET', url: 'https://example.com' });

    expect(res.status).toBe(404);
  });
});
