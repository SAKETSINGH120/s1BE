import mongoose from 'mongoose';
import { Collection } from '../models/collection.model.js';
import { Environment } from '../models/environment.model.js';
import { Folder } from '../models/folder.model.js';
import { MockRoute } from '../models/mockRoute.model.js';
import { RequestHistory } from '../models/requestHistory.model.js';
import { SavedRequest } from '../models/savedRequest.model.js';
import { Workspace } from '../models/workspace.model.js';
import { AppError } from '../utils/AppError.js';

export const DEFAULT_WORKSPACE_NAME = 'My Workspace';

// Loads a document that belongs to the workspace; anything else is reported as not found.
export async function findInWorkspace(Model, workspaceId, id, resourceName) {
  const document = mongoose.isObjectIdOrHexString(id)
    ? await Model.findOne({ _id: id, workspaceId })
    : null;

  if (!document) throw AppError.notFound(resourceName);
  return document;
}

export function listWorkspaces(userId) {
  return Workspace.find({ ownerId: userId }).sort({ createdAt: 1 });
}

export function createWorkspace(userId, { name }) {
  return Workspace.create({ name, ownerId: userId });
}

export async function findOwnedWorkspace(userId, workspaceId) {
  const workspace = mongoose.isObjectIdOrHexString(workspaceId)
    ? await Workspace.findOne({ _id: workspaceId, ownerId: userId })
    : null;

  if (!workspace) throw AppError.notFound('Workspace');
  return workspace;
}

export async function updateWorkspace(workspace, { name, activeEnvironmentId }) {
  if (name !== undefined) workspace.name = name;

  if (activeEnvironmentId !== undefined) {
    if (activeEnvironmentId !== null) {
      await findInWorkspace(Environment, workspace._id, activeEnvironmentId, 'Environment');
    }
    workspace.activeEnvironmentId = activeEnvironmentId;
  }

  return workspace.save();
}

export async function deleteWorkspace(workspace) {
  const workspaceCount = await Workspace.countDocuments({ ownerId: workspace.ownerId });
  if (workspaceCount <= 1) {
    throw new AppError(409, 'You must keep at least one workspace');
  }

  const scope = { workspaceId: workspace._id };
  await Promise.all(
    [SavedRequest, Folder, Collection, Environment, RequestHistory, MockRoute].map((Model) =>
      Model.deleteMany(scope),
    ),
  );
  await workspace.deleteOne();
}
