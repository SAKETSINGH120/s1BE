import { z } from 'zod';
import { MOCK_FAILURE_STATUSES, MOCK_METHODS } from '../models/mockRoute.model.js';

export const MAX_MOCK_BODY_LENGTH = 256 * 1024;

// Headers the server controls: security headers that keep mocks harmless, CORS, framing and
// cookies (a mock must never set cookies on the API's own domain).
const RESERVED_HEADER =
  /^(set-cookie|content-length|transfer-encoding|connection|keep-alive|upgrade|trailer|te|content-security-policy(-report-only)?|x-content-type-options|strict-transport-security|access-control-.*|cross-origin-.*|proxy-.*)$/i;
export const isReservedMockHeader = (name) => RESERVED_HEADER.test(name);

const HEADER_NAME = /^[!#$%&'*+.^_`|~\w-]+$/;
const PATH_SEGMENT = /^(:[A-Za-z_]\w*|[\w\-.~%@!$&'()*+,;=]+)$/;

// "/orders/:id/" -> "/orders/:id"; "orders" -> "/orders"; "" or "/" -> "/".
export function normalizeMockPath(path) {
  const segments = path.trim().split('/').filter(Boolean);
  return `/${segments.join('/')}`;
}

const mockPath = z
  .string()
  .trim()
  .max(300)
  .transform(normalizeMockPath)
  .refine(
    (path) =>
      path === '/' ||
      path
        .slice(1)
        .split('/')
        .every((segment) => PATH_SEGMENT.test(segment)),
    'Use a path like /orders or /orders/:id (letters, numbers, - _ . and :params)',
  );

const headers = z
  .array(
    z.object({
      key: z
        .string()
        .trim()
        .min(1, 'Header name is required')
        .max(256)
        .regex(HEADER_NAME, 'Invalid header name')
        .refine(
          (key) => !RESERVED_HEADER.test(key),
          'This header is set by Reqora and cannot be changed',
        ),
      value: z
        .string()
        .max(8_192)
        .refine((value) => !/[\r\n]/.test(value), 'Header values cannot contain line breaks'),
    }),
  )
  .max(50);

const chaos = z.object({
  delayMs: z.number().int().min(0).max(10_000).optional(),
  failureRate: z.number().int().min(0).max(100).optional(),
  failureStatus: z
    .number()
    .int()
    .refine((status) => MOCK_FAILURE_STATUSES.includes(status), 'Unsupported failure status')
    .optional(),
  rateLimitPerMinute: z.number().int().min(0).max(10_000).optional(),
});

export const createMockSchema = z.object({
  name: z.string().trim().max(120).optional(),
  method: z.enum(MOCK_METHODS).optional(),
  path: mockPath,
  status: z.number().int().min(100).max(599).optional(),
  headers: headers.optional(),
  body: z.string().max(MAX_MOCK_BODY_LENGTH, 'Mock bodies can be up to 256 KB').optional(),
  enabled: z.boolean().optional(),
  chaos: chaos.optional(),
});

export const updateMockSchema = createMockSchema.partial();
