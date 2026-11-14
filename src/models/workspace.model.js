import mongoose from 'mongoose';
import { schemaOptions } from './schemaOptions.js';

const { ObjectId } = mongoose.Schema.Types;

const workspaceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    ownerId: { type: ObjectId, ref: 'User', required: true, index: true },
    activeEnvironmentId: { type: ObjectId, ref: 'Environment', default: null },
    // Public, unguessable part of the workspace's mock URLs; created when mocks are first used.
    mockKey: { type: String, default: null },
  },
  schemaOptions,
);

workspaceSchema.index(
  { mockKey: 1 },
  { unique: true, partialFilterExpression: { mockKey: { $type: 'string' } } },
);

export const Workspace = mongoose.model('Workspace', workspaceSchema);
