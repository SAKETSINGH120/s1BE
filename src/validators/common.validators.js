import { z } from 'zod';

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

export const nullableObjectId = objectId.nullable();

export function displayName(maxLength) {
  return z.string().trim().min(1, 'Name is required').max(maxLength);
}
