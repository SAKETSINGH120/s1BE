import { findUserBySessionToken } from '../services/auth.service.js';
import { AppError } from '../utils/AppError.js';
import { SESSION_COOKIE } from '../utils/sessionCookie.js';

export async function requireAuth(req, res, next) {
  const token = req.cookies?.[SESSION_COOKIE];
  const user = token ? await findUserBySessionToken(token) : null;

  if (!user) {
    throw new AppError(401, 'Authentication required');
  }

  req.user = user;
  next();
}
