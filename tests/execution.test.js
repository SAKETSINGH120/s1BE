import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { RequestHistory } from '../src/models/requestHistory.model.js';
import { signUp } from './helpers.js';
import { BINARY_BYTES, startTargetServer } from './targetServer.js';

const { MAX_RESPONSE_BYTES } = vi.hoisted(() => ({ MAX_RESPONSE_BYTES: 64 * 1024 }));

// The local target server is on loopback, so these tests use the self-hosting policy.
// SSRF blocking under the default policy is covered in execution.blocked.test.js.
vi.mock('../src/config/env.js', async (importOriginal) => {
  const { env } = await importOriginal();
  return {
    env: {
      ...env,
      EXECUTION_ALLOW_PRIVATE_NETWORKS: true,
      EXECUTION_TIMEOUT_MS: 1000,
      EXECUTION_MAX_RESPONSE_BYTES: MAX_RESPONSE_BYTES,
      EXECUTION_MAX_REDIRECTS: 3,
    },
  };
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

function execute(body) {
  return user.agent.post(user.url('/execute')).send({ method: 'GET', ...body });
}

const echoed = (res) => JSON.parse(res.body.response.body);

async function activateEnvironment(variables) {
  const created = await user.agent
    .post(user.url('/environments'))
    .send({ name: `env-${Date.now()}`, variables });
  await user.agent.patch(user.url()).send({ activeEnvironmentId: created.body.environment.id });
  return created.body.environment.id;
}

describe('request building', () => {
  it('sends method, query params, headers and bearer auth', async () => {
    const res = await execute({
      method: 'DELETE',
      url: target.url('/echo?existing=1'),
      params: [
        { key: 'page', value: '2' },
        { key: 'skip', value: 'x', enabled: false },
      ],
      headers: [{ key: 'X-Trace', value: 'abc' }],
      auth: { type: 'bearer', token: 't0k3n' },
    });

    expect(res.status).toBe(200);
    expect(res.body.response).toMatchObject({
      status: 200,
      statusText: 'OK',
      bodyEncoding: 'utf8',
      contentType: 'application/json',
      truncated: false,
      redirects: [],
      unresolvedVariables: [],
    });
    expect(res.body.response.timeMs).toBeGreaterThanOrEqual(0);
    expect(res.body.response.sizeBytes).toBe(Buffer.byteLength(res.body.response.body));

    const request = echoed(res);
    expect(request.method).toBe('DELETE');
    expect(request.query).toEqual({ existing: '1', page: '2' });
    expect(request.headers['x-trace']).toBe('abc');
    expect(request.headers.authorization).toBe('Bearer t0k3n');
    expect(request.headers['user-agent']).toBe('Relay/1.0');
  });

  it('applies basic auth and API keys in headers or query', async () => {
    const basic = echoed(
      await execute({
        url: target.url('/echo'),
        auth: { type: 'basic', username: 'ada', password: 'pä55' },
      }),
    );
    const headerKey = echoed(
      await execute({
        url: target.url('/echo'),
        auth: { type: 'apikey', key: 'X-Api-Key', value: 'k1', addTo: 'header' },
      }),
    );
    const queryKey = echoed(
      await execute({
        url: target.url('/echo'),
        auth: { type: 'apikey', key: 'api_key', value: 'k2', addTo: 'query' },
      }),
    );

    expect(basic.headers.authorization).toBe(`Basic ${Buffer.from('ada:pä55').toString('base64')}`);
    expect(headerKey.headers['x-api-key']).toBe('k1');
    expect(queryKey.query.api_key).toBe('k2');
  });

  it('never forwards the Relay session cookie or Host header from the caller', async () => {
    const request = echoed(
      await execute({
        url: target.url('/echo'),
        headers: [{ key: 'Host', value: 'internal.example' }],
      }),
    );

    expect(request.headers.cookie).toBeUndefined();
    expect(request.headers.host).toBe(`127.0.0.1:${target.port}`);
  });

  it('rejects malformed header names', async () => {
    const res = await execute({
      url: target.url('/echo'),
      headers: [{ key: 'Bad Header', value: 'x' }],
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_HEADER');
  });
});

describe('request bodies', () => {
  it('sends JSON with a default content type', async () => {
    const request = echoed(
      await execute({
        method: 'POST',
        url: target.url('/echo'),
        body: { mode: 'json', raw: '{"qty":2}' },
      }),
    );

    expect(request.headers['content-type']).toBe('application/json');
    expect(request.body).toBe('{"qty":2}');
  });

  it('keeps a user-provided content type for raw bodies', async () => {
    const request = echoed(
      await execute({
        method: 'PUT',
        url: target.url('/echo'),
        headers: [{ key: 'Content-Type', value: 'application/xml' }],
        body: { mode: 'raw', raw: '<a/>' },
      }),
    );

    expect(request.headers['content-type']).toBe('application/xml');
    expect(request.body).toBe('<a/>');
  });

  it('encodes x-www-form-urlencoded bodies', async () => {
    const request = echoed(
      await execute({
        method: 'POST',
        url: target.url('/echo'),
        body: {
          mode: 'urlencoded',
          urlencoded: [
            { key: 'name', value: 'Ada Lovelace' },
            { key: 'off', value: 'x', enabled: false },
          ],
        },
      }),
    );

    expect(request.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(request.body).toBe('name=Ada+Lovelace');
  });

  it('builds multipart form-data with a matching boundary', async () => {
    const request = echoed(
      await execute({
        method: 'POST',
        url: target.url('/echo'),
        headers: [{ key: 'Content-Type', value: 'multipart/form-data' }],
        body: { mode: 'form-data', formData: [{ key: 'title', value: 'Hello' }] },
      }),
    );

    const boundary = request.headers['content-type'].match(/boundary=(.+)$/)[1];
    expect(request.body).toContain(`--${boundary}\r\nContent-Disposition: form-data; name="title"`);
    expect(request.body).toContain('\r\n\r\nHello\r\n');
    expect(request.body.endsWith(`--${boundary}--\r\n`)).toBe(true);
  });
});

describe('environment variables', () => {
  it('resolves variables, including secrets, and reports unresolved ones', async () => {
    await activateEnvironment([
      { key: 'baseUrl', value: target.url('') },
      { key: 'token', value: 'super-secret', secret: true },
      { key: 'disabled', value: 'nope', enabled: false },
    ]);

    const res = await execute({
      url: '{{baseUrl}}/echo',
      params: [{ key: 'q', value: '{{disabled}}' }],
      auth: { type: 'bearer', token: '{{ token }}' },
      headers: [{ key: 'X-Missing', value: '{{missing}}' }],
    });

    const request = echoed(res);
    expect(request.headers.authorization).toBe('Bearer super-secret');
    expect(request.query.q).toBe('{{disabled}}');
    expect(res.body.response.unresolvedVariables.sort()).toEqual(['disabled', 'missing']);
  });

  it('can skip variable resolution with environmentId: null', async () => {
    await activateEnvironment([{ key: 'baseUrl', value: target.url('') }]);

    const res = await execute({
      url: target.url('/echo'),
      headers: [{ key: 'X-Value', value: '{{baseUrl}}' }],
      environmentId: null,
    });

    expect(echoed(res).headers['x-value']).toBe('{{baseUrl}}');
  });

  it('records history with the unresolved definition and no secrets', async () => {
    await activateEnvironment([{ key: 'token', value: 'super-secret', secret: true }]);

    await execute({ url: target.url('/echo'), auth: { type: 'bearer', token: '{{token}}' } });
    await execute({ url: target.url('/echo'), auth: { type: 'bearer', token: 'literal-secret' } });

    const history = await RequestHistory.find().sort({ createdAt: 1 });
    expect(history).toHaveLength(2);
    expect(history[0].auth.token).toBe('{{token}}');
    expect(history[1].auth.token).toBe('[redacted]');
    expect(history[0].response.status).toBe(200);
    expect(JSON.stringify(history)).not.toContain('secret');
  });
});

describe('redirects', () => {
  it('follows redirects and turns a 302 POST into a GET without a body', async () => {
    const res = await execute({
      method: 'POST',
      url: target.url(`/redirect?to=${encodeURIComponent('/echo')}`),
      body: { mode: 'json', raw: '{"a":1}' },
    });

    const request = echoed(res);
    expect(request.method).toBe('GET');
    expect(request.body).toBe('');
    expect(request.headers['content-type']).toBeUndefined();
    expect(res.body.response.redirects).toEqual([{ status: 302, url: target.url('/echo') }]);
  });

  it('keeps the method and body for 307', async () => {
    const request = echoed(
      await execute({
        method: 'POST',
        url: target.url(`/redirect?status=307&to=${encodeURIComponent('/echo')}`),
        body: { mode: 'raw', raw: 'payload' },
      }),
    );

    expect(request.method).toBe('POST');
    expect(request.body).toBe('payload');
  });

  it('drops credentials when redirecting to another origin', async () => {
    const otherOrigin = `http://localhost:${target.port}/echo`;
    const request = echoed(
      await execute({
        url: target.url(`/redirect?to=${encodeURIComponent(otherOrigin)}`),
        auth: { type: 'bearer', token: 'secret' },
        headers: [{ key: 'X-Keep', value: 'yes' }],
      }),
    );

    expect(request.headers.authorization).toBeUndefined();
    expect(request.headers['x-keep']).toBe('yes');
  });

  it('re-checks every hop: a redirect to cloud metadata is blocked', async () => {
    const res = await execute({
      url: target.url(`/redirect?to=${encodeURIComponent('http://169.254.169.254/latest/')}`),
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('DESTINATION_BLOCKED');
  });

  it('returns the redirect response itself when following is disabled', async () => {
    const res = await execute({
      url: target.url(`/redirect?to=${encodeURIComponent('/echo')}`),
      followRedirects: false,
    });

    expect(res.body.response.status).toBe(302);
    expect(res.body.response.headers).toContainEqual(['Location', '/echo']);
  });

  it('stops redirect loops', async () => {
    const res = await execute({ url: target.url('/loop') });

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('TOO_MANY_REDIRECTS');
  });
});

describe('review regressions', () => {
  it('times out a stalled compressed response instead of hanging', async () => {
    const startedAt = Date.now();
    const res = await execute({ url: target.url('/gzip-stall') });

    expect(res.status).toBe(504);
    expect(res.body.error.code).toBe('TIMEOUT');
    expect(Date.now() - startedAt).toBeLessThan(3000);
  });

  it('fails cleanly when a compressed response is cut off', async () => {
    const res = await execute({ url: target.url('/gzip-cut') });

    expect(res.status).toBe(502);
  });

  it('drops API key headers when redirecting to another origin', async () => {
    const otherOrigin = `http://localhost:${target.port}/echo`;
    const request = echoed(
      await execute({
        url: target.url(`/redirect?to=${encodeURIComponent(otherOrigin)}`),
        auth: { type: 'apikey', key: 'X-Api-Key', value: 'secret-key', addTo: 'header' },
      }),
    );

    expect(request.headers['x-api-key']).toBeUndefined();
  });

  it('keeps API key headers on same-origin redirects', async () => {
    const request = echoed(
      await execute({
        url: target.url(`/redirect?to=${encodeURIComponent('/echo')}`),
        auth: { type: 'apikey', key: 'X-Api-Key', value: 'secret-key', addTo: 'header' },
      }),
    );

    expect(request.headers['x-api-key']).toBe('secret-key');
  });

  it('reports an invalid redirect location clearly', async () => {
    const res = await execute({ url: target.url('/bad-redirect') });

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('INVALID_REDIRECT');
  });
});

describe('responses', () => {
  it('returns non-2xx responses with all headers, including repeated ones', async () => {
    const res = await execute({ url: target.url('/status?code=418') });

    expect(res.status).toBe(200);
    expect(res.body.response.status).toBe(418);
    expect(res.body.response.headers.filter(([name]) => name === 'Set-Cookie')).toEqual([
      ['Set-Cookie', 'a=1'],
      ['Set-Cookie', 'b=2'],
    ]);
  });

  it('decompresses gzip bodies', async () => {
    const res = await execute({ url: target.url('/gzip') });

    expect(JSON.parse(res.body.response.body)).toEqual({ compressed: true });
  });

  it('returns binary bodies as base64', async () => {
    const res = await execute({ url: target.url('/binary') });

    expect(res.body.response.bodyEncoding).toBe('base64');
    expect(res.body.response.contentType).toBe('image/png');
    expect(Buffer.from(res.body.response.body, 'base64')).toEqual(BINARY_BYTES);
  });

  it('truncates responses over the size limit', async () => {
    const res = await execute({ url: target.url(`/big?bytes=${MAX_RESPONSE_BYTES * 3}`) });

    expect(res.body.response.truncated).toBe(true);
    expect(res.body.response.sizeBytes).toBe(MAX_RESPONSE_BYTES);
  });

  it('applies the size limit after decompression (gzip bomb)', async () => {
    const res = await execute({ url: target.url('/gzip-bomb') });

    expect(res.body.response.truncated).toBe(true);
    expect(res.body.response.sizeBytes).toBe(MAX_RESPONSE_BYTES);
  });

  it('returns an empty body for HEAD', async () => {
    const res = await execute({ method: 'HEAD', url: target.url('/echo') });

    expect(res.body.response.status).toBe(200);
    expect(res.body.response.body).toBe('');
  });
});

describe('failures', () => {
  it('times out slow servers and records the failure in history', async () => {
    const res = await execute({ url: target.url('/slow') });

    expect(res.status).toBe(504);
    expect(res.body.error.code).toBe('TIMEOUT');
    const [entry] = await RequestHistory.find();
    expect(entry.response.error).toMatch(/timed out/);
  });

  it('reports refused connections', async () => {
    const res = await execute({ url: 'http://127.0.0.1:9/' });

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('CONNECTION_REFUSED');
  });

  it('reports DNS failures', async () => {
    const res = await execute({ url: 'http://does-not-exist.invalid/' });

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('DNS_LOOKUP_FAILED');
  });

  it('adds https:// when the scheme is missing', async () => {
    const res = await execute({ url: 'does-not-exist.invalid/path' });

    expect(res.body.error.code).toBe('DNS_LOOKUP_FAILED');
  });
});
