import { Router } from 'express';
import * as collectionController from '../controllers/collection.controller.js';
import * as environmentController from '../controllers/environment.controller.js';
import * as executionController from '../controllers/execution.controller.js';
import * as folderController from '../controllers/folder.controller.js';
import * as historyController from '../controllers/history.controller.js';
import * as savedRequestController from '../controllers/savedRequest.controller.js';
import * as workspaceController from '../controllers/workspace.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { executeLimiter } from '../middlewares/rateLimit.middleware.js';
import { validateBody } from '../middlewares/validate.middleware.js';
import { loadWorkspace } from '../middlewares/workspace.middleware.js';
import {
  createCollectionSchema,
  createFolderSchema,
  updateCollectionSchema,
  updateFolderSchema,
} from '../validators/collection.validators.js';
import {
  createEnvironmentSchema,
  updateEnvironmentSchema,
} from '../validators/environment.validators.js';
import { executeRequestSchema } from '../validators/execution.validators.js';
import { createHistorySchema } from '../validators/history.validators.js';
import {
  createSavedRequestSchema,
  updateSavedRequestSchema,
} from '../validators/request.validators.js';
import {
  createWorkspaceSchema,
  updateWorkspaceSchema,
} from '../validators/workspace.validators.js';

export const workspaceRouter = Router();
workspaceRouter.use(requireAuth);

workspaceRouter
  .route('/')
  .get(workspaceController.listWorkspaces)
  .post(validateBody(createWorkspaceSchema), workspaceController.createWorkspace);

// Everything below is scoped to one workspace owned by the current user.
const scoped = Router({ mergeParams: true });
workspaceRouter.use('/:workspaceId', loadWorkspace, scoped);

scoped
  .route('/')
  .get(workspaceController.getWorkspace)
  .patch(validateBody(updateWorkspaceSchema), workspaceController.updateWorkspace)
  .delete(workspaceController.deleteWorkspace);

scoped
  .route('/collections')
  .get(collectionController.listCollections)
  .post(validateBody(createCollectionSchema), collectionController.createCollection);
// Registered before /collections/:collectionId so 'import' is not read as an id.
scoped.post('/collections/import', collectionController.importCollection);
scoped.get('/collections/:collectionId/export', collectionController.exportCollection);
scoped
  .route('/collections/:collectionId')
  .get(collectionController.getCollection)
  .patch(validateBody(updateCollectionSchema), collectionController.updateCollection)
  .delete(collectionController.deleteCollection);

scoped.post('/folders', validateBody(createFolderSchema), folderController.createFolder);
scoped
  .route('/folders/:folderId')
  .get(folderController.getFolder)
  .patch(validateBody(updateFolderSchema), folderController.updateFolder)
  .delete(folderController.deleteFolder);

scoped
  .route('/requests')
  .get(savedRequestController.listSavedRequests)
  .post(validateBody(createSavedRequestSchema), savedRequestController.createSavedRequest);
scoped
  .route('/requests/:requestId')
  .get(savedRequestController.getSavedRequest)
  .patch(validateBody(updateSavedRequestSchema), savedRequestController.updateSavedRequest)
  .delete(savedRequestController.deleteSavedRequest);

scoped
  .route('/environments')
  .get(environmentController.listEnvironments)
  .post(validateBody(createEnvironmentSchema), environmentController.createEnvironment);
scoped
  .route('/environments/:environmentId')
  .get(environmentController.getEnvironment)
  .patch(validateBody(updateEnvironmentSchema), environmentController.updateEnvironment)
  .delete(environmentController.deleteEnvironment);

scoped
  .route('/history')
  .get(historyController.listHistory)
  .post(validateBody(createHistorySchema), historyController.createHistoryEntry)
  .delete(historyController.clearHistory);
scoped.delete('/history/:entryId', historyController.deleteHistoryEntry);

scoped.post(
  '/execute',
  executeLimiter,
  validateBody(executeRequestSchema),
  executionController.execute,
);
