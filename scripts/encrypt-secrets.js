// Encrypts secret environment values that were stored before encryption at rest existed.
// Safe to run more than once: values that are already encrypted are skipped.
// Usage: npm run migrate:encrypt-secrets
import { connectDatabase, disconnectDatabase } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import { Environment } from '../src/models/environment.model.js';
import { isEncrypted } from '../src/utils/secretBox.js';

await connectDatabase(env.MONGODB_URI);

const candidates = await Environment.find({ 'variables.secret': true });
let updated = 0;
for (const environment of candidates) {
  const needsEncryption = environment.variables.some(
    (variable) => variable.secret && variable.value && !isEncrypted(variable.value),
  );
  if (needsEncryption) {
    await environment.save(); // the model's save hook encrypts the values
    updated += 1;
  }
}

console.log(`Checked ${candidates.length} environment(s); encrypted secrets in ${updated}.`);
await disconnectDatabase();
