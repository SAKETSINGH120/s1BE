import mongoose from 'mongoose';
import { schemaOptions } from './schemaOptions.js';

const { ObjectId } = mongoose.Schema.Types;

export const MOCK_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
// Statuses a simulated failure can answer with.
export const MOCK_FAILURE_STATUSES = [500, 502, 503, 504, 429];

const headerSchema = new mongoose.Schema(
  { key: { type: String, required: true }, value: { type: String, default: '' } },
  { _id: false },
);

// Chaos settings make a mock misbehave on purpose, to test how a client copes with a bad API.
const chaosSchema = new mongoose.Schema(
  {
    delayMs: { type: Number, default: 0, min: 0, max: 10_000 },
    failureRate: { type: Number, default: 0, min: 0, max: 100 },
    failureStatus: { type: Number, enum: MOCK_FAILURE_STATUSES, default: 500 },
    rateLimitPerMinute: { type: Number, default: 0, min: 0, max: 10_000 },
  },
  { _id: false },
);

// One mocked endpoint, served publicly at /api/v1/m/<workspace mock key><path>.
const mockRouteSchema = new mongoose.Schema(
  {
    workspaceId: { type: ObjectId, ref: 'Workspace', required: true, index: true },
    name: { type: String, trim: true, maxlength: 120, default: '' },
    method: { type: String, enum: MOCK_METHODS, default: 'GET' },
    // Normalized: leading slash, no trailing slash; ":name" segments match any value.
    path: { type: String, required: true },
    status: { type: Number, default: 200, min: 100, max: 599 },
    headers: { type: [headerSchema], default: [] },
    body: { type: String, default: '' },
    enabled: { type: Boolean, default: true },
    chaos: { type: chaosSchema, default: () => ({}) },
    hits: { type: Number, default: 0 },
    lastHitAt: { type: Date, default: null },
  },
  schemaOptions,
);

mockRouteSchema.index({ workspaceId: 1, method: 1, path: 1 }, { unique: true });

export const MockRoute = mongoose.model('MockRoute', mockRouteSchema);
