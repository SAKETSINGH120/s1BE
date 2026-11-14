import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { Environment } from '../src/models/environment.model.js';
import { decryptSecret } from '../src/utils/secretBox.js';
import { signUp } from './helpers.js';

const app = createApp();

let user;
beforeEach(async () => {
  user = await signUp(app);
});

async function createEnvironment(body) {
  return user.agent.post(user.url('/environments')).send(body);
}

describe('environments', () => {
  it('creates, lists, renames and deletes environments', async () => {
    const created = await createEnvironment({
      name: 'Staging',
      variables: [{ key: 'baseUrl', value: 'https://staging.example.com' }],
    });
    expect(created.status).toBe(201);
    const environmentUrl = user.url(`/environments/${created.body.environment.id}`);

    expect(created.body.environment.variables).toEqual([
      {
        key: 'baseUrl',
        value: 'https://staging.example.com',
        secret: false,
        enabled: true,
        hasValue: true,
      },
    ]);

    const renamed = await user.agent.patch(environmentUrl).send({ name: 'QA' });
    expect(renamed.body.environment.name).toBe('QA');

    const list = await user.agent.get(user.url('/environments'));
    expect(list.body.environments.map((environment) => environment.name)).toEqual(['QA']);

    expect((await user.agent.delete(environmentUrl)).status).toBe(204);
    expect((await user.agent.get(environmentUrl)).status).toBe(404);
  });

  it('never returns secret values', async () => {
    const created = await createEnvironment({
      name: 'Prod',
      variables: [{ key: 'apiKey', value: 'sk_live_123', secret: true }],
    });
    const fetched = await user.agent.get(user.url(`/environments/${created.body.environment.id}`));
    const listed = await user.agent.get(user.url('/environments'));

    for (const body of [created.body, fetched.body, listed.body]) {
      expect(JSON.stringify(body)).not.toContain('sk_live_123');
    }
    expect(fetched.body.environment.variables[0]).toMatchObject({
      key: 'apiKey',
      value: '',
      secret: true,
      hasValue: true,
    });
  });

  it('keeps stored values when an update omits them', async () => {
    const created = await createEnvironment({
      name: 'Prod',
      variables: [{ key: 'apiKey', value: 'sk_live_123', secret: true }],
    });
    const environmentId = created.body.environment.id;

    await user.agent.patch(user.url(`/environments/${environmentId}`)).send({
      variables: [
        { key: 'apiKey', secret: true },
        { key: 'region', value: 'eu' },
      ],
    });

    const stored = await Environment.findById(environmentId);
    // Secret values are encrypted at rest, so compare the decrypted value.
    expect(
      stored.variables.map(({ key, value }) => ({ key, value: decryptSecret(value) })),
    ).toEqual([
      { key: 'apiKey', value: 'sk_live_123' },
      { key: 'region', value: 'eu' },
    ]);
  });

  it('validates names and variables', async () => {
    await createEnvironment({ name: 'Prod' });

    const duplicateName = await createEnvironment({ name: 'Prod' });
    const duplicateKey = await createEnvironment({
      name: 'Dev',
      variables: [
        { key: 'a', value: '1' },
        { key: 'a', value: '2' },
      ],
    });
    const badKey = await createEnvironment({ name: 'Dev', variables: [{ key: 'has space' }] });

    expect(duplicateName.status).toBe(409);
    expect(duplicateKey.status).toBe(400);
    expect(badKey.status).toBe(400);
  });

  it('sets the active environment and clears it when that environment is deleted', async () => {
    const created = await createEnvironment({ name: 'Dev' });
    const environmentId = created.body.environment.id;

    const activated = await user.agent
      .patch(user.url())
      .send({ activeEnvironmentId: environmentId });
    expect(activated.body.workspace.activeEnvironmentId).toBe(environmentId);

    await user.agent.delete(user.url(`/environments/${environmentId}`));

    const workspace = await user.agent.get(user.url());
    expect(workspace.body.workspace.activeEnvironmentId).toBeNull();
  });
});

describe('secret protection on the server', () => {
  it('does not reveal a stored secret when it is un-marked without a new value', async () => {
    const created = await createEnvironment({
      name: 'Prod',
      variables: [{ key: 'apiKey', value: 'sk_live_123', secret: true }],
    });
    const environmentUrl = user.url(`/environments/${created.body.environment.id}`);

    const updated = await user.agent
      .patch(environmentUrl)
      .send({ variables: [{ key: 'apiKey', secret: false }] });

    expect(JSON.stringify(updated.body)).not.toContain('sk_live_123');
    const stored = await Environment.findById(created.body.environment.id);
    expect(stored.variables[0]).toMatchObject({ key: 'apiKey', value: '', secret: false });
  });
});
