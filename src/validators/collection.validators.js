import { z } from 'zod';
import { displayName, nullableObjectId, objectId } from './common.validators.js';

const description = z.string().max(5000);

export const createCollectionSchema = z.object({
  name: displayName(120),
  description: description.optional(),
});

export const updateCollectionSchema = createCollectionSchema.partial();

export const createFolderSchema = z.object({
  name: displayName(120),
  collectionId: objectId,
  parentId: nullableObjectId.optional(),
});

export const updateFolderSchema = z.object({
  name: displayName(120).optional(),
  parentId: nullableObjectId.optional(),
});
