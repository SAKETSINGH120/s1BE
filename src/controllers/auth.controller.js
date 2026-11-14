import * as authService from '../services/auth.service.js';
import * as accountService from '../services/account.service.js';
import { clearSessionCookie, setSessionCookie } from '../utils/sessionCookie.js';

const RESET_REQUESTED_MESSAGE =
  'If an account exists for that email, a password reset link has been sent.';

function startSession(res, user) {
  setSessionCookie(res, authService.createSessionToken(user));
}

export async function register(req, res) {
  const user = await authService.registerUser(req.body);
  startSession(res, user);
  res.status(201).json({ user: user.toPublicJSON() });
}

export async function login(req, res) {
  const user = await authService.authenticateUser(req.body);
  startSession(res, user);
  res.json({ user: user.toPublicJSON() });
}

export function logout(req, res) {
  clearSessionCookie(res);
  res.status(204).end();
}

export function getCurrentUser(req, res) {
  res.json({ user: req.user.toPublicJSON() });
}

export async function forgotPassword(req, res) {
  await authService.requestPasswordReset(req.body.email);
  res.json({ message: RESET_REQUESTED_MESSAGE });
}

export async function resetPassword(req, res) {
  await authService.resetPassword(req.body);
  clearSessionCookie(res);
  res.json({ message: 'Password updated. Please sign in with your new password.' });
}

export async function exportAccount(req, res) {
  const data = await accountService.exportAccountData(req.user);
  const date = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Disposition', `attachment; filename="relay-export-${date}.json"`);
  res.json(data);
}

export async function deleteAccount(req, res) {
  await accountService.deleteAccount(req.user, req.body.password);
  clearSessionCookie(res);
  res.status(204).end();
}
