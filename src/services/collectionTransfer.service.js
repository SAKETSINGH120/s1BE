import mongoose from 'mongoose';
import { Collection } from '../models/collection.model.js';
import { Environment } from '../models/environment.model.js';
import { Folder } from '../models/folder.model.js';
import { SavedRequest } from '../models/savedRequest.model.js';
import { AppError } from '../utils/AppError.js';
import { findCollection } from './collection.service.js';
import { convertPostmanCollection, parsePostmanCollection } from './postman/postmanImport.js';
import { toPostmanCollection } from './postman/postmanExport.js';

function invalidImport(message) {
  return new AppError(400, message, { code: 'INVALID_IMPORT' });
}

async function createVariablesEnvironment(workspace, collectionName, variables) {
  if (!variables.length) return null;
  const baseName = `${collectionName} variables`.slice(0, 70);
  // Environment names are unique per workspace; add a suffix if needed.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const name = attempt === 0 ? baseName : `${baseName} (${attempt + 1})`;
    if (!(await Environment.exists({ workspaceId: workspace._id, name }))) {
      return Environment.create({ workspaceId: workspace._id, name, variables });
    }
  }
  return null;
}

/**
 * Imports a Postman v2.0/v2.1 collection. Ids are generated up front so the whole tree is written
 * with two bulk inserts; if anything fails, the partially created collection is removed.
 */
export async function importPostmanCollection(workspace, input) {
  const parsed = parsePostmanCollection(input);
  if (!parsed.success) {
    throw invalidImport(
      parsed.error.issues[0]?.message ?? 'This is not a valid Postman collection',
    );
  }

  const converted = convertPostmanCollection(parsed.data);
  const workspaceId = workspace._id;
  const collectionId = new mongoose.Types.ObjectId();
  const folderIds = new Map(
    converted.folders.map((folder) => [folder.tempId, new mongoose.Types.ObjectId()]),
  );
  const resolveFolder = (tempId) => (tempId ? folderIds.get(tempId) : null);

  try {
    const collection = await Collection.create({
      _id: collectionId,
      workspaceId,
      ...converted.collection,
    });
    await Folder.insertMany(
      converted.folders.map((folder) => ({
        _id: folderIds.get(folder.tempId),
        workspaceId,
        collectionId,
        parentId: resolveFolder(folder.parentTempId),
        name: folder.name,
      })),
    );
    await SavedRequest.insertMany(
      converted.requests.map((request) => ({
        workspaceId,
        collectionId,
        folderId: resolveFolder(request.folderTempId),
        name: request.name,
        ...request.spec,
      })),
    );
    const environment = await createVariablesEnvironment(
      workspace,
      converted.collection.name,
      converted.variables,
    );

    return {
      collection,
      summary: {
        folders: converted.folders.length,
        requests: converted.requests.length,
        environment: environment ? { id: environment.id, name: environment.name } : null,
        warnings: converted.warnings,
      },
    };
  } catch (error) {
    await Promise.all([
      SavedRequest.deleteMany({ collectionId }),
      Folder.deleteMany({ collectionId }),
      Collection.deleteOne({ _id: collectionId }),
    ]);
    throw error;
  }
}

export async function exportPostmanCollection(workspace, collectionId) {
  const collection = await findCollection(workspace, collectionId);
  const [folders, requests] = await Promise.all([
    Folder.find({ collectionId: collection._id }).sort({ name: 1 }).lean(),
    SavedRequest.find({ collectionId: collection._id }).sort({ name: 1 }).lean(),
  ]);
  return toPostmanCollection(collection, folders, requests);
}
