import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { Collection } from '../src/models/collection.model.js';
import { signUp } from './helpers.js';

const app = createApp();

describe('workspaces', () => {
  let user;
  beforeEach(async () => {
    user = await signUp(app);
  });

  it('gives every new user a default workspace', async () => {
    const res = await user.agent.get('/api/v1/workspaces');

    expect(res.status).toBe(200);
    expect(res.body.workspaces).toHaveLength(1);
    expect(res.body.workspaces[0]).toMatchObject({
      name: 'My Workspace',
      activeEnvironmentId: null,
    });
    expect(res.body.workspaces[0]._id).toBeUndefined();
  });

  it('creates, renames and deletes a workspace with its contents', async () => {
    const created = await user.agent.post('/api/v1/workspaces').send({ name: 'Payments' });
    expect(created.status).toBe(201);
    const workspaceUrl = `/api/v1/workspaces/${created.body.workspace.id}`;

    const renamed = await user.agent.patch(workspaceUrl).send({ name: 'Payments API' });
    expect(renamed.body.workspace.name).toBe('Payments API');

    await user.agent.post(`${workspaceUrl}/collections`).send({ name: 'Orders' });
    expect(await Collection.countDocuments({ workspaceId: created.body.workspace.id })).toBe(1);

    expect((await user.agent.delete(workspaceUrl)).status).toBe(204);
    expect((await user.agent.get(workspaceUrl)).status).toBe(404);
    expect(await Collection.countDocuments({ workspaceId: created.body.workspace.id })).toBe(0);
  });

  it('refuses to delete the last workspace', async () => {
    const res = await user.agent.delete(user.url());

    expect(res.status).toBe(409);
  });

  it('requires authentication', async () => {
    expect((await request(app).get('/api/v1/workspaces')).status).toBe(401);
    expect((await request(app).get(user.url('/collections'))).status).toBe(401);
  });

  it('returns 404 for a malformed workspace id', async () => {
    const res = await user.agent.get('/api/v1/workspaces/not-an-id');

    expect(res.status).toBe(404);
  });
});

describe('cross-user isolation', () => {
  let owner;
  let intruder;
  let collectionId;
  let requestId;
  let environmentId;

  beforeEach(async () => {
    owner = await signUp(app);
    intruder = await signUp(app);

    const collection = await owner.agent.post(owner.url('/collections')).send({ name: 'Private' });
    collectionId = collection.body.collection.id;
    const saved = await owner.agent
      .post(owner.url('/requests'))
      .send({ name: 'Secret call', collectionId, url: 'https://api.example.com' });
    requestId = saved.body.request.id;
    const environment = await owner.agent
      .post(owner.url('/environments'))
      .send({ name: 'Prod', variables: [{ key: 'token', value: 'owner-only' }] });
    environmentId = environment.body.environment.id;
  });

  it("cannot read, change or delete another user's workspace", async () => {
    expect((await intruder.agent.get(owner.url())).status).toBe(404);
    expect((await intruder.agent.patch(owner.url()).send({ name: 'pwned' })).status).toBe(404);
    expect((await intruder.agent.delete(owner.url())).status).toBe(404);
    expect((await intruder.agent.get(owner.url('/collections'))).status).toBe(404);
    expect((await intruder.agent.get(owner.url('/history'))).status).toBe(404);
  });

  it("cannot reach another user's resources through their own workspace", async () => {
    const paths = [
      `/collections/${collectionId}`,
      `/requests/${requestId}`,
      `/environments/${environmentId}`,
    ];

    for (const path of paths) {
      expect((await intruder.agent.get(intruder.url(path))).status).toBe(404);
      expect((await intruder.agent.patch(intruder.url(path)).send({ name: 'x' })).status).toBe(404);
      expect((await intruder.agent.delete(intruder.url(path))).status).toBe(404);
    }

    expect((await owner.agent.get(owner.url(`/requests/${requestId}`))).status).toBe(200);
  });

  it("cannot attach resources to another user's collection or environment", async () => {
    const folder = await intruder.agent
      .post(intruder.url('/folders'))
      .send({ name: 'x', collectionId });
    const savedRequest = await intruder.agent
      .post(intruder.url('/requests'))
      .send({ name: 'x', collectionId });
    const activate = await intruder.agent
      .patch(intruder.url())
      .send({ activeEnvironmentId: environmentId });

    expect(folder.status).toBe(404);
    expect(savedRequest.status).toBe(404);
    expect(activate.status).toBe(404);
  });
});
