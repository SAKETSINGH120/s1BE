import mongoose from 'mongoose';
import { requestSpecFields } from './requestSpec.schema.js';
import { schemaOptions } from './schemaOptions.js';

const { ObjectId } = mongoose.Schema.Types;

const savedRequestSchema = new mongoose.Schema(
  {
    workspaceId: { type: ObjectId, ref: 'Workspace', required: true, index: true },
    collectionId: { type: ObjectId, ref: 'Collection', required: true },
    // null means the request sits at the collection root.
    folderId: { type: ObjectId, ref: 'Folder', default: null },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    ...requestSpecFields,
  },
  schemaOptions,
);

savedRequestSchema.index({ collectionId: 1, folderId: 1 });

export const SavedRequest = mongoose.model('SavedRequest', savedRequestSchema);
