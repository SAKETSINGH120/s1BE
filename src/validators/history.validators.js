import { z } from 'zod';
import { requestSpecShape } from './request.validators.js';

export const createHistorySchema = z.object({
  ...requestSpecShape,
  method: requestSpecShape.method.unwrap(),
  url: requestSpecShape.url.unwrap().min(1, 'URL is required'),
  response: z
    .object({
      status: z.number().int().min(0).max(999).optional(),
      timeMs: z.number().min(0).optional(),
      sizeBytes: z.number().int().min(0).optional(),
      error: z.string().max(500).optional(),
    })
    .optional(),
});
