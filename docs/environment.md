# Environment variables

The API reads `server/.env` (copy `.env.example`); variables set in the real environment take precedence. They are validated at startup, and the server refuses to start if any are invalid.

The web app has its own `client/.env` with a single development setting, `VITE_API_PROXY_TARGET` (see the client README).

## Server

| Variable        | Default                           | Description                                                                                                                |
| --------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`      | `development`                     | `development`, `test` or `production`. Production enables `Secure` cookies and requires SMTP settings.                     |
| `PORT`          | `4000`                            | Port the API listens on.                                                                                                   |
| `CLIENT_ORIGIN` | `http://localhost:5173`           | Frontend origin. The only origin CORS allows credentials from, and the base URL of password reset links.                   |
| `MONGODB_URI`   | `mongodb://127.0.0.1:27017/relay` | MongoDB connection string. The server exits if it cannot connect at startup.                                               |
| `TRUST_PROXY`   | `0`                               | Number of reverse proxies in front of the API. Set it correctly behind a load balancer so rate limits see real client IPs. |

## Authentication

| Variable                     | Default    | Description                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JWT_SECRET`                 | (required) | At least 32 characters. Signs session tokens; changing it logs everyone out. Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`                                                                                                                                                                        |
| `SECRETS_ENCRYPTION_KEY`     | (required) | 32 random bytes, base64. Encrypts secret environment values at rest (AES-256-GCM). **Back it up**: losing or changing it makes stored secrets unreadable. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. After first setting it on an existing database, run `npm run migrate:encrypt-secrets` once. |
| `SESSION_TTL_DAYS`           | `7`        | Session lifetime (1–30).                                                                                                                                                                                                                                                                                                                       |
| `PASSWORD_RESET_TTL_MINUTES` | `30`       | How long a reset link stays valid.                                                                                                                                                                                                                                                                                                             |

## Request execution

| Variable                           | Default    | Description                                                                                                                                                                                  |
| ---------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EXECUTION_TIMEOUT_MS`             | `30000`    | Total time allowed for a request, including redirects (1000–120000).                                                                                                                         |
| `EXECUTION_MAX_RESPONSE_BYTES`     | `10485760` | Maximum decoded response body (10 MB, up to 50 MB). Larger bodies are truncated.                                                                                                             |
| `EXECUTION_MAX_REDIRECTS`          | `5`        | Redirects followed before failing (0–10).                                                                                                                                                    |
| `EXECUTION_ALLOW_PRIVATE_NETWORKS` | `false`    | **Self-hosting only.** Allows loopback and private ranges (e.g. testing a local API). Cloud metadata, link-local and reserved ranges stay blocked. Never enable on a shared/SaaS deployment. |

## History

| Variable                 | Default | Description                                                                                                                    |
| ------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `HISTORY_MAX_ENTRIES`    | `100`   | Entries kept per workspace (1–1000); older ones are pruned when a new one is recorded.                                         |
| `HISTORY_RETENTION_DAYS` | `30`    | Entries older than this are removed by a MongoDB TTL index (1–365). Changing it requires dropping the old `createdAt_1` index. |

## Email

Required in production. In development, if `SMTP_HOST` is empty, emails such as password reset links are printed to the server console instead of being sent.

| Variable    | Default | Description                                                     |
| ----------- | ------- | --------------------------------------------------------------- |
| `SMTP_HOST` | –       | SMTP server host.                                               |
| `SMTP_PORT` | `587`   | `465` uses implicit TLS; other ports use STARTTLS when offered. |
| `SMTP_USER` | –       | SMTP username, if the server requires authentication.           |
| `SMTP_PASS` | –       | SMTP password.                                                  |
| `MAIL_FROM` | –       | Sender address, e.g. `Relay <no-reply@example.com>`.            |

New variables are added to this file, `.env.example` and the Zod schema in `src/config/env.js` together.
