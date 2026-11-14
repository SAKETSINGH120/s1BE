import { env } from '../config/env.js';

export const SESSION_COOKIE = 'relay_session';

// The client is served from the same site as the API (Vite proxy in development,
// one origin in production), so SameSite=Lax keeps cookies off cross-site POSTs.
const baseOptions = {
  httpOnly: true,
  secure: env.isProduction,
  sameSite: 'lax',
  path: '/',
};

export function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE, token, {
    ...baseOptions,
    maxAge: env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, baseOptions);
}
