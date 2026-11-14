import { rateLimit } from 'express-rate-limit';
import { env } from '../config/env.js';

const ONE_MINUTE = 60 * 1000;
const FIFTEEN_MINUTES = 15 * ONE_MINUTE;

function createLimiter({ limit, message, windowMs = FIFTEEN_MINUTES, keyGenerator }) {
  return rateLimit({
    windowMs,
    limit,
    keyGenerator,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => env.NODE_ENV === 'test',
    handler: (req, res) => res.status(429).json({ error: { message } }),
  });
}

export const apiLimiter = createLimiter({
  limit: 600,
  message: 'Too many requests, please slow down',
});

export const authLimiter = createLimiter({
  limit: 20,
  message: 'Too many authentication attempts, please try again later',
});

// Outbound requests are the most expensive operation, so they are limited per user, not per IP.
export const executeLimiter = createLimiter({
  windowMs: ONE_MINUTE,
  limit: 60,
  keyGenerator: (req) => `user:${req.user.id}`,
  message: 'Too many requests sent. Wait a moment and try again.',
});
