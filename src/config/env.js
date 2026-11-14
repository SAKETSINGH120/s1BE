import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { z } from 'zod';

// server/.env; variables already set in the real environment take precedence.
const envPath = fileURLToPath(new URL('../../.env', import.meta.url));
config({ path: envPath, quiet: true });

const optionalString = z
  .string()
  .trim()
  .transform((value) => value || undefined)
  .optional();

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    CLIENT_ORIGIN: z.url().default('http://localhost:5173'),
    MONGODB_URI: z.string().min(1).default('mongodb://127.0.0.1:27017/relay'),
    // Number of reverse proxies in front of the app; needed for correct client IPs in rate limiting.
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),

    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    // 32 random bytes, base64. Encrypts secret environment values at rest.
    SECRETS_ENCRYPTION_KEY: z
      .string()
      .refine(
        (value) => Buffer.from(value, 'base64').length === 32,
        'SECRETS_ENCRYPTION_KEY must be 32 random bytes encoded as base64',
      ),
    SESSION_TTL_DAYS: z.coerce.number().int().positive().max(30).default(7),
    PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().positive().max(1440).default(30),

    EXECUTION_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),
    EXECUTION_MAX_RESPONSE_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .max(50 * 1024 * 1024)
      .default(10 * 1024 * 1024),
    EXECUTION_MAX_REDIRECTS: z.coerce.number().int().min(0).max(10).default(5),
    // Self-hosting only: lets requests reach loopback/private ranges. Metadata endpoints stay blocked.
    EXECUTION_ALLOW_PRIVATE_NETWORKS: z.stringbool().default(false),

    HISTORY_MAX_ENTRIES: z.coerce.number().int().positive().max(1000).default(100),
    HISTORY_RETENTION_DAYS: z.coerce.number().int().positive().max(365).default(30),

    SMTP_HOST: optionalString,
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    SMTP_USER: optionalString,
    SMTP_PASS: optionalString,
    MAIL_FROM: optionalString,
  })
  .superRefine((values, ctx) => {
    if (values.NODE_ENV !== 'production') return;
    for (const key of ['SMTP_HOST', 'MAIL_FROM']) {
      if (!values[key]) {
        ctx.addIssue({ code: 'custom', path: [key], message: `${key} is required in production` });
      }
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}`);
}

export const env = Object.freeze({
  ...parsed.data,
  isProduction: parsed.data.NODE_ENV === 'production',
});
