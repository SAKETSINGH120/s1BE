import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { signUp } from './helpers.js';

const app = createApp();
const HISTORY_LIMIT = 5; // HISTORY_MAX_ENTRIES in vitest.config.js

let user;
beforeEach(async () => {
  user = await signUp(app);
});

function record(fields) {
  return user.agent
    .post(user.url('/history'))
    .send({ method: 'GET', url: 'https://api.example.com/items', ...fields });
}

describe('request history', () => {
  it('records entries and lists the newest first', async () => {
    await record({ url: 'https://api.example.com/first' });
    const second = await record({
      method: 'POST',
      url: 'https://api.example.com/second',
      response: { status: 201, timeMs: 42, sizeBytes: 128 },
    });
    expect(second.status).toBe(201);

    const res = await user.agent.get(user.url('/history'));

    expect(res.body.history.map((entry) => entry.url)).toEqual([
      'https://api.example.com/second',
      'https://api.example.com/first',
    ]);
    expect(res.body.history[0]).toMatchObject({
      method: 'POST',
      response: { status: 201, timeMs: 42, sizeBytes: 128 },
      createdAt: expect.any(String),
    });
  });

  it('redacts literal credentials but keeps variable references', async () => {
    const res = await record({
      headers: [
        { key: 'Authorization', value: 'Bearer literal-secret' },
        { key: 'X-Api-Key', value: '{{apiKey}}' },
        { key: 'Accept', value: 'application/json' },
      ],
      auth: { type: 'basic', username: 'ada', password: 'hunter2' },
    });

    expect(JSON.stringify(res.body)).not.toContain('literal-secret');
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
    expect(res.body.entry.headers.map((header) => header.value)).toEqual([
      '[redacted]',
      '{{apiKey}}',
      'application/json',
    ]);
    expect(res.body.entry.auth).toMatchObject({ username: 'ada', password: '[redacted]' });
  });

  it(`keeps only the latest ${HISTORY_LIMIT} entries`, async () => {
    for (let index = 1; index <= HISTORY_LIMIT + 2; index += 1) {
      await record({ url: `https://api.example.com/${index}` });
    }

    const res = await user.agent.get(user.url('/history'));

    expect(res.body.history).toHaveLength(HISTORY_LIMIT);
    expect(res.body.history[0].url).toBe(`https://api.example.com/${HISTORY_LIMIT + 2}`);
  });

  it('deletes a single entry and clears all history', async () => {
    const first = await record({});
    await record({});

    expect((await user.agent.delete(user.url(`/history/${first.body.entry.id}`))).status).toBe(204);
    expect((await user.agent.get(user.url('/history'))).body.history).toHaveLength(1);

    expect((await user.agent.delete(user.url('/history'))).status).toBe(204);
    expect((await user.agent.get(user.url('/history'))).body.history).toHaveLength(0);
  });

  it('requires a method and URL', async () => {
    const res = await user.agent.post(user.url('/history')).send({ url: '' });

    expect(res.status).toBe(400);
  });
});
