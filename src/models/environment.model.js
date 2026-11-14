import mongoose from 'mongoose';
import { encryptSecret, isEncrypted } from '../utils/secretBox.js';
import { schemaOptions } from './schemaOptions.js';

const { ObjectId } = mongoose.Schema.Types;

const variableSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    value: { type: String, default: '' },
    // Secret values are write-only through the API and only used server-side.
    secret: { type: Boolean, default: false },
    enabled: { type: Boolean, default: true },
  },
  { _id: false },
);

const environmentSchema = new mongoose.Schema(
  {
    workspaceId: { type: ObjectId, ref: 'Workspace', required: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    variables: { type: [variableSchema], default: [] },
  },
  schemaOptions,
);

environmentSchema.index({ workspaceId: 1, name: 1 }, { unique: true });

// Secret values are encrypted at rest. Every write path (create, edit, captures) goes through save,
// so encrypting here covers all of them; already-encrypted values are left alone.
environmentSchema.pre('save', function encryptSecrets() {
  for (const variable of this.variables) {
    if (variable.secret && variable.value && !isEncrypted(variable.value)) {
      variable.value = encryptSecret(variable.value);
    }
  }
});

export const Environment = mongoose.model('Environment', environmentSchema);
