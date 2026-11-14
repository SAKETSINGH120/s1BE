import { describe, expect, it } from 'vitest';
import {
  createResponseContext,
  evaluateAssertions,
  extractCaptures,
} from '../src/services/execution/responseChecks.js';
import { parseJsonPath, readJsonPath } from '../src/utils/jsonPath.js';

const body = {
  token: 'abc123',
  user: { id: 7, tags: ['admin', 'beta'], 'display name': 'Ada' },
  items: [{ id: 1 }, { id: 2 }],
  empty: null,
};

const context = createResponseContext({
  status: 201,
  timeMs: 120,
  headers: [
    ['Content-Type', 'application/json; charset=utf-8'],
    ['X-Request-Id', 'req-9'],
  ],
  bodyEncoding: 'utf8',
  bodyText: JSON.stringify(body),
});

describe('jsonPath', () => {
  it.each([
    ['$.token', 'abc123'],
    ['token', 'abc123'],
    ['$.user.id', 7],
    ['$.user.tags[1]', 'beta'],
    ["$.user['display name']", 'Ada'],
    ['$.items[0].id', 1],
    ['$.empty', null],
  ])('%s reads %j', (path, expected) => {
    expect(readJsonPath(body, path)).toEqual({ found: true, value: expected });
  });

  it('reports missing values without throwing', () => {
    expect(readJsonPath(body, '$.user.missing.deep')).toEqual({ found: false, value: undefined });
    expect(readJsonPath(body, '$.items[5].id').found).toBe(false);
  });

  it('rejects unsupported syntax', () => {
    expect(() => parseJsonPath('$.items[*]')).toThrow();
    expect(() => parseJsonPath('$.items[0')).toThrow();
  });
});

describe('evaluateAssertions', () => {
  const check = (assertion) => evaluateAssertions([assertion], context)[0];

  it.each([
    [{ source: 'status', operator: 'equals', expected: '201' }, true],
    [{ source: 'status', operator: 'equals', expected: '200' }, false],
    [{ source: 'time', operator: 'lessThan', expected: '500' }, true],
    [{ source: 'time', operator: 'greaterThan', expected: '500' }, false],
    [{ source: 'header', path: 'content-type', operator: 'contains', expected: 'json' }, true],
    [{ source: 'body', path: '$.token', operator: 'equals', expected: 'abc123' }, true],
    [{ source: 'body', path: '$.user.id', operator: 'equals', expected: '7' }, true],
    [{ source: 'body', path: '$.user.tags', operator: 'contains', expected: 'admin' }, true],
    [{ source: 'body', path: '$.token', operator: 'notEquals', expected: 'x' }, true],
    [{ source: 'body', path: '$.user.id', operator: 'exists' }, true],
    [{ source: 'body', path: '$.nope', operator: 'notExists' }, true],
    [{ source: 'body', path: '$.nope', operator: 'exists' }, false],
    [{ source: 'body', path: '$.user.id', operator: 'isType', expected: 'number' }, true],
    [{ source: 'body', path: '$.user.tags', operator: 'isType', expected: 'array' }, true],
    [{ source: 'body', path: '$.user', operator: 'isType', expected: 'object' }, true],
    [{ source: 'body', path: '$.empty', operator: 'isType', expected: 'null' }, true],
    [{ source: 'body', path: '$.token', operator: 'isType', expected: 'number' }, false],
  ])('%j → %s', (assertion, passed) => {
    expect(check({ path: '', ...assertion }).passed).toBe(passed);
  });

  it('explains failures and skips disabled checks', () => {
    const results = evaluateAssertions(
      [
        { source: 'status', path: '', operator: 'equals', expected: '200' },
        { source: 'status', path: '', operator: 'equals', expected: '201', enabled: false },
      ],
      context,
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      name: 'Status equals 200',
      passed: false,
      message: 'Got 201',
    });
  });

  it('fills {{variables}} in expected values', () => {
    const resolve = (text) => text.replace('{{expectedToken}}', 'abc123');
    const [result] = evaluateAssertions(
      [{ source: 'body', path: '$.token', operator: 'equals', expected: '{{expectedToken}}' }],
      context,
      resolve,
    );

    expect(result.passed).toBe(true);
  });

  it('fails clearly when the body is not JSON', () => {
    const textContext = createResponseContext({
      status: 200,
      timeMs: 1,
      headers: [],
      bodyEncoding: 'utf8',
      bodyText: 'plain text',
    });
    const [result] = evaluateAssertions(
      [{ source: 'body', path: '$.id', operator: 'exists' }],
      textContext,
    );

    expect(result).toMatchObject({ passed: false, message: 'The response body is not JSON' });
  });
});

describe('extractCaptures', () => {
  it('extracts strings, numbers and objects as text', () => {
    expect(
      extractCaptures(
        [
          { variable: 'token', source: 'body', path: '$.token' },
          { variable: 'userId', source: 'body', path: '$.user.id' },
          { variable: 'tags', source: 'body', path: '$.user.tags' },
          { variable: 'requestId', source: 'header', path: 'x-request-id' },
          { variable: 'code', source: 'status', path: '' },
        ],
        context,
      ),
    ).toEqual([
      { variable: 'token', value: 'abc123' },
      { variable: 'userId', value: '7' },
      { variable: 'tags', value: '["admin","beta"]' },
      { variable: 'requestId', value: 'req-9' },
      { variable: 'code', value: '201' },
    ]);
  });

  it('reports missing values and skips disabled or unnamed captures', () => {
    expect(
      extractCaptures(
        [
          { variable: 'missing', source: 'body', path: '$.nope' },
          { variable: 'off', source: 'body', path: '$.token', enabled: false },
          { variable: '', source: 'body', path: '$.token' },
          { variable: 'nullValue', source: 'body', path: '$.empty' },
        ],
        context,
      ),
    ).toEqual([
      { variable: 'missing', error: 'Not found in the response' },
      { variable: 'nullValue', error: 'Not found in the response' },
    ]);
  });
});
