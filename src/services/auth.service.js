import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { User } from '../models/user.model.js';
import { AppError } from '../utils/AppError.js';
import { sendPasswordResetEmail } from './email.service.js';
import { createWorkspace, DEFAULT_WORKSPACE_NAME } from './workspace.service.js';

const BCRYPT_ROUNDS = env.NODE_ENV === 'test' ? 4 : 12;
const JWT_ALGORITHM = 'HS256';
const INVALID_CREDENTIALS = 'Invalid email or password';

// Compared against when the email is unknown so both login failure paths take similar time.
let dummyHashPromise;
function getDummyHash() {
  dummyHashPromise ??= bcrypt.hash(crypto.randomBytes(16).toString('hex'), BCRYPT_ROUNDS);
  return dummyHashPromise;
}

function hashResetToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function registerUser({ name, email, password }) {
  if (await User.exists({ email })) {
    throw new AppError(409, 'An account with this email already exists');
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const user = await User.create({ name, email, passwordHash });
  await createWorkspace(user._id, { name: DEFAULT_WORKSPACE_NAME });
  return user;
}

export async function authenticateUser({ email, password }) {
  const user = await User.findOne({ email }).select('+passwordHash');
  const isValid = await bcrypt.compare(password, user?.passwordHash ?? (await getDummyHash()));

  if (!user || !isValid) {
    throw new AppError(401, INVALID_CREDENTIALS);
  }
  return user;
}

export function createSessionToken(user) {
  return jwt.sign({ sv: user.sessionVersion }, env.JWT_SECRET, {
    subject: user.id,
    algorithm: JWT_ALGORITHM,
    expiresIn: env.SESSION_TTL_DAYS * 24 * 60 * 60,
  });
}

export async function findUserBySessionToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET, { algorithms: [JWT_ALGORITHM] });
  } catch {
    return null;
  }

  if (!mongoose.isObjectIdOrHexString(payload.sub)) return null;

  const user = await User.findById(payload.sub);
  return user && user.sessionVersion === payload.sv ? user : null;
}

async function issuePasswordReset(user) {
  const token = crypto.randomBytes(32).toString('base64url');
  user.passwordResetTokenHash = hashResetToken(token);
  user.passwordResetExpiresAt = new Date(Date.now() + env.PASSWORD_RESET_TTL_MINUTES * 60 * 1000);
  await user.save();

  const resetUrl = new URL('/reset-password', env.CLIENT_ORIGIN);
  resetUrl.searchParams.set('token', token);
  await sendPasswordResetEmail(user.email, resetUrl.toString());
}

// Known and unknown emails get the same response at the same speed: the token is stored and the
// email sent in the background, so timing does not reveal whether an account exists.
export async function requestPasswordReset(email) {
  const user = await User.findOne({ email });
  if (!user) return;

  issuePasswordReset(user).catch((error) => {
    console.error('Failed to issue password reset', error);
  });
}

export async function resetPassword({ token, password }) {
  const user = await User.findOne({
    passwordResetTokenHash: hashResetToken(token),
    passwordResetExpiresAt: { $gt: new Date() },
  });

  if (!user) {
    throw new AppError(400, 'This reset link is invalid or has expired');
  }

  user.passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  user.passwordResetTokenHash = undefined;
  user.passwordResetExpiresAt = undefined;
  user.sessionVersion += 1;
  await user.save();
}
