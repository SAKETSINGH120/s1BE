import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { Environment } from '../src/models/environment.model.js';
import { decryptSecret } from '../src/utils/secretBox.js';
import { signUp } from './helpers.js';
import { startTargetServer } from './targetServer.js';

// The local target server is on loopback, so these tests use the self-hosting policy.
vi.mock('../src/config/env.js', async (importOriginal) => {
  const { env } = await importOriginal();
  return { env: { ...env, EXECUTION_ALLOW_PRIVATE_NETWORKS: true, EXECUTION_TIMEOUT_MS: 2000 } };
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

async function activateEnvironment(variables = []) {
  const created = await user.agent.post(user.url('/environments')).send({ name: 'Dev', variables });
  await user.agent.patch(user.url()).send({ activeEnvironmentId: created.body.environment.id });
  return created.body.environment.id;
}

function execute(body) {
  return user.agent
    .post(user.url('/execute'))
    .send({ method: 'GET', url: target.url('/echo'), ...body });
}

describe('captures', () => {
  it('saves captured values into the active environment without returning them', async () => {
    const environmentId = await activateEnvironment([
      { key: 'secretMethod', value: 'old', secret: true },
    ]);

    const res = await execute({
      method: 'DELETE',
      captures: [
        { variable: 'secretMethod', source: 'body', path: '$.method' },
        { variable: 'traceHost', source: 'body', path: '$.headers.host' },
        { variable: 'statusCode', source: 'status', path: '' },
        { variable: 'missing', source: 'body', path: '$.nope' },
      ],
    });

    expect(res.status).toBe(200);
    expect(res.body.response.captures).toEqual([
      { variable: 'secretMethod', saved: true },
      { variable: 'traceHost', saved: true },
      { variable: 'statusCode', saved: true },
      { variable: 'missing', saved: false, message: 'Not found in the response' },
    ]);

    const stored = await Environment.findById(environmentId);
    const byKey = Object.fromEntries(stored.variables.map((variable) => [variable.key, variable]));
    expect(byKey.secretMethod.secret).toBe(true);
    expect(decryptSecret(byKey.secretMethod.value)).toBe('DELETE'); // stored encrypted
    expect(byKey.traceHost.value).toBe(`127.0.0.1:${target.port}`);
    expect(byKey.statusCode).toMatchObject({ value: '200', secret: false, enabled: true });
  });

  it('feeds captured values into the next request', async () => {
    await activateEnvironment();

    await execute({
      method: 'PATCH',
      captures: [{ variable: 'chosenMethod', source: 'body', path: '$.method' }],
    });
    const next = await execute({ headers: [{ key: 'X-Previous', value: '{{chosenMethod}}' }] });

    expect(JSON.parse(next.body.response.body).headers['x-previous']).toBe('PATCH');
  });

  it('reports captures that cannot be saved without an active environment', async () => {
    const res = await execute({
      captures: [{ variable: 'method', source: 'body', path: '$.method' }],
    });

    expect(res.body.response.captures).toEqual([
      { variable: 'method', saved: false, message: 'No active environment' },
    ]);
  });
});

describe('assertions', () => {
  it('returns pass/fail results for each enabled assertion', async () => {
    await activateEnvironment([{ key: 'expectedMethod', value: 'GET' }]);

    const res = await execute({
      assertions: [
        { source: 'status', path: '', operator: 'equals', expected: '200' },
        { source: 'body', path: '$.method', operator: 'equals', expected: '{{expectedMethod}}' },
        { source: 'header', path: 'content-type', operator: 'contains', expected: 'json' },
        { source: 'time', path: '', operator: 'lessThan', expected: '5000' },
        { source: 'body', path: '$.missing', operator: 'exists' },
        { source: 'status', path: '', operator: 'equals', expected: '500', enabled: false },
      ],
    });

    expect(res.body.response.tests.map(({ passed }) => passed)).toEqual([
      true,
      true,
      true,
      true,
      false,
    ]);
    expect(res.body.response.tests[4]).toMatchObject({
      name: 'Body $.missing exists',
      message: 'Not found',
    });
  });

  it('rejects malformed assertions', async () => {
    const res = await execute({
      assertions: [{ source: 'status', path: '', operator: 'matchesRegex', expected: '.*' }],
    });

    expect(res.status).toBe(400);
  });

  it('saves captures and assertions with a request', async () => {
    const collection = await user.agent.post(user.url('/collections')).send({ name: 'Auth' });
    const created = await user.agent.post(user.url('/requests')).send({
      name: 'Login',
      collectionId: collection.body.collection.id,
      captures: [{ variable: 'token', source: 'body', path: '$.token' }],
      assertions: [{ source: 'status', path: '', operator: 'equals', expected: '200' }],
    });

    expect(created.body.request).toMatchObject({
      captures: [{ variable: 'token', source: 'body', path: '$.token', enabled: true }],
      assertions: [
        { source: 'status', path: '', operator: 'equals', expected: '200', enabled: true },
      ],
    });
  });
});
