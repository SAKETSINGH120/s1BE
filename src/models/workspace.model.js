import mongoose from 'mongoose';
import { schemaOptions } from './schemaOptions.js';

const { ObjectId } = mongoose.Schema.Types;

const workspaceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    ownerId: { type: ObjectId, ref: 'User', required: true, index: true },
    activeEnvironmentId: { type: ObjectId, ref: 'Environment', default: null },
  },
  schemaOptions,
);

export const Workspace = mongoose.model('Workspace', workspaceSchema);
