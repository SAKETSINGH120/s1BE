import crypto from 'node:crypto';
import { env } from '../config/env.js';

// Format: "v1:" + base64(iv | auth tag | ciphertext), AES-256-GCM with a 96-bit random IV.
const PREFIX = 'v1:';
const IV_BYTES = 12;
const TAG_BYTES = 16;

let cachedKey;
function key() {
  cachedKey ??= Buffer.from(env.SECRETS_ENCRYPTION_KEY, 'base64');
  return cachedKey;
}

export function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

export function encryptSecret(plaintext) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

/**
 * Returns the plaintext. Values stored before encryption existed are returned unchanged, so old
 * data keeps working until it is next saved (or migrated with scripts/encrypt-secrets.js).
 */
export function decryptSecret(value) {
  if (!isEncrypted(value)) return value;
  const data = Buffer.from(value.slice(PREFIX.length), 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), data.subarray(0, IV_BYTES));
  decipher.setAuthTag(data.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  return Buffer.concat([
    decipher.update(data.subarray(IV_BYTES + TAG_BYTES)),
    decipher.final(),
  ]).toString('utf8');
}
