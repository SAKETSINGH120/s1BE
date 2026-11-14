import mongoose from 'mongoose';
import { schemaOptions } from './schemaOptions.js';

const { ObjectId } = mongoose.Schema.Types;

const collectionSchema = new mongoose.Schema(
  {
    workspaceId: { type: ObjectId, ref: 'Workspace', required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: '', maxlength: 5000 },
  },
  schemaOptions,
);

collectionSchema.index({ workspaceId: 1, name: 1 });

export const Collection = mongoose.model('Collection', collectionSchema);
