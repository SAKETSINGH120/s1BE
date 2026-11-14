import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { Collection } from '../src/models/collection.model.js';
import { SavedRequest } from '../src/models/savedRequest.model.js';
import { User } from '../src/models/user.model.js';
import { Workspace } from '../src/models/workspace.model.js';
import { signUp } from './helpers.js';

const app = createApp();
const PASSWORD = 'password-123'; // used by signUp()

let user;
beforeEach(async () => {
  user = await signUp(app);
  const collection = await user.agent.post(user.url('/collections')).send({ name: 'Shop' });
  await user.agent.post(user.url('/requests')).send({
    name: 'List orders',
    collectionId: collection.body.collection.id,
    url: 'https://api.example.com/orders',
  });
  await user.agent.post(user.url('/environments')).send({
    name: 'Prod',
    variables: [
      { key: 'baseUrl', value: 'https://api.example.com' },
      { key: 'apiKey', value: 'sk_live_secret', secret: true },
    ],
  });
});

describe('GET /auth/export', () => {
  it('exports workspaces with collections, requests and environments', async () => {
    const res = await user.agent.get('/api/v1/auth/export');

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="relay-export-/);
    expect(res.body.format).toBe('relay-account-export@1');

    const [workspace] = res.body.workspaces;
    expect(workspace.collections[0]).toMatchObject({ name: 'Shop' });
    expect(workspace.collections[0].requests[0]).toMatchObject({ name: 'List orders' });
    expect(workspace.environments[0].variables).toEqual([
      { key: 'baseUrl', value: 'https://api.example.com', secret: false, enabled: true },
      { key: 'apiKey', value: null, secret: true, enabled: true },
    ]);
  });

  it('never includes secret values or password data', async () => {
    const res = await user.agent.get('/api/v1/auth/export');
    const text = JSON.stringify(res.body);

    expect(text).not.toContain('sk_live_secret');
    expect(text).not.toContain('passwordHash');
  });

  it('requires a session', async () => {
    expect((await request(app).get('/api/v1/auth/export')).status).toBe(401);
  });
});

describe('DELETE /auth/account', () => {
  it('refuses a wrong password', async () => {
    const res = await user.agent
      .delete('/api/v1/auth/account')
      .send({ password: 'wrong-password' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PASSWORD');
    expect((await user.agent.get('/api/v1/auth/me')).status).toBe(200);
  });

  it("deletes the user and all of their data, but nobody else's", async () => {
    const other = await signUp(app);
    await other.agent.post(other.url('/collections')).send({ name: 'Other' });
    const me = await user.agent.get('/api/v1/auth/me');

    const res = await user.agent.delete('/api/v1/auth/account').send({ password: PASSWORD });

    expect(res.status).toBe(204);
    expect(await User.exists({ _id: me.body.user.id })).toBeNull();
    expect(await Workspace.countDocuments({ ownerId: me.body.user.id })).toBe(0);
    expect(await SavedRequest.countDocuments({ name: 'List orders' })).toBe(0);
    expect(await Collection.countDocuments({ name: 'Other' })).toBe(1);
    expect((await user.agent.get('/api/v1/auth/me')).status).toBe(401);
  });
});
