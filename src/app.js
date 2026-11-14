import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import { requireAuth } from './middlewares/auth.middleware.js';
import { errorHandler, notFoundHandler } from './middlewares/error.middleware.js';
import { apiLimiter } from './middlewares/rateLimit.middleware.js';
import { apiRouter } from './routes/index.js';
import { mockRouter } from './routes/mock.routes.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', env.TRUST_PROXY);
  app.disable('x-powered-by');

  app.use(helmet());
  // Public mock URLs have their own open CORS policy and rate limit, so they come first.
  app.use('/api/v1/m', mockRouter);
  app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));
  app.use('/api', apiLimiter);
  app.use(cookieParser());
  // Collection imports may be larger than other requests. The session is checked before the
  // larger body is parsed, so anonymous clients cannot make the server parse 5 MB payloads.
  app.use(
    '/api/v1/workspaces/:workspaceId/collections/import',
    requireAuth,
    express.json({ limit: '5mb' }),
  );
  app.use(express.json({ limit: '1mb' }));

  app.use('/api/v1', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
