import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { requestSpecFields } from './requestSpec.schema.js';
import { schemaOptions } from './schemaOptions.js';

const { ObjectId } = mongoose.Schema.Types;

const requestHistorySchema = new mongoose.Schema(
  {
    workspaceId: { type: ObjectId, ref: 'Workspace', required: true },
    ...requestSpecFields,
    response: {
      status: Number,
      timeMs: Number,
      sizeBytes: Number,
      error: { type: String, maxlength: 500 },
    },
  },
  { ...schemaOptions, timestamps: { createdAt: true, updatedAt: false } },
);

requestHistorySchema.index({ workspaceId: 1, createdAt: -1 });
requestHistorySchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: env.HISTORY_RETENTION_DAYS * 24 * 60 * 60 },
);

export const RequestHistory = mongoose.model('RequestHistory', requestHistorySchema);
