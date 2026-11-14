# Relay API

The backend of Relay, an API client for developers: authentication, workspaces, collections, environments, history, and the execution engine that sends users' HTTP requests with SSRF protection.

The web app is a separate project, `relay-client`. It talks to this API over HTTP under `/api/v1`.

## Stack

Node.js 20.19+, Express 5, MongoDB 8 with Mongoose 9, Zod, JWT in HTTP-only cookies, bcrypt, Helmet. Tests: Vitest and Supertest against an in-memory MongoDB.

## Getting started

```bash
npm install
cp .env.example .env
# set JWT_SECRET and SECRETS_ENCRYPTION_KEY (generator commands are in .env.example)
npm run db:up        # MongoDB in Docker on 127.0.0.1:27017 (or use your own MONGODB_URI)
npm run dev          # API on http://localhost:4000, restarts on changes in src/
```

In development, password reset emails are printed to the console unless SMTP is configured.

`npm install` downloads a MongoDB binary for the tests (several hundred MB, cached in `node_modules/.cache`).

## Scripts

| Script                            | Purpose                                                |
| --------------------------------- | ------------------------------------------------------ |
| `npm run dev`                     | Start the API, restarting on source changes            |
| `npm start`                       | Start the API without file watching                    |
| `npm test`                        | Run the test suite                                     |
| `npm run lint`                    | ESLint                                                 |
| `npm run format` / `format:check` | Prettier                                               |
| `npm run db:up` / `db:down`       | Start / stop the local MongoDB container               |
| `npm run migrate:encrypt-secrets` | One-off: encrypt secret values stored before key setup |

## Documentation

- [Architecture](docs/architecture.md)
- [Environment variables](docs/environment.md)
- [API reference](docs/api.md)
- [Database schema](docs/database.md)
