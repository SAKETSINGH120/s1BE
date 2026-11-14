import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { Environment } from '../src/models/environment.model.js';
import { Folder } from '../src/models/folder.model.js';
import { SavedRequest } from '../src/models/savedRequest.model.js';
import { signUp } from './helpers.js';

const app = createApp();
const SCHEMA = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';

// Covers the main Postman features and the unsupported ones that must produce warnings.
const postmanCollection = {
  info: { name: 'Shop API', description: { content: 'Shop endpoints' }, schema: SCHEMA },
  auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] },
  variable: [
    { key: 'baseUrl', value: 'https://shop.example.com' },
    { key: 'bad key', value: 'skipped' },
  ],
  event: [{ listen: 'prerequest', script: { exec: ['console.log(1)'] } }],
  item: [
    {
      name: 'Orders',
      item: [
        {
          name: 'List orders',
          request: {
            method: 'GET',
            header: [
              { key: 'Accept', value: 'application/json' },
              { key: 'X-Debug', value: '1', disabled: true },
            ],
            url: {
              raw: '{{baseUrl}}/orders?page=1&size=20',
              host: ['{{baseUrl}}'],
              path: ['orders'],
              query: [
                { key: 'page', value: '1' },
                { key: 'size', value: '20', disabled: true },
              ],
            },
          },
        },
        {
          name: 'Admin',
          auth: {
            type: 'basic',
            basic: [
              { key: 'username', value: 'root' },
              { key: 'password', value: 'pw' },
            ],
          },
          item: [
            {
              name: 'Create order',
              request: {
                method: 'post',
                url: '{{baseUrl}}/orders',
                body: { mode: 'raw', raw: '{"qty":1}', options: { raw: { language: 'json' } } },
              },
            },
          ],
        },
      ],
    },
    {
      name: 'Upload avatar',
      request: {
        method: 'PUT',
        url: 'https://shop.example.com/avatar',
        auth: { type: 'noauth' },
        body: {
          mode: 'formdata',
          formdata: [
            { key: 'caption', value: 'me', type: 'text' },
            { key: 'file', src: '/tmp/a.png', type: 'file' },
          ],
        },
      },
    },
    {
      name: 'Login',
      request: {
        method: 'POST',
        url: 'https://shop.example.com/login',
        auth: { type: 'oauth2', oauth2: [] },
        body: { mode: 'urlencoded', urlencoded: [{ key: 'user', value: 'ada' }] },
      },
    },
    { name: 'Trace', request: { method: 'TRACE', url: 'https://shop.example.com' } },
    { name: 'Plain string request', request: 'https://shop.example.com/health' },
  ],
};

let user;
beforeEach(async () => {
  user = await signUp(app);
});

const importCollection = (body) => user.agent.post(user.url('/collections/import')).send(body);

describe('Postman import', () => {
  it('imports folders, requests, auth inheritance, bodies and collection variables', async () => {
    const res = await importCollection(postmanCollection);

    expect(res.status).toBe(201);
    expect(res.body.collection).toMatchObject({ name: 'Shop API', description: 'Shop endpoints' });
    expect(res.body.summary).toMatchObject({ folders: 2, requests: 5 });

    const collectionId = res.body.collection.id;
    const folders = await Folder.find({ collectionId });
    const orders = folders.find((folder) => folder.name === 'Orders');
    const admin = folders.find((folder) => folder.name === 'Admin');
    expect(admin.parentId.equals(orders._id)).toBe(true);

    const byName = Object.fromEntries(
      (await SavedRequest.find({ collectionId })).map((request) => [request.name, request]),
    );

    const list = byName['List orders'];
    expect(list.folderId.equals(orders._id)).toBe(true);
    expect(list.url).toBe('{{baseUrl}}/orders');
    expect(list.params.map(({ key, value, enabled }) => ({ key, value, enabled }))).toEqual([
      { key: 'page', value: '1', enabled: true },
      { key: 'size', value: '20', enabled: false },
    ]);
    expect(list.headers[1].enabled).toBe(false);
    expect(list.auth.toObject()).toMatchObject({ type: 'bearer', token: '{{token}}' });

    const create = byName['Create order'];
    expect(create.method).toBe('POST');
    expect(create.folderId.equals(admin._id)).toBe(true);
    expect(create.auth.toObject()).toMatchObject({
      type: 'basic',
      username: 'root',
      password: 'pw',
    });
    expect(create.body.toObject()).toMatchObject({ mode: 'json', raw: '{"qty":1}' });

    expect(byName['Upload avatar'].auth.type).toBe('none');
    expect(byName['Upload avatar'].body.formData.map(({ key }) => key)).toEqual(['caption']);
    expect(byName.Login.auth.type).toBe('none');
    expect(byName.Login.body.urlencoded[0].key).toBe('user');
    expect(byName['Plain string request'].url).toBe('https://shop.example.com/health');
    expect(byName.Trace).toBeUndefined();

    const environment = await Environment.findById(res.body.summary.environment.id);
    expect(environment.name).toBe('Shop API variables');
    expect(environment.variables.map(({ key }) => key)).toEqual(['baseUrl']);
  });

  it('reports every unsupported feature as a warning', async () => {
    const res = await importCollection(postmanCollection);

    expect(res.body.summary.warnings).toEqual(
      expect.arrayContaining([
        'Pre-request and test scripts are not supported and were ignored',
        'File fields in form-data bodies are not supported and were skipped',
        'Auth type "oauth2" is not supported and was replaced with No Auth',
        'Method TRACE is not supported; request "Trace" was skipped',
      ]),
    );
  });

  it('gives the variables environment a unique name on repeated imports', async () => {
    await importCollection(postmanCollection);
    const second = await importCollection(postmanCollection);

    expect(second.body.summary.environment.name).toBe('Shop API variables (2)');
  });

  it.each([
    [{ item: [] }, 'missing info'],
    [
      {
        info: { name: 'X', schema: 'https://schema.getpostman.com/json/collection/v1.0.0/' },
        item: [],
      },
      'v1 schema',
    ],
    [{ info: { name: 'X', schema: SCHEMA } }, 'missing items'],
    [[1, 2, 3], 'not an object'],
  ])('rejects invalid files (%#: %s)', async (body) => {
    const res = await importCollection(body);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_IMPORT');
  });

  it('accepts files larger than the default 1 MB body limit', async () => {
    const big = {
      info: { name: 'Big', schema: SCHEMA },
      item: [
        {
          name: 'Large body',
          request: {
            method: 'POST',
            url: 'https://x.test',
            body: { mode: 'raw', raw: 'x'.repeat(900_000) },
          },
        },
        {
          name: 'Another',
          request: {
            method: 'POST',
            url: 'https://x.test',
            body: { mode: 'raw', raw: 'y'.repeat(900_000) },
          },
        },
      ],
    };

    const res = await importCollection(big);

    expect(res.status).toBe(201);
    expect(res.body.summary.requests).toBe(2);
  });
});

describe('Postman export', () => {
  it('round-trips through import without losing structure or request details', async () => {
    const imported = await importCollection(postmanCollection);
    const exported = await user.agent.get(
      user.url(`/collections/${imported.body.collection.id}/export`),
    );

    expect(exported.status).toBe(200);
    expect(exported.body.info).toMatchObject({ name: 'Shop API', schema: SCHEMA });

    const orders = exported.body.item.find((item) => item.name === 'Orders');
    const list = orders.item.find((item) => item.name === 'List orders');
    expect(list.request.url).toEqual({
      raw: '{{baseUrl}}/orders?page=1',
      query: [
        { key: 'page', value: '1' },
        { key: 'size', value: '20', disabled: true },
      ],
    });
    expect(list.request.auth).toEqual({
      type: 'bearer',
      bearer: [{ key: 'token', value: '{{token}}', type: 'string' }],
    });

    const reimported = await importCollection(exported.body);
    expect(reimported.body.summary).toMatchObject({ folders: 2, requests: 5, warnings: [] });

    const original = await SavedRequest.find({ collectionId: imported.body.collection.id }).lean();
    const copy = await SavedRequest.find({ collectionId: reimported.body.collection.id }).lean();
    const comparable = ({ name, method, url, params, headers, auth, body }) => ({
      name,
      method,
      url,
      params,
      headers,
      auth,
      body,
    });
    const sortByName = (list) => list.map(comparable).sort((a, b) => a.name.localeCompare(b.name));
    expect(sortByName(copy)).toEqual(sortByName(original));
  });

  it("cannot export another user's collection", async () => {
    const imported = await importCollection(postmanCollection);
    const intruder = await signUp(app);

    const res = await intruder.agent.get(
      intruder.url(`/collections/${imported.body.collection.id}/export`),
    );

    expect(res.status).toBe(404);
  });
});

describe('Postman import hardening', () => {
  it('skips malformed entries instead of failing with a server error', async () => {
    const res = await importCollection({
      info: { name: 'Malformed', schema: SCHEMA },
      variable: [null, { key: 'a', value: '1' }, { key: 'a', value: '2' }],
      item: [
        null,
        { name: 'Null URL', request: { method: 'GET', url: null } },
        { name: 'Null request', request: null },
        {
          name: 'Null entries',
          request: {
            method: 'POST',
            url: 'https://x.test',
            auth: { type: 'bearer', bearer: [null] },
            body: { mode: 'formdata', formdata: [null, { key: 'k', value: 'v', type: 'text' }] },
            header: [null],
          },
        },
      ],
    });

    expect(res.status).toBe(201);
    expect(res.body.summary.requests).toBe(2);
    const environment = await Environment.findById(res.body.summary.environment.id);
    expect(environment.variables.map(({ key, value }) => ({ key, value }))).toEqual([
      { key: 'a', value: '1' },
    ]);
  });

  it('requires a session before parsing a large import body', async () => {
    const res = await request(app)
      .post(user.url('/collections/import'))
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ padding: 'x'.repeat(2 * 1024 * 1024) }));

    expect(res.status).toBe(401);
  });
});
