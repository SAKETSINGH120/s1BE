# Architecture

Relay's API: an Express REST API under `/api/v1`, backed by MongoDB. The web app lives in a separate project (`relay-client`) and talks to this API only over HTTP.

The browser never calls third-party APIs directly. Requests a user builds are sent to the execution engine here, which performs them with SSRF protections and returns the result. This avoids browser CORS limits and keeps secrets and network policy on the server.

```
Browser ──/api/v1──▶ Express API ──▶ MongoDB
                        │
                        └──▶ Execution engine ──▶ target API (public internet only)
```

## Layout

```
server/
├── src/
│   ├── config/        env.js (Zod-validated env), db.js (Mongoose connection)
│   ├── routes/        URL → middleware chain → controller
│   ├── controllers/   HTTP only: read req, call a service, shape the response
│   ├── services/      Business logic and all database access
│   ├── models/        Mongoose schemas
│   ├── validators/    Zod request schemas
│   ├── middlewares/   auth, validation, rate limiting, 404 + central error handler
│   ├── utils/         AppError, session cookie helpers
│   ├── app.js         Builds the Express app (no network listener; used by tests)
│   └── server.js      Connects MongoDB, starts the listener, handles shutdown
└── tests/             Vitest + Supertest against an in-memory MongoDB
```

A request flows `route → validateBody → (requireAuth) → controller → service → model`. Errors thrown anywhere reach the central error handler.

## Request execution engine

`server/src/services/execution/`:

| File                   | Responsibility                                                                                                                                                                                  |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `buildRequest.js`      | Resolves `{{variables}}` (single pass, no recursion), appends params, applies auth, encodes the body (JSON, raw, urlencoded, multipart), validates headers and drops hop-by-hop/`Host` headers. |
| `networkPolicy.js`     | URL validation and the SSRF policy: address classification, IP-literal checks and the safe DNS lookup.                                                                                          |
| `httpClient.js`        | Sends with Node `http`/`https`: redirects, total timeout, decompression with a post-decompression size cap, error mapping.                                                                      |
| `execution.service.js` | Loads environment variables, runs the above, formats the response, records history.                                                                                                             |

**SSRF defence in depth**

1. Only `http`/`https`; credentials in URLs are rejected. The WHATWG URL parser normalizes tricks like `http://2130706433` or `http://0x7f.1` to `127.0.0.1` before checks.
2. IP-literal hosts are classified before connecting.
3. Hostnames go through a custom `lookup` passed to `http.request`: **every** resolved address must be allowed, and the socket connects to exactly the address that was checked, so DNS rebinding between check and connect is not possible. `agent: false` gives each request its own socket, so no pooled connection can skip the check.
4. Every redirect hop repeats steps 1–3. Cross-origin redirects drop `Authorization`, `Cookie` and `Proxy-Authorization`.
5. Blocked: loopback, RFC 1918, CGNAT, ULA (private; allowed only with `EXECUTION_ALLOW_PRIVATE_NETWORKS`), plus always: unspecified, link-local, cloud metadata (`169.254.169.254`, `fd00:ec2::254`, `100.100.100.200`), IPv4-mapped/NAT64/6to4/Teredo IPv6, documentation, benchmarking, multicast and reserved ranges.
6. Secret environment values are encrypted at rest with AES-256-GCM (`utils/secretBox.js`, key from `SECRETS_ENCRYPTION_KEY`). The Environment model's save hook encrypts them on every write path; they are decrypted only when a request runs.
7. Only headers from the request definition are sent; the caller's cookies and headers are never forwarded.
8. Limits: total timeout, decoded response size cap (defeats compression bombs), redirect cap, 60 executions per minute per user, 1 MB request body.

No user code runs on the server, and there is no filesystem access: bodies come only from the request definition.

## Import and export

`server/src/services/postman/` holds two pure, database-free converters: `postmanImport.js` (validates with Zod, walks the item tree, applies inherited auth, collects warnings, re-validates every request with the normal request schema) and `postmanExport.js`. `collectionTransfer.service.js` does the database work: it generates ObjectIds up front so the whole tree is written with two `insertMany` calls, and deletes the partial collection if any step fails. The import route has its own 5 MB JSON parser, registered before the global 1 MB one.

## History

The server records history for every execution: the unresolved request (with `{{references}}`, credentials redacted), status, timing and size. Entries are capped per workspace (`HISTORY_MAX_ENTRIES`) and expire through a TTL index.

## Tests and captures

Assertions and captures run on the server after each execution (`services/execution/responseChecks.js`, JSONPath subset in `utils/jsonPath.js`), because captured values may be secrets: they are written to the active environment and only their names come back. The collection runner is client-side (`RunnerDialog`): it fetches each saved request in sidebar order and calls `/execute` one at a time, so captures from one request are available to the next, and progress and cancelling are immediate. Large runs count against the per-user execution rate limit.

**Hardening from the Phase 9 review**

- Compressed response bodies are decoded with `stream.pipeline`, and the response is destroyed when the request is aborted, so a stalled or truncated gzip stream can no longer outlive the timeout.
- Headers added by the auth settings (including API-key headers) are dropped on cross-origin redirects, like `Authorization` and `Cookie`.
- IPv4-compatible IPv6 literals (`::a.b.c.d`) are blocked; unparseable redirect locations fail with `INVALID_REDIRECT`.
- Forgot-password stores the token and sends the email in the background, so response time does not reveal whether an account exists.
- The server never carries a stored secret value into a variable that is no longer secret.
- The import route checks the session before parsing its larger (5 MB) body. Malformed Postman entries are skipped instead of causing a 500; imported variables follow the environment rules.

## Key decisions

| Decision                               | Reason                                                                                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `createApp()` separate from `listen()` | Tests exercise the real app through Supertest without opening ports.                                                                                   |
| Express 5                              | Rejected promises in async handlers reach the error handler automatically, so no `asyncHandler` wrapper is needed.                                     |
| Env validated at startup with Zod      | Misconfiguration fails fast with a readable message instead of failing at first use.                                                                   |
| Central error handler                  | Only errors explicitly marked safe (`expose`, status < 500) return their message; everything else returns a generic message and is logged server-side. |
| `node --watch-path=src`                | Restarts only on source changes; plain `--watch` also reacted to lazily loaded dependency files and restarted mid-request on Windows/OneDrive.         |
| ES modules everywhere                  | Same module syntax on client and server.                                                                                                               |

## Authentication and security

- **Sessions.** On register/login the server signs a JWT (HS256, `sub` = user id, `sv` = session version) and stores it in the `relay_session` cookie: `HttpOnly`, `SameSite=Lax`, `Secure` in production. The browser's JavaScript never sees the token.
- **Session revocation.** Each user has a `sessionVersion`. A password reset increments it, which invalidates every existing session. Logout clears the cookie on that device only.
- **CSRF.** `SameSite=Lax` stops browsers from sending the cookie on cross-site `POST`/`PUT`/`PATCH`/`DELETE`, and the API only accepts JSON bodies. CORS allows credentials only from `CLIENT_ORIGIN`.
- **Passwords.** bcrypt with cost 12. Passwords are limited to 72 bytes, bcrypt's input limit, so no characters are silently ignored.
- **No account enumeration.** Login returns the same error for an unknown email and a wrong password, and still runs a bcrypt comparison when the email is unknown so response times match. Forgot-password always returns the same message.
- **Password reset.** 32 random bytes, emailed as a link; only the SHA-256 hash is stored. Single use, expires after `PASSWORD_RESET_TTL_MINUTES`.
- **Hardening.** Helmet headers, a 1 MB JSON body limit, and rate limits per IP (600 requests per 15 min on `/api`, 20 per 15 min on login, register, forgot-password and reset-password). Validation strips unknown fields, so clients cannot set fields such as `sessionVersion`.
- **Errors.** Clients receive `{ error: { message, details? } }`. Stack traces and internal messages are only logged.

## Known limitations and accepted risks

| Item                                                            | Notes                                                                                                                                                                                                                                   |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Logout is per device                                            | JWTs stay valid until expiry unless the password is reset (`sessionVersion`).                                                                                                                                                           |
| `/auth/register` returns 409 for taken emails                   | Reveals that an account exists; accepted for usability. Rate limited.                                                                                                                                                                   |
| No transactions                                                 | Deletes and imports clean up children/partial data, but are not atomic.                                                                                                                                                                 |
| Form-data without files, no TLS-verification toggle, no scripts | Out of scope for V1.                                                                                                                                                                                                                    |
| `npm audit`: 4 moderate                                         | All in `minimatch` inside ESLint (development only, never shipped or run on the server). The patched `minimatch` 11 is outside ESLint 10's supported range and breaks linting when forced via `overrides`. Revisit when ESLint updates. |
| Node.js 20                                                      | End of life since April 2026. The project pins Node-20-compatible tooling (Vitest 4); upgrading to Node 22 LTS lets these move forward.                                                                                                 |

## Mocks and chaos mode

`MockRoute` documents belong to a workspace; the workspace's random `mockKey` (96 bits) is the only thing that makes its public mock URLs private. `routes/mock.routes.js` is mounted before the global CORS, rate limit and JSON parser, with its own open CORS and per-key limit. `mock.service.js` matches paths (`:params`, most specific first), fills body templates, and keeps the simulated per-minute rate limit in memory (each server instance counts on its own). Hit counts are updated without blocking the response. Mocks are deleted with their workspace or account and included in the account export.
