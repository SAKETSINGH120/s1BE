# Database schema

MongoDB via Mongoose. Every collection has `createdAt`/`updatedAt` (history has only `createdAt`). The API exposes `id` instead of `_id` and omits `__v`.

## Relationships

```
User 1─* Workspace 1─* Collection 1─* Folder (self-nesting via parentId)
                   │              └─* SavedRequest (optionally inside a Folder)
                   ├─* Environment
                   └─* RequestHistory
Workspace.activeEnvironmentId ─▶ Environment (nullable)
```

**Ownership.** A workspace has exactly one owner. Every other document stores `workspaceId`, and the API only loads documents with both the requested `_id` and the caller's workspace, so ownership is checked on every access. Collections, folders and requests deliberately do not copy `ownerId`; it is derived from the workspace.

**Deletes cascade in the service layer**: workspace → everything in it; collection → its folders and requests; folder → all descendant folders and their requests. MongoDB transactions are not used (they need a replica set), so children are deleted before their parent; an interrupted delete leaves only unreachable orphans, never broken references from visible data.

## Collections

### `users`

| Field                    | Type   | Notes                                                     |
| ------------------------ | ------ | --------------------------------------------------------- |
| `name`                   | String | Required, ≤ 80                                            |
| `email`                  | String | Required, lowercase, **unique**                           |
| `passwordHash`           | String | bcrypt; `select: false`                                   |
| `sessionVersion`         | Number | Bumped on password reset to revoke sessions               |
| `passwordResetTokenHash` | String | SHA-256 of the reset token; `select: false`, sparse index |
| `passwordResetExpiresAt` | Date   | `select: false`                                           |

### `workspaces`

| Field                 | Type     | Notes                                          |
| --------------------- | -------- | ---------------------------------------------- |
| `name`                | String   | Required, ≤ 80                                 |
| `ownerId`             | ObjectId | → User, indexed                                |
| `activeEnvironmentId` | ObjectId | → Environment in the same workspace, or `null` |

### `collections`

| Field         | Type     | Notes           |
| ------------- | -------- | --------------- |
| `workspaceId` | ObjectId | → Workspace     |
| `name`        | String   | Required, ≤ 120 |
| `description` | String   | ≤ 5000          |

Index: `{ workspaceId, name }`.

### `folders`

| Field          | Type     | Notes                                                                                              |
| -------------- | -------- | -------------------------------------------------------------------------------------------------- |
| `workspaceId`  | ObjectId | Indexed                                                                                            |
| `collectionId` | ObjectId | → Collection                                                                                       |
| `parentId`     | ObjectId | → Folder in the same collection, `null` at the root. Moves that would create a cycle are rejected. |
| `name`         | String   | Required, ≤ 120                                                                                    |

Index: `{ collectionId, parentId }`.

### `savedrequests`

| Field          | Type     | Notes                                      |
| -------------- | -------- | ------------------------------------------ |
| `workspaceId`  | ObjectId | Indexed                                    |
| `collectionId` | ObjectId | → Collection                               |
| `folderId`     | ObjectId | → Folder in the same collection, or `null` |
| `name`         | String   | Required, ≤ 120                            |
| _request spec_ |          | See below                                  |

Index: `{ collectionId, folderId }`.

### `environments`

| Field         | Type     | Notes                                                            |
| ------------- | -------- | ---------------------------------------------------------------- |
| `workspaceId` | ObjectId | → Workspace                                                      |
| `name`        | String   | Required, ≤ 80                                                   |
| `variables`   | Array    | `{ key, value, secret, enabled }`; keys unique, `[A-Za-z0-9_.-]` |

Index: `{ workspaceId, name }` **unique**. Secret values are never returned by the API.

### `requesthistories`

| Field          | Type     | Notes                                                 |
| -------------- | -------- | ----------------------------------------------------- |
| `workspaceId`  | ObjectId | → Workspace                                           |
| _request spec_ |          | Credentials redacted unless they are a `{{variable}}` |
| `response`     | Object   | `{ status, timeMs, sizeBytes, error }`                |

Indexes: `{ workspaceId, createdAt: -1 }`; TTL on `createdAt` (`HISTORY_RETENTION_DAYS`). At most `HISTORY_MAX_ENTRIES` per workspace; older entries are pruned on insert.

## Request spec

Shared by saved requests and history. Values may contain `{{variable}}` references; they are stored unresolved.

| Field        | Type   | Notes                                                                                                                         |
| ------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `method`     | String | `GET POST PUT PATCH DELETE HEAD OPTIONS`, default `GET`                                                                       |
| `url`        | String | ≤ 8192                                                                                                                        |
| `params`     | Array  | `{ key, value, enabled }`                                                                                                     |
| `headers`    | Array  | `{ key, value, enabled }`                                                                                                     |
| `auth`       | Object | `type`: `none` · `bearer` (`token`) · `basic` (`username`, `password`) · `apikey` (`key`, `value`, `addTo`: `header`/`query`) |
| `body`       | Object | `mode`: `none` · `json` · `raw` (text in `raw`) · `form-data` (`formData`) · `urlencoded` (`urlencoded`)                      |
| `captures`   | Array  | `{ variable, source: body·header·status, path, enabled }`: values saved to the active environment after a response            |
| `assertions` | Array  | `{ source: status·time·header·body, path, operator, expected, enabled }`: checks evaluated on the server                      |

Form-data supports text fields only in V1; file uploads are not stored.
