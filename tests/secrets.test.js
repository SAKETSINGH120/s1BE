import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { Environment } from '../src/models/environment.model.js';
import { buildHttpRequest } from '../src/services/execution/buildRequest.js';
import { decryptSecret, encryptSecret, isEncrypted } from '../src/utils/secretBox.js';
import { signUp } from './helpers.js';
import { startTargetServer } from './targetServer.js';

// The local target server is on loopback, so execution uses the self-hosting policy here.
vi.mock('../src/config/env.js', async (importOriginal) => {
  const { env } = await importOriginal();
  return { env: { ...env, EXECUTION_ALLOW_PRIVATE_NETWORKS: true } };
});

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

describe('secretBox', () => {
  it('round-trips and uses a fresh IV every time', () => {
    const first = encryptSecret('sk_live_123');
    const second = encryptSecret('sk_live_123');

    expect(isEncrypted(first)).toBe(true);
    expect(first).not.toBe(second);
    expect(first).not.toContain('sk_live_123');
    expect(decryptSecret(first)).toBe('sk_live_123');
  });

  it('detects tampering', () => {
    const encrypted = encryptSecret('value');
    const bytes = Buffer.from(encrypted.slice(3), 'base64');
    bytes[bytes.length - 1] ^= 1;

    expect(() => decryptSecret(`v1:${bytes.toString('base64')}`)).toThrow();
  });

  it('passes through values stored before encryption existed', () => {
    expect(decryptSecret('legacy-plain')).toBe('legacy-plain');
  });
});

describe('secret variables at rest', () => {
  async function createEnvironment(variables) {
    const res = await user.agent.post(user.url('/environments')).send({ name: 'Prod', variables });
    await user.agent.patch(user.url()).send({ activeEnvironmentId: res.body.environment.id });
    return res.body.environment.id;
  }

  it('stores secrets encrypted and plain variables as plain text', async () => {
    const id = await createEnvironment([
      { key: 'apiKey', value: 'sk_live_123', secret: true },
      { key: 'region', value: 'eu' },
    ]);

    const stored = await Environment.findById(id).lean();
    const [apiKey, region] = stored.variables;
    expect(isEncrypted(apiKey.value)).toBe(true);
    expect(JSON.stringify(stored)).not.toContain('sk_live_123');
    expect(region.value).toBe('eu');
  });

  it('still resolves encrypted secrets when a request runs', async () => {
    await createEnvironment([{ key: 'apiKey', value: 'sk_live_123', secret: true }]);

    const res = await user.agent.post(user.url('/execute')).send({
      method: 'GET',
      url: target.url('/echo'),
      headers: [{ key: 'X-Api-Key', value: '{{apiKey}}' }],
    });

    expect(JSON.parse(res.body.response.body).headers['x-api-key']).toBe('sk_live_123');
  });

  it('keeps an untouched secret encrypted (not double-encrypted) on update', async () => {
    const id = await createEnvironment([{ key: 'apiKey', value: 'sk_live_123', secret: true }]);
    const before = (await Environment.findById(id).lean()).variables[0].value;

    await user.agent
      .patch(user.url(`/environments/${id}`))
      .send({ name: 'Production', variables: [{ key: 'apiKey', secret: true }] });

    const after = (await Environment.findById(id).lean()).variables[0].value;
    expect(after).toBe(before);
    expect(decryptSecret(after)).toBe('sk_live_123');
  });

  it('encrypts secrets saved by captures', async () => {
    const id = await createEnvironment([{ key: 'method', value: 'old', secret: true }]);

    await user.agent.post(user.url('/execute')).send({
      method: 'PUT',
      url: target.url('/echo'),
      captures: [{ variable: 'method', source: 'body', path: '$.method' }],
    });

    const stored = (await Environment.findById(id).lean()).variables[0].value;
    expect(isEncrypted(stored)).toBe(true);
    expect(decryptSecret(stored)).toBe('PUT');
  });

  it('keeps working with secrets stored before encryption existed', async () => {
    const id = await createEnvironment([{ key: 'legacy', value: 'x', secret: true }]);
    // Simulate pre-encryption data written directly to the database.
    await Environment.updateOne({ _id: id }, { $set: { 'variables.0.value': 'plain-old-secret' } });

    const res = await user.agent.post(user.url('/execute')).send({
      method: 'GET',
      url: target.url('/echo'),
      headers: [{ key: 'X-Legacy', value: '{{legacy}}' }],
    });

    expect(JSON.parse(res.body.response.body).headers['x-legacy']).toBe('plain-old-secret');
  });
});

describe('dynamic variables', () => {
  it('generates fresh values for each occurrence', () => {
    const request = buildHttpRequest({
      method: 'POST',
      url: 'https://api.example.com/users',
      headers: [
        { key: 'X-Id-1', value: '{{$uuid}}' },
        { key: 'X-Id-2', value: '{{ $uuid }}' },
        { key: 'X-Time', value: '{{$timestamp}}' },
        { key: 'X-Unknown', value: '{{$notAThing}}' },
      ],
      body: { mode: 'json', raw: '{"email":"{{$randomEmail}}","n":{{$randomInt}}}' },
    });

    const header = (name) => request.headers.find(([key]) => key === name)[1];
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(header('X-Id-1')).toMatch(uuid);
    expect(header('X-Id-2')).toMatch(uuid);
    expect(header('X-Id-1')).not.toBe(header('X-Id-2'));
    expect(Math.abs(Number(header('X-Time')) - Date.now() / 1000)).toBeLessThan(5);
    expect(header('X-Unknown')).toBe('{{$notAThing}}');
    expect(request.unresolvedVariables).toEqual(['$notAThing']);

    const body = JSON.parse(request.body.toString());
    expect(body.email).toMatch(/^[a-z]+\.[a-z0-9]{6}@example\.com$/);
    expect(body.n).toBeGreaterThanOrEqual(0);
  });
});
