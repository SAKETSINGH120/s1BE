import { Router } from 'express';
import { authRouter } from './auth.routes.js';
import { workspaceRouter } from './workspace.routes.js';

export const apiRouter = Router();

apiRouter.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

apiRouter.use('/auth', authRouter);
apiRouter.use('/workspaces', workspaceRouter);
