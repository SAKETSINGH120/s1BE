# API reference

Base URL: `/api/v1`. Requests and responses use JSON.

## Conventions

**Authentication.** Endpoints marked 🔒 require the `relay_session` cookie set by register or login. Browsers send it automatically; API clients must keep cookies between requests.

**Errors** always have this shape:

```json
{
  "error": {
    "message": "Validation failed",
    "details": [{ "field": "email", "message": "Enter a valid email address" }]
  }
}
```

`details` is only present for validation errors.

| Status | Meaning                                                       |
| ------ | ------------------------------------------------------------- |
| 400    | Invalid input, malformed JSON, or invalid/expired reset token |
| 401    | Not signed in, or wrong credentials                           |
| 404    | Unknown route or resource                                     |
| 409    | Conflict (e.g. email already registered)                      |
| 413    | Request body over 1 MB                                        |
| 429    | Rate limit exceeded                                           |
| 500    | Unexpected server error (no details are exposed)              |

**Rate limits** per client IP, per 15 minutes: 600 requests across `/api`; 20 across register, login, forgot-password and reset-password. Responses include `RateLimit` and `RateLimit-Policy` headers.

## Health

### `GET /health`

`200 { "status": "ok" }`

## Auth

User object returned by auth endpoints:

```json
{
  "id": "665f…",
  "name": "Ada Lovelace",
  "email": "ada@example.com",
  "createdAt": "2026-11-13T10:00:00.000Z"
}
```

### `POST /auth/register`

| Field      | Rules                                   |
| ---------- | --------------------------------------- |
| `name`     | 1–80 characters                         |
| `email`    | Valid email; stored lowercase           |
| `password` | At least 8 characters, at most 72 bytes |

`201 { "user": User }` and sets the session cookie. `409` if the email is taken.

### `POST /auth/login`

Body: `{ "email", "password" }`.

`200 { "user": User }` and sets the session cookie. `401 "Invalid email or password"` for any wrong combination.

### `POST /auth/logout`

Clears the session cookie. `204`.

### `GET /auth/me` 🔒

`200 { "user": User }`, or `401` without a valid session.

### `POST /auth/forgot-password`

Body: `{ "email" }`.

Always `200 { "message": "If an account exists for that email, a password reset link has been sent." }`. If the account exists, an email with `${CLIENT_ORIGIN}/reset-password?token=…` is sent.

### `POST /auth/reset-password`

Body: `{ "token", "password" }` (password rules as for register).

`200 { "message": … }`. Every existing session for the user is invalidated and the caller's cookie is cleared; the user signs in again with the new password. `400` if the token is invalid, expired or already used.

## Workspaces 🔒

Everything below requires a session. Resources are scoped to a workspace the caller owns; a workspace or resource that does not exist **or belongs to someone else** returns `404`.

| Method | Path                       | Body                                              | Response                                                               |
| ------ | -------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------- |
| GET    | `/workspaces`              | –                                                 | `{ workspaces }`                                                       |
| POST   | `/workspaces`              | `{ name }`                                        | `201 { workspace }`                                                    |
| GET    | `/workspaces/:workspaceId` | –                                                 | `{ workspace }`                                                        |
| PATCH  | `/workspaces/:workspaceId` | `{ name?, activeEnvironmentId? }` (`null` clears) | `{ workspace }`                                                        |
| DELETE | `/workspaces/:workspaceId` | –                                                 | `204`; deletes all contents. `409` if it is the user's last workspace. |

A default workspace named "My Workspace" is created at registration.

The paths below are relative to `/workspaces/:workspaceId`.

### Collections

| Method | Path                         | Body                      | Response                                                                                                                                                                    |
| ------ | ---------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/collections`               | –                         | `{ collections }` sorted by name                                                                                                                                            |
| POST   | `/collections`               | `{ name, description? }`  | `201 { collection }`                                                                                                                                                        |
| GET    | `/collections/:collectionId` | –                         | `{ collection, folders, requests }` – all folders (flat, build the tree from `parentId`) and request summaries (`id, name, method, url, collectionId, folderId, updatedAt`) |
| PATCH  | `/collections/:collectionId` | `{ name?, description? }` | `{ collection }`                                                                                                                                                            |
| DELETE | `/collections/:collectionId` | –                         | `204`; deletes its folders and requests                                                                                                                                     |

### Folders

| Method | Path                 | Body                                                         | Response                                                                                |
| ------ | -------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| POST   | `/folders`           | `{ name, collectionId, parentId? }`                          | `201 { folder }`                                                                        |
| GET    | `/folders/:folderId` | –                                                            | `{ folder, folders, requests }` – direct subfolders and request summaries               |
| PATCH  | `/folders/:folderId` | `{ name?, parentId? }` (`null` moves to the collection root) | `{ folder }`. `400` if the parent is in another collection or the move creates a cycle. |
| DELETE | `/folders/:folderId` | –                                                            | `204`; deletes all nested folders and their requests                                    |

### Saved requests

| Method | Path                   | Body                                                | Response                        |
| ------ | ---------------------- | --------------------------------------------------- | ------------------------------- |
| GET    | `/requests`            | –                                                   | `{ requests }` (summaries)      |
| POST   | `/requests`            | `{ name, collectionId, folderId?, ...requestSpec }` | `201 { request }`               |
| GET    | `/requests/:requestId` | –                                                   | `{ request }` (full definition) |
| PATCH  | `/requests/:requestId` | any create field                                    | `{ request }`                   |
| DELETE | `/requests/:requestId` | –                                                   | `204`                           |

Moving: send `folderId` (or `null`) to move within the collection; send `collectionId` to move to another collection (to its root unless a `folderId` of that collection is also sent). The request spec fields are described in [database.md](database.md#request-spec). `auth` is validated per type, e.g. `{ "type": "bearer", "token": "{{token}}" }`.

### Environments

| Method | Path                           | Body                    | Response                                       |
| ------ | ------------------------------ | ----------------------- | ---------------------------------------------- |
| GET    | `/environments`                | –                       | `{ environments }`                             |
| POST   | `/environments`                | `{ name, variables? }`  | `201 { environment }`; `409` on duplicate name |
| GET    | `/environments/:environmentId` | –                       | `{ environment }`                              |
| PATCH  | `/environments/:environmentId` | `{ name?, variables? }` | `{ environment }`                              |
| DELETE | `/environments/:environmentId` | –                       | `204`; clears it as the active environment     |

`variables` is the full list: `[{ key, value?, secret?, enabled? }]`. In responses, secret variables have `value: ""` and `hasValue` tells whether one is stored. On update, a variable sent **without** `value` keeps its stored value, so secrets never need to round-trip through the browser.

### History

| Method | Path                | Body                                                                                                   | Response                            |
| ------ | ------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| GET    | `/history`          | –                                                                                                      | `{ history }`, newest first         |
| POST   | `/history`          | `{ method, url, ...requestSpec, response? }` with `response: { status?, timeMs?, sizeBytes?, error? }` | `201 { entry }`                     |
| DELETE | `/history/:entryId` | –                                                                                                      | `204`                               |
| DELETE | `/history`          | –                                                                                                      | `204`; clears the workspace history |

Literal credentials in `Authorization`, `Proxy-Authorization`, `Cookie`, `X-Api-Key` and `X-Auth-Token` headers and in `auth` are stored as `[redacted]`; values that are only a `{{variable}}` are kept.

### Execute a request

`POST /workspaces/:workspaceId/execute` 🔒 — rate limited to 60 per minute per user.

Body: a request spec (`method` and `url` required; `params`, `headers`, `auth`, `body` optional) plus:

| Field             | Default                      | Meaning                                                              |
| ----------------- | ---------------------------- | -------------------------------------------------------------------- |
| `environmentId`   | workspace active environment | Environment whose variables resolve `{{name}}`; `null` resolves none |
| `followRedirects` | `true`                       | Follow up to `EXECUTION_MAX_REDIRECTS` redirects                     |

A URL without a scheme gets `https://`. The request is recorded in history (unresolved, credentials redacted) whether it succeeds or fails.

`200 { response }` whenever the target answered, **whatever its status code**:

```json
{
  "status": 404,
  "statusText": "Not Found",
  "headers": [
    ["Content-Type", "application/json"],
    ["Set-Cookie", "a=1"],
    ["Set-Cookie", "b=2"]
  ],
  "contentType": "application/json",
  "body": "{\"error\":\"missing\"}",
  "bodyEncoding": "utf8",
  "sizeBytes": 19,
  "headersSizeBytes": 64,
  "truncated": false,
  "timeMs": 132,
  "redirects": [{ "status": 301, "url": "https://api.example.com/v2/x" }],
  "unresolvedVariables": ["missingVar"]
}
```

`headers` is a list of pairs so repeated headers are preserved. Binary bodies use `"bodyEncoding": "base64"`. `sizeBytes` is the decoded body size; `truncated` is `true` when it hit `EXECUTION_MAX_RESPONSE_BYTES`.

Errors carry a `code`:

| Status | `code`                                                                                                                                                  | Cause                                                                                            |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 400    | `INVALID_URL`, `UNSUPPORTED_PROTOCOL`                                                                                                                   | Not a valid `http(s)` URL, or credentials embedded in it                                         |
| 400    | `DESTINATION_BLOCKED`                                                                                                                                   | The host is, or resolves to, a private, internal or reserved address (checked on every redirect) |
| 400    | `INVALID_HEADER`                                                                                                                                        | Header name or value contains invalid characters                                                 |
| 502    | `DNS_LOOKUP_FAILED`, `CONNECTION_REFUSED`, `CONNECTION_RESET`, `HOST_UNREACHABLE`, `TLS_ERROR`, `DECODE_FAILED`, `TOO_MANY_REDIRECTS`, `REQUEST_FAILED` | The target could not be reached or answered incorrectly                                          |
| 504    | `TIMEOUT`                                                                                                                                               | No complete response within `EXECUTION_TIMEOUT_MS` (all hops included)                           |

### Import a Postman collection

`POST /workspaces/:workspaceId/collections/import` 🔒 — body: the Postman Collection **v2.0 or v2.1** JSON itself (up to 5 MB, 2,000 items, 20 folder levels).

`201 { collection, summary }`:

```json
{
  "collection": { "id": "…", "name": "Shop API", "description": "…" },
  "summary": {
    "folders": 2,
    "requests": 5,
    "environment": { "id": "…", "name": "Shop API variables" },
    "warnings": ["Pre-request and test scripts are not supported and were ignored"]
  }
}
```

| Postman feature                                                                                                                             | Result                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Folders (any depth), requests, descriptions                                                                                                 | Imported                                                                                     |
| URL query (`url.query` or in `url.raw`)                                                                                                     | Moved to `params`, including disabled entries                                                |
| Headers, disabled headers                                                                                                                   | Imported                                                                                     |
| Bearer, Basic, API key auth on requests, folders or the collection                                                                          | Imported; inherited auth is applied to each request                                          |
| `noauth`                                                                                                                                    | No Auth                                                                                      |
| Raw bodies (JSON language → `json`, others → `raw`), urlencoded, form-data text fields                                                      | Imported                                                                                     |
| Collection variables                                                                                                                        | Created as an environment named "&lt;collection&gt; variables" (suffixed if the name exists) |
| Scripts, file form fields, GraphQL/file bodies, other auth types, methods other than GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS, path variables | Skipped, each reported once in `warnings`                                                    |

The tree is written in bulk; if anything fails, the partially imported collection is removed. Errors: `400` with `code: "INVALID_IMPORT"` for files that are not Postman v2.x collections; `413` for files over 5 MB.

### Export a collection

`GET /workspaces/:workspaceId/collections/:collectionId/export` 🔒 → a Postman Collection v2.1 document. Query params appear in `url.raw` (enabled ones) and `url.query` (all, with `disabled`). Exports contain request credentials as saved, so treat exported files as sensitive.

### Captures and assertions

Every request spec (saved requests, history and `/execute`) can carry two optional lists.

`captures` (max 20) save a value from the response into the **active environment** after it arrives:

```json
[{ "variable": "token", "source": "body", "path": "$.data.token", "enabled": true }]
```

`source` is `body` (JSONPath subset: `$.a.b[0]`, `$['odd key']`), `header` (path = header name) or `status`. Existing variables keep their `secret`/`enabled` flags; new ones are added as plain variables. Values are **never returned**; the response only reports which variables were saved.

`assertions` (max 50) check the response:

```json
[{ "source": "body", "path": "$.id", "operator": "exists", "expected": "", "enabled": true }]
```

`source`: `status`, `time` (ms), `header`, `body`. `operator`: `equals`, `notEquals`, `contains`, `lessThan`, `greaterThan`, `exists`, `notExists`. `expected` may contain `{{variables}}`.

`/execute` responses then include:

```json
{
  "tests": [
    { "name": "Status equals 200", "passed": true },
    { "name": "Body $.id exists", "passed": false, "message": "Not found" }
  ],
  "captures": [
    { "variable": "token", "saved": true },
    { "variable": "user", "saved": false, "message": "Not found in the response" }
  ]
}
```

## Account 🔒

| Method | Path            | Body           | Response                                                                                                                                                           |
| ------ | --------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/auth/export`  | –              | All workspaces with collections, folders, requests, environments and history, as a JSON attachment. Secret variable values are exported as `null`.                 |
| DELETE | `/auth/account` | `{ password }` | `204`; deletes the user and every workspace they own, and clears the session. `400 INVALID_PASSWORD` for a wrong password. Rate limited like other auth endpoints. |

### Dynamic variables

Anywhere `{{name}}` works (URL, params, headers, auth, body, assertion values), these built-ins generate a fresh value on every use:

| Variable                               | Example                                     |
| -------------------------------------- | ------------------------------------------- |
| `{{$uuid}}`                            | `3b241101-e2bb-4255-8caf-4136c566a962`      |
| `{{$timestamp}}` / `{{$timestampMs}}`  | `1794632000` / `1794632000123`              |
| `{{$isoTimestamp}}`                    | `2026-11-14T06:32:37.968Z`                  |
| `{{$randomInt}}`                       | `0`–`1000`                                  |
| `{{$randomString}}`                    | 12 lowercase letters and digits             |
| `{{$randomBoolean}}`                   | `true` / `false`                            |
| `{{$randomName}}` / `{{$randomEmail}}` | `Grace Hopper` / `grace.k3j9xa@example.com` |

Assertions also support the `isType` operator, with `expected` one of `string`, `number`, `boolean`, `null`, `array`, `object`.
