import cors from 'cors';
import { Router } from 'express';
import { serveMock } from '../controllers/mock.controller.js';
import { mockLimiter } from '../middlewares/rateLimit.middleware.js';

// Public mock endpoints. Any site may call them (they hold no user data and never use cookies),
// so CORS is open and credentials are not allowed.
export const mockRouter = Router();

mockRouter.use(cors({ origin: '*', credentials: false, maxAge: 600 }));
mockRouter.use(mockLimiter);
mockRouter.all('/:mockKey{/*rest}', serveMock);
