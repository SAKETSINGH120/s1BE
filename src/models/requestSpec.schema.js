import mongoose from 'mongoose';

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
export const AUTH_TYPES = ['none', 'bearer', 'basic', 'apikey'];
export const BODY_MODES = ['none', 'json', 'raw', 'form-data', 'urlencoded'];
export const CHECK_SOURCES = ['status', 'time', 'header', 'body'];
export const CAPTURE_SOURCES = ['status', 'header', 'body'];
export const ASSERTION_OPERATORS = [
  'equals',
  'notEquals',
  'contains',
  'lessThan',
  'greaterThan',
  'isType',
  'exists',
  'notExists',
];

// Saves a value from the response into the active environment, e.g. $.token → {{token}}.
const captureSchema = new mongoose.Schema(
  {
    variable: { type: String, default: '' },
    source: { type: String, enum: CAPTURE_SOURCES, default: 'body' },
    path: { type: String, default: '' },
    enabled: { type: Boolean, default: true },
  },
  { _id: false },
);

// A check on the response, e.g. status equals 200 or $.id exists.
const assertionSchema = new mongoose.Schema(
  {
    source: { type: String, enum: CHECK_SOURCES, default: 'status' },
    path: { type: String, default: '' },
    operator: { type: String, enum: ASSERTION_OPERATORS, default: 'equals' },
    expected: { type: String, default: '' },
    enabled: { type: Boolean, default: true },
  },
  { _id: false },
);

const keyValueSchema = new mongoose.Schema(
  {
    key: { type: String, default: '' },
    value: { type: String, default: '' },
    enabled: { type: Boolean, default: true },
  },
  { _id: false },
);

const authSchema = new mongoose.Schema(
  {
    type: { type: String, enum: AUTH_TYPES, default: 'none' },
    token: String,
    username: String,
    password: String,
    key: String,
    value: String,
    addTo: { type: String, enum: ['header', 'query'] },
  },
  { _id: false },
);

const bodySchema = new mongoose.Schema(
  {
    mode: { type: String, enum: BODY_MODES, default: 'none' },
    raw: { type: String, default: '' },
    formData: { type: [keyValueSchema], default: [] },
    urlencoded: { type: [keyValueSchema], default: [] },
  },
  { _id: false },
);

// The editable definition of an HTTP request, shared by saved requests and history.
export const requestSpecFields = {
  method: { type: String, enum: HTTP_METHODS, default: 'GET' },
  url: { type: String, default: '', maxlength: 8192 },
  params: { type: [keyValueSchema], default: [] },
  headers: { type: [keyValueSchema], default: [] },
  auth: { type: authSchema, default: () => ({}) },
  body: { type: bodySchema, default: () => ({}) },
  captures: { type: [captureSchema], default: [] },
  assertions: { type: [assertionSchema], default: [] },
};
