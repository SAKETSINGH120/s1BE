import { z } from 'zod';
import {
  ASSERTION_OPERATORS,
  BODY_MODES,
  CAPTURE_SOURCES,
  CHECK_SOURCES,
  HTTP_METHODS,
} from '../models/requestSpec.schema.js';
import { displayName, nullableObjectId, objectId } from './common.validators.js';

const keyValueList = z
  .array(
    z.object({
      key: z.string().max(1024),
      value: z.string().max(16_384),
      enabled: z.boolean().optional(),
    }),
  )
  .max(200);

const auth = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }),
  z.object({ type: z.literal('bearer'), token: z.string().max(16_384) }),
  z.object({
    type: z.literal('basic'),
    username: z.string().max(1024),
    password: z.string().max(1024),
  }),
  z.object({
    type: z.literal('apikey'),
    key: z.string().max(1024),
    value: z.string().max(16_384),
    addTo: z.enum(['header', 'query']),
  }),
]);

const body = z.object({
  mode: z.enum(BODY_MODES),
  raw: z.string().max(1_000_000).optional(),
  formData: keyValueList.optional(),
  urlencoded: keyValueList.optional(),
});

// Empty names are allowed so half-filled rows can be saved; they are skipped when running.
const captures = z
  .array(
    z.object({
      variable: z
        .string()
        .trim()
        .max(256)
        .regex(/^[\w.-]*$/, 'Use letters, numbers, "_", "-" or "."'),
      source: z.enum(CAPTURE_SOURCES),
      path: z.string().max(512),
      enabled: z.boolean().optional(),
    }),
  )
  .max(20);

const assertions = z
  .array(
    z.object({
      source: z.enum(CHECK_SOURCES),
      path: z.string().max(512),
      operator: z.enum(ASSERTION_OPERATORS),
      expected: z.string().max(1024).optional(),
      enabled: z.boolean().optional(),
    }),
  )
  .max(50);

// All optional: omitted fields fall back to model defaults on create and stay unchanged on update.
export const requestSpecShape = {
  method: z.enum(HTTP_METHODS).optional(),
  url: z.string().trim().max(8192).optional(),
  params: keyValueList.optional(),
  headers: keyValueList.optional(),
  auth: auth.optional(),
  body: body.optional(),
  captures: captures.optional(),
  assertions: assertions.optional(),
};

export const createSavedRequestSchema = z.object({
  name: displayName(120),
  collectionId: objectId,
  folderId: nullableObjectId.optional(),
  ...requestSpecShape,
});

export const updateSavedRequestSchema = createSavedRequestSchema.partial();
