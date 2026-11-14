import bcrypt from 'bcrypt';
import { Collection } from '../models/collection.model.js';
import { Environment } from '../models/environment.model.js';
import { Folder } from '../models/folder.model.js';
import { RequestHistory } from '../models/requestHistory.model.js';
import { SavedRequest } from '../models/savedRequest.model.js';
import { User } from '../models/user.model.js';
import { Workspace } from '../models/workspace.model.js';
import { AppError } from '../utils/AppError.js';

const WORKSPACE_MODELS = [SavedRequest, Folder, Collection, Environment, RequestHistory];

// Mongo internals and ownership ids are not useful outside Relay.
const OMITTED_FIELDS = new Set(['_id', '__v', 'workspaceId', 'ownerId']);

function clean(document) {
  const fields = Object.entries(document).filter(([key]) => !OMITTED_FIELDS.has(key));
  return { id: String(document._id), ...Object.fromEntries(fields) };
}

/**
 * Everything the user owns, as plain JSON. Secret environment values are left out: they are
 * write-only everywhere else, and an export file is easy to leak.
 */
export async function exportAccountData(user) {
  const workspaces = await Workspace.find({ ownerId: user._id }).lean();

  const exported = await Promise.all(
    workspaces.map(async (workspace) => {
      const scope = { workspaceId: workspace._id };
      const [collections, folders, requests, environments, history] = await Promise.all([
        Collection.find(scope).lean(),
        Folder.find(scope).lean(),
        SavedRequest.find(scope).lean(),
        Environment.find(scope).lean(),
        RequestHistory.find(scope).sort({ createdAt: -1 }).lean(),
      ]);

      return {
        ...clean(workspace),
        collections: collections.map((collection) => ({
          ...clean(collection),
          folders: folders
            .filter((folder) => folder.collectionId.equals(collection._id))
            .map(clean),
          requests: requests
            .filter((request) => request.collectionId.equals(collection._id))
            .map(clean),
        })),
        environments: environments.map((environment) => ({
          ...clean(environment),
          variables: environment.variables.map(({ key, value, secret, enabled }) =>
            secret ? { key, secret, enabled, value: null } : { key, value, secret, enabled },
          ),
        })),
        history: history.map(clean),
      };
    }),
  );

  return {
    exportedAt: new Date().toISOString(),
    format: 'relay-account-export@1',
    user: { name: user.name, email: user.email, createdAt: user.createdAt },
    workspaces: exported,
  };
}

/** Permanently deletes the user and all of their workspaces. Requires the current password. */
export async function deleteAccount(user, password) {
  const withHash = await User.findById(user._id).select('+passwordHash');
  if (!withHash || !(await bcrypt.compare(password, withHash.passwordHash))) {
    throw new AppError(400, 'The password is incorrect', { code: 'INVALID_PASSWORD' });
  }

  const workspaceIds = (await Workspace.find({ ownerId: user._id }).select('_id')).map(
    (workspace) => workspace._id,
  );
  // Children first, so an interrupted delete never leaves visible data pointing at nothing.
  await Promise.all(
    WORKSPACE_MODELS.map((Model) => Model.deleteMany({ workspaceId: { $in: workspaceIds } })),
  );
  await Workspace.deleteMany({ ownerId: user._id });
  await User.deleteOne({ _id: user._id });
}
