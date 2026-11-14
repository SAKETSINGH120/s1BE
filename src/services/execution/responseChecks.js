import { readJsonPath } from '../../utils/jsonPath.js';

const PREVIEW_LENGTH = 200;

function preview(value) {
  if (value === undefined) return 'undefined';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH)}…` : text;
}

/**
 * What checks and captures read from: status, time, headers and the body. The body is parsed as
 * JSON once, and only when a check asks for it.
 */
export function createResponseContext(result) {
  let parsedBody;
  const bodyText = () => (result.bodyEncoding === 'utf8' ? result.bodyText : '');
  return {
    status: result.status,
    timeMs: result.timeMs,
    header(name) {
      const lower = name.trim().toLowerCase();
      return result.headers.find(([key]) => key.toLowerCase() === lower)?.[1];
    },
    json() {
      if (parsedBody === undefined) {
        try {
          parsedBody = { ok: true, value: JSON.parse(bodyText()) };
        } catch {
          parsedBody = { ok: false };
        }
      }
      return parsedBody;
    },
    bodyText,
  };
}

// Reads the value a check or capture points at: { found, value } or { error }.
export function readSource(context, source, path = '') {
  switch (source) {
    case 'status':
      return { found: true, value: context.status };
    case 'time':
      return { found: true, value: context.timeMs };
    case 'header': {
      const value = context.header(path);
      return { found: value !== undefined, value };
    }
    case 'body': {
      if (!path.trim()) return { found: true, value: context.bodyText() };
      const json = context.json();
      if (!json.ok) return { error: 'The response body is not JSON' };
      try {
        return readJsonPath(json.value, path);
      } catch (error) {
        return { error: `Invalid path: ${error.message}` };
      }
    }
    default:
      return { error: `Unknown source "${source}"` };
  }
}

const asNumber = (value) => (value === '' || value === null ? NaN : Number(value));

// JSON-level type names: string, number, boolean, null, array or object.
const typeOf = (value) => (value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value);

const asText = (value) => (typeof value === 'string' ? value : JSON.stringify(value));

const OPERATORS = {
  equals: (actual, expected) =>
    typeof actual === 'number' ? actual === asNumber(expected) : asText(actual) === expected,
  notEquals: (actual, expected) => !OPERATORS.equals(actual, expected),
  contains: (actual, expected) =>
    Array.isArray(actual)
      ? actual.some((item) => asText(item) === expected)
      : asText(actual).includes(expected),
  lessThan: (actual, expected) => asNumber(actual) < asNumber(expected),
  greaterThan: (actual, expected) => asNumber(actual) > asNumber(expected),
  isType: (actual, expected) => typeOf(actual) === expected.trim().toLowerCase(),
};

const OPERATOR_LABELS = {
  equals: 'equals',
  notEquals: 'does not equal',
  contains: 'contains',
  lessThan: 'is less than',
  greaterThan: 'is greater than',
  exists: 'exists',
  notExists: 'does not exist',
  isType: 'is of type',
};

function describeTarget({ source, path }) {
  if (source === 'status') return 'Status';
  if (source === 'time') return 'Response time (ms)';
  if (source === 'header') return `Header ${path}`;
  return path.trim() ? `Body ${path}` : 'Body';
}

/** Evaluates enabled assertions. `resolve` fills {{variables}} in expected values. */
export function evaluateAssertions(assertions = [], context, resolve = (text) => text) {
  return assertions
    .filter((assertion) => assertion.enabled !== false)
    .map((assertion) => {
      const name = `${describeTarget(assertion)} ${OPERATOR_LABELS[assertion.operator]}${
        ['exists', 'notExists'].includes(assertion.operator) ? '' : ` ${assertion.expected ?? ''}`
      }`.trim();
      const read = readSource(context, assertion.source, assertion.path);
      if (read.error) return { name, passed: false, message: read.error };

      if (assertion.operator === 'exists') {
        return { name, passed: read.found, message: read.found ? undefined : 'Not found' };
      }
      if (assertion.operator === 'notExists') {
        return { name, passed: !read.found, message: read.found ? 'Value is present' : undefined };
      }
      if (!read.found) return { name, passed: false, message: 'Not found' };

      const expected = resolve(assertion.expected ?? '');
      const passed = Boolean(OPERATORS[assertion.operator]?.(read.value, expected));
      return {
        name,
        passed,
        actual: preview(read.value),
        message: passed ? undefined : `Got ${preview(read.value)}`,
      };
    });
}

/** Extracts values for enabled captures. Values are strings, ready to store as variables. */
export function extractCaptures(captures = [], context) {
  return captures
    .filter((capture) => capture.enabled !== false && capture.variable)
    .map((capture) => {
      const read = readSource(context, capture.source, capture.path);
      if (read.error) return { variable: capture.variable, error: read.error };
      if (!read.found || read.value === undefined || read.value === null) {
        return { variable: capture.variable, error: 'Not found in the response' };
      }
      const value = typeof read.value === 'string' ? read.value : JSON.stringify(read.value);
      return { variable: capture.variable, value };
    });
}
