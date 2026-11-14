import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { Folder } from '../src/models/folder.model.js';
import { SavedRequest } from '../src/models/savedRequest.model.js';
import { signUp } from './helpers.js';

const app = createApp();

let user;
let collectionId;

async function createFolder(name, parentId, targetCollectionId = collectionId) {
  const res = await user.agent
    .post(user.url('/folders'))
    .send({ name, collectionId: targetCollectionId, parentId });
  return res.body.folder;
}

async function createRequest(fields) {
  const res = await user.agent.post(user.url('/requests')).send({ collectionId, ...fields });
  return res;
}

beforeEach(async () => {
  user = await signUp(app);
  const res = await user.agent.post(user.url('/collections')).send({ name: 'Orders API' });
  collectionId = res.body.collection.id;
});

describe('collections', () => {
  it('lists, renames and validates collections', async () => {
    await user.agent.post(user.url('/collections')).send({ name: 'Billing' });

    const list = await user.agent.get(user.url('/collections'));
    expect(list.body.collections.map((collection) => collection.name)).toEqual([
      'Billing',
      'Orders API',
    ]);

    const renamed = await user.agent
      .patch(user.url(`/collections/${collectionId}`))
      .send({ name: 'Orders v2', description: 'Order endpoints' });
    expect(renamed.body.collection).toMatchObject({
      name: 'Orders v2',
      description: 'Order endpoints',
    });

    const invalid = await user.agent.post(user.url('/collections')).send({ name: '   ' });
    expect(invalid.status).toBe(400);
  });

  it('returns the folder tree and request summaries', async () => {
    const parent = await createFolder('Orders');
    const child = await createFolder('Refunds', parent.id);
    await createRequest({ name: 'List orders', folderId: parent.id, url: 'https://x.test/orders' });
    await createRequest({ name: 'Ping', url: 'https://x.test/ping' });

    const res = await user.agent.get(user.url(`/collections/${collectionId}`));

    expect(res.status).toBe(200);
    expect(res.body.collection.id).toBe(collectionId);
    expect(res.body.folders.find((folder) => folder.id === child.id).parentId).toBe(parent.id);
    expect(res.body.requests).toHaveLength(2);
    expect(res.body.requests[0]).not.toHaveProperty('headers');
  });

  it('deletes folders and requests with the collection', async () => {
    const folder = await createFolder('Orders');
    await createRequest({ name: 'In folder', folderId: folder.id });

    const res = await user.agent.delete(user.url(`/collections/${collectionId}`));

    expect(res.status).toBe(204);
    expect(await Folder.countDocuments({ collectionId })).toBe(0);
    expect(await SavedRequest.countDocuments({ collectionId })).toBe(0);
  });
});

describe('folders', () => {
  it('supports nesting and returns a folder with its direct children', async () => {
    const root = await createFolder('v1');
    const nested = await createFolder('users', root.id);
    const deeper = await createFolder('admin', nested.id);

    const res = await user.agent.get(user.url(`/folders/${root.id}`));

    expect(res.body.folder.id).toBe(root.id);
    expect(res.body.folders.map((folder) => folder.id)).toEqual([nested.id]);
    expect(deeper.parentId).toBe(nested.id);
  });

  it('moves a folder and prevents cycles', async () => {
    const a = await createFolder('a');
    const b = await createFolder('b', a.id);
    const c = await createFolder('c');

    const moved = await user.agent.patch(user.url(`/folders/${c.id}`)).send({ parentId: b.id });
    expect(moved.body.folder.parentId).toBe(b.id);

    const intoSelf = await user.agent.patch(user.url(`/folders/${a.id}`)).send({ parentId: a.id });
    const intoChild = await user.agent.patch(user.url(`/folders/${a.id}`)).send({ parentId: c.id });
    expect(intoSelf.status).toBe(400);
    expect(intoChild.status).toBe(400);

    const toRoot = await user.agent.patch(user.url(`/folders/${c.id}`)).send({ parentId: null });
    expect(toRoot.body.folder.parentId).toBeNull();
  });

  it('rejects a parent from another collection', async () => {
    const other = await user.agent.post(user.url('/collections')).send({ name: 'Other' });
    const foreignFolder = await createFolder('foreign', undefined, other.body.collection.id);

    const res = await user.agent
      .post(user.url('/folders'))
      .send({ name: 'x', collectionId, parentId: foreignFolder.id });

    expect(res.status).toBe(400);
  });

  it('deletes nested subfolders and their requests', async () => {
    const root = await createFolder('root');
    const nested = await createFolder('nested', root.id);
    const deep = await createFolder('deep', nested.id);
    await createRequest({ name: 'deep request', folderId: deep.id });
    const survivor = await createRequest({ name: 'root request' });

    expect((await user.agent.delete(user.url(`/folders/${root.id}`))).status).toBe(204);

    expect(await Folder.countDocuments({ collectionId })).toBe(0);
    const remaining = await SavedRequest.find({ collectionId });
    expect(remaining.map((request) => request.id)).toEqual([survivor.body.request.id]);
  });
});

describe('saved requests', () => {
  it('saves a request with defaults and returns full details', async () => {
    const created = await createRequest({ name: 'Get user' });
    expect(created.status).toBe(201);
    expect(created.body.request).toMatchObject({
      method: 'GET',
      url: '',
      params: [],
      auth: { type: 'none' },
      body: { mode: 'none' },
      folderId: null,
    });

    const fetched = await user.agent.get(user.url(`/requests/${created.body.request.id}`));
    expect(fetched.body.request.name).toBe('Get user');
  });

  it('updates request details and keeps only fields of the chosen auth type', async () => {
    const created = await createRequest({
      name: 'Create order',
      auth: { type: 'bearer', token: '{{token}}' },
    });
    const requestUrl = user.url(`/requests/${created.body.request.id}`);

    const updated = await user.agent.patch(requestUrl).send({
      method: 'POST',
      url: 'https://api.example.com/orders',
      headers: [{ key: 'X-Trace', value: '1' }],
      body: { mode: 'json', raw: '{"qty":1}' },
      auth: { type: 'basic', username: 'ada', password: 'secret' },
    });

    expect(updated.status).toBe(200);
    expect(updated.body.request).toMatchObject({
      method: 'POST',
      headers: [{ key: 'X-Trace', value: '1', enabled: true }],
      body: { mode: 'json', raw: '{"qty":1}' },
      auth: { type: 'basic', username: 'ada' },
    });
    expect(updated.body.request.auth.token).toBeUndefined();
  });

  it('rejects invalid request definitions', async () => {
    const badMethod = await createRequest({ name: 'x', method: 'TRACE' });
    const badAuth = await createRequest({ name: 'x', auth: { type: 'apikey', key: 'k' } });

    expect(badMethod.status).toBe(400);
    expect(badAuth.status).toBe(400);
  });

  it('moves requests between folders and collections', async () => {
    const folderA = await createFolder('A');
    const folderB = await createFolder('B');
    const created = await createRequest({ name: 'Movable', folderId: folderA.id });
    const requestUrl = user.url(`/requests/${created.body.request.id}`);

    const toB = await user.agent.patch(requestUrl).send({ folderId: folderB.id });
    expect(toB.body.request.folderId).toBe(folderB.id);

    const toRoot = await user.agent.patch(requestUrl).send({ folderId: null });
    expect(toRoot.body.request.folderId).toBeNull();

    const other = await user.agent.post(user.url('/collections')).send({ name: 'Other' });
    const otherCollectionId = other.body.collection.id;
    const toOtherCollection = await user.agent
      .patch(requestUrl)
      .send({ collectionId: otherCollectionId, folderId: folderA.id });
    expect(toOtherCollection.status).toBe(400);

    const moved = await user.agent.patch(requestUrl).send({ collectionId: otherCollectionId });
    expect(moved.body.request).toMatchObject({ collectionId: otherCollectionId, folderId: null });
  });

  it('lists request summaries and deletes a request', async () => {
    const created = await createRequest({ name: 'Temp' });

    const list = await user.agent.get(user.url('/requests'));
    expect(list.body.requests.map((request) => request.name)).toEqual(['Temp']);

    expect((await user.agent.delete(user.url(`/requests/${created.body.request.id}`))).status).toBe(
      204,
    );
    expect((await user.agent.get(user.url(`/requests/${created.body.request.id}`))).status).toBe(
      404,
    );
  });
});
