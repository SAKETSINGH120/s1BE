import mongoose from 'mongoose';
import { schemaOptions } from './schemaOptions.js';

const { ObjectId } = mongoose.Schema.Types;

const folderSchema = new mongoose.Schema(
  {
    workspaceId: { type: ObjectId, ref: 'Workspace', required: true, index: true },
    collectionId: { type: ObjectId, ref: 'Collection', required: true },
    // null means the folder sits at the collection root.
    parentId: { type: ObjectId, ref: 'Folder', default: null },
    name: { type: String, required: true, trim: true, maxlength: 120 },
  },
  schemaOptions,
);

folderSchema.index({ collectionId: 1, parentId: 1 });

export const Folder = mongoose.model('Folder', folderSchema);
