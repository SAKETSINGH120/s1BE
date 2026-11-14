import { z } from 'zod';
import { nullableObjectId } from './common.validators.js';
import { requestSpecShape } from './request.validators.js';

export const executeRequestSchema = z.object({
  ...requestSpecShape,
  method: requestSpecShape.method.unwrap(),
  url: requestSpecShape.url.unwrap().min(1, 'URL is required'),
  // Omitted: use the workspace's active environment. null: resolve no variables.
  environmentId: nullableObjectId.optional(),
  followRedirects: z.boolean().optional(),
});
