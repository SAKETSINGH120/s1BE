export const POSTMAN_SCHEMA_URL =
  'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';

const toPostmanPairs = (pairs = []) =>
  pairs.map(({ key, value, enabled }) => ({
    key,
    value,
    ...(enabled === false ? { disabled: true } : {}),
  }));

const authList = (entries) =>
  Object.entries(entries).map(([key, value]) => ({ key, value: value ?? '', type: 'string' }));

function exportAuth(auth) {
  switch (auth?.type) {
    case 'bearer':
      return { type: 'bearer', bearer: authList({ token: auth.token }) };
    case 'basic':
      return {
        type: 'basic',
        basic: authList({ username: auth.username, password: auth.password }),
      };
    case 'apikey':
      return {
        type: 'apikey',
        apikey: authList({ key: auth.key, value: auth.value, in: auth.addTo ?? 'header' }),
      };
    default:
      return { type: 'noauth' };
  }
}

function exportBody(body) {
  switch (body?.mode) {
    case 'json':
      return { mode: 'raw', raw: body.raw ?? '', options: { raw: { language: 'json' } } };
    case 'raw':
      return { mode: 'raw', raw: body.raw ?? '', options: { raw: { language: 'text' } } };
    case 'urlencoded':
      return { mode: 'urlencoded', urlencoded: toPostmanPairs(body.urlencoded) };
    case 'form-data':
      return {
        mode: 'formdata',
        formdata: toPostmanPairs(body.formData).map((field) => ({ ...field, type: 'text' })),
      };
    default:
      return undefined;
  }
}

// `raw` carries enabled params so the URL works when pasted; `query` keeps disabled ones too.
function exportUrl(url, params = []) {
  const enabled = params.filter((param) => param.enabled !== false && param.key);
  const queryString = enabled.map(({ key, value }) => `${key}=${value}`).join('&');
  const separator = url.includes('?') ? '&' : '?';
  return {
    raw: queryString ? `${url}${separator}${queryString}` : url,
    ...(params.length ? { query: toPostmanPairs(params) } : {}),
  };
}

function exportRequest(request) {
  const body = exportBody(request.body);
  return {
    name: request.name,
    request: {
      method: request.method,
      header: toPostmanPairs(request.headers),
      url: exportUrl(request.url, request.params),
      auth: exportAuth(request.auth),
      ...(body ? { body } : {}),
    },
  };
}

// Map.groupBy needs Node 21+; the project supports Node 20.
function groupBy(list, getKey) {
  const groups = new Map();
  for (const entry of list) {
    const groupKey = getKey(entry);
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), entry]);
  }
  return groups;
}

export function toPostmanCollection(collection, folders, requests) {
  const key = (id) => (id ? String(id) : null);
  const foldersByParent = groupBy(folders, (folder) => key(folder.parentId));
  const requestsByFolder = groupBy(requests, (request) => key(request.folderId));

  const buildItems = (parentId) => [
    ...(foldersByParent.get(parentId) ?? []).map((folder) => ({
      name: folder.name,
      item: buildItems(key(folder._id)),
    })),
    ...(requestsByFolder.get(parentId) ?? []).map(exportRequest),
  ];

  return {
    info: {
      _postman_id: String(collection._id),
      name: collection.name,
      description: collection.description ?? '',
      schema: POSTMAN_SCHEMA_URL,
    },
    item: buildItems(null),
  };
}
