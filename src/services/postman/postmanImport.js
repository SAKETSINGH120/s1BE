import crypto from 'node:crypto';
import { z } from 'zod';
import { HTTP_METHODS } from '../../models/requestSpec.schema.js';
import { requestSpecShape } from '../../validators/request.validators.js';

export const MAX_IMPORT_ITEMS = 2000;
const MAX_DEPTH = 20;
const MAX_WARNINGS = 50;
const NAME_MAX_LENGTH = 120;

const specSchema = z.object(requestSpecShape);

const truncateName = (name, fallback) =>
  (typeof name === 'string' && name.trim() ? name.trim() : fallback).slice(0, NAME_MAX_LENGTH);

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const text = (value) => (value === undefined || value === null ? '' : String(value));

const toPairs = (list = []) =>
  (Array.isArray(list) ? list : [])
    .filter((pair) => isObject(pair) && pair.key !== undefined)
    .map((pair) => ({ key: text(pair.key), value: text(pair.value), enabled: !pair.disabled }));

function descriptionText(description) {
  if (typeof description === 'string') return description;
  if (description && typeof description.content === 'string') return description.content;
  return '';
}

// Postman auth parameters are lists of { key, value }.
function authParams(auth) {
  const list = auth?.[auth.type];
  if (!Array.isArray(list)) return {};
  return Object.fromEntries(list.filter(isObject).map((entry) => [entry.key, text(entry.value)]));
}

class Warnings {
  constructor() {
    this.messages = new Map();
  }

  add(message) {
    this.messages.set(message, (this.messages.get(message) ?? 0) + 1);
  }

  list() {
    return [...this.messages]
      .map(([message, count]) => (count > 1 ? `${message} (${count}×)` : message))
      .slice(0, MAX_WARNINGS);
  }
}

function convertAuth(auth, warnings) {
  if (!isObject(auth) || auth.type === 'noauth') return { type: 'none' };
  const params = authParams(auth);
  switch (auth.type) {
    case 'bearer':
      return { type: 'bearer', token: params.token ?? '' };
    case 'basic':
      return { type: 'basic', username: params.username ?? '', password: params.password ?? '' };
    case 'apikey':
      return {
        type: 'apikey',
        key: params.key ?? '',
        value: params.value ?? '',
        addTo: params.in === 'query' ? 'query' : 'header',
      };
    default:
      warnings.add(`Auth type "${auth.type}" is not supported and was replaced with No Auth`);
      return { type: 'none' };
  }
}

function convertBody(body, warnings) {
  if (!isObject(body) || !body.mode || body.disabled) return { mode: 'none' };
  switch (body.mode) {
    case 'raw': {
      const isJson = body.options?.raw?.language === 'json';
      return { mode: isJson ? 'json' : 'raw', raw: text(body.raw) };
    }
    case 'urlencoded':
      return { mode: 'urlencoded', urlencoded: toPairs(body.urlencoded) };
    case 'formdata': {
      const fields = Array.isArray(body.formdata) ? body.formdata.filter(isObject) : [];
      if (fields.some((field) => field.type === 'file')) {
        warnings.add('File fields in form-data bodies are not supported and were skipped');
      }
      return {
        mode: 'form-data',
        formData: toPairs(fields.filter((field) => field.type !== 'file')),
      };
    }
    default:
      warnings.add(`Body mode "${body.mode}" is not supported and was removed`);
      return { mode: 'none' };
  }
}

function rawUrl(url) {
  if (typeof url === 'string') return url;
  if (!isObject(url)) return '';
  if (typeof url.raw === 'string') return url.raw;

  const host = Array.isArray(url.host) ? url.host.join('.') : text(url.host);
  const path = Array.isArray(url.path) ? url.path.join('/') : text(url.path);
  const protocol = url.protocol ? `${url.protocol}://` : '';
  const port = url.port ? `:${url.port}` : '';
  return `${protocol}${host}${port}${path ? `/${path.replace(/^\//, '')}` : ''}`;
}

// Our requests keep the query string in `params`, so it is split off the URL.
function convertUrl(url, warnings) {
  const raw = rawUrl(url).trim();
  const [base, query = ''] = raw.split(/\?(.*)/s, 2);
  let params = isObject(url) && Array.isArray(url.query) ? toPairs(url.query) : null;

  if (!params) {
    params = query
      ? query
          .split('&')
          .filter(Boolean)
          .map((part) => {
            const [key, ...rest] = part.split('=');
            return { key, value: rest.join('='), enabled: true };
          })
      : [];
  }
  if (isObject(url) && Array.isArray(url.variable) && url.variable.length) {
    warnings.add('Path variables (:name) are not supported; they were left in the URL');
  }
  return { url: base, params };
}

function convertRequest(item, inheritedAuth, warnings) {
  const request = typeof item.request === 'string' ? { url: item.request } : item.request;
  if (!isObject(request)) {
    warnings.add('Requests without a valid definition were skipped');
    return null;
  }
  const method = text(request.method || 'GET').toUpperCase();
  if (!HTTP_METHODS.includes(method)) {
    warnings.add(`Method ${method} is not supported; request "${item.name}" was skipped`);
    return null;
  }

  const { url, params } = convertUrl(request.url, warnings);
  const spec = {
    method,
    url,
    params,
    headers: Array.isArray(request.header) ? toPairs(request.header) : [],
    auth: convertAuth(request.auth ?? inheritedAuth, warnings),
    body: convertBody(request.body, warnings),
  };

  const parsed = specSchema.safeParse(spec);
  if (!parsed.success) {
    warnings.add(
      `Request "${truncateName(item.name, 'Untitled')}" exceeds size limits and was skipped`,
    );
    return null;
  }
  return parsed.data;
}

const postmanSchema = z.object({
  info: z.object({
    name: z.string().trim().min(1, 'The collection has no name'),
    schema: z
      .string()
      .regex(
        /collection\/v2\.[01]\.\d/,
        'Only Postman Collection v2.0 and v2.1 files are supported',
      ),
    description: z.unknown().optional(),
  }),
  item: z.array(z.unknown()),
  auth: z.unknown().optional(),
  variable: z.array(z.unknown()).optional(),
  event: z.array(z.unknown()).optional(),
});

export function parsePostmanCollection(input) {
  return postmanSchema.safeParse(input);
}

/**
 * Converts a validated Postman collection into Relay's structure. Folders get temporary ids so
 * requests can reference them; the caller replaces them with real ObjectIds.
 */
export function convertPostmanCollection(postman) {
  const warnings = new Warnings();
  const folders = [];
  const requests = [];
  let itemCount = 0;

  if (postman.event?.length)
    warnings.add('Pre-request and test scripts are not supported and were ignored');

  function walk(items, parentId, inheritedAuth, depth) {
    if (depth > MAX_DEPTH) {
      warnings.add(`Folders nested deeper than ${MAX_DEPTH} levels were skipped`);
      return;
    }
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      itemCount += 1;
      if (itemCount > MAX_IMPORT_ITEMS) {
        warnings.add(`Only the first ${MAX_IMPORT_ITEMS} items were imported`);
        return;
      }
      if (item.event?.length)
        warnings.add('Pre-request and test scripts are not supported and were ignored');

      if (Array.isArray(item.item)) {
        const folderId = crypto.randomUUID();
        folders.push({
          tempId: folderId,
          parentTempId: parentId,
          name: truncateName(item.name, 'Folder'),
        });
        walk(item.item, folderId, item.auth ?? inheritedAuth, depth + 1);
      } else if (item.request) {
        const spec = convertRequest(item, inheritedAuth, warnings);
        if (spec) {
          requests.push({ folderTempId: parentId, name: truncateName(item.name, 'Request'), spec });
        }
      }
    }
  }

  walk(postman.item, null, postman.auth, 0);

  // Same rules as the environment API: valid, unique names; at most 500; bounded values.
  const seenKeys = new Set();
  const variables = toPairs(postman.variable)
    .filter(({ key }) => {
      if (key.length > 256 || !/^[\w.-]+$/.test(key) || seenKeys.has(key)) return false;
      seenKeys.add(key);
      return true;
    })
    .slice(0, 500)
    .map(({ key, value, enabled }) => ({ key, value: value.slice(0, 16_384), enabled }));

  return {
    collection: {
      name: truncateName(postman.info.name, 'Imported collection'),
      description: descriptionText(postman.info.description).slice(0, 5000),
    },
    folders,
    requests,
    variables,
    warnings: warnings.list(),
  };
}
