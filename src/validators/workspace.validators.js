import { z } from 'zod';
import { displayName, nullableObjectId } from './common.validators.js';

export const createWorkspaceSchema = z.object({ name: displayName(80) });

export const updateWorkspaceSchema = z.object({
  name: displayName(80).optional(),
  activeEnvironmentId: nullableObjectId.optional(),
});
