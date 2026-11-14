// Shared options: timestamps, and JSON output with `id` instead of `_id`/`__v`.
export const schemaOptions = {
  timestamps: true,
  toJSON: {
    virtuals: true,
    versionKey: false,
    transform: (doc, ret) => {
      delete ret._id;
      return ret;
    },
  },
};
