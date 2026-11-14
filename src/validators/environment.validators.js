import { z } from 'zod';
import { displayName } from './common.validators.js';

const variables = z
  .array(
    z.object({
      key: z
        .string()
        .trim()
        .min(1, 'Variable name is required')
        .max(256)
        .regex(/^[\w.-]+$/, 'Use letters, numbers, "_", "-" or "."'),
      // Omitting the value on update keeps the stored one, so secrets need not be re-sent.
      value: z.string().max(16_384).optional(),
      secret: z.boolean().optional(),
      enabled: z.boolean().optional(),
    }),
  )
  .max(500)
  .refine(
    (list) => new Set(list.map((variable) => variable.key)).size === list.length,
    'Variable names must be unique',
  );

export const createEnvironmentSchema = z.object({
  name: displayName(80),
  variables: variables.optional(),
});

export const updateEnvironmentSchema = createEnvironmentSchema.partial();
