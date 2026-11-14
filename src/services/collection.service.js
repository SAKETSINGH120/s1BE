import { Collection } from '../models/collection.model.js';
import { Folder } from '../models/folder.model.js';
import { SavedRequest } from '../models/savedRequest.model.js';
import { findInWorkspace } from './workspace.service.js';

export const REQUEST_SUMMARY_FIELDS = 'name method url collectionId folderId updatedAt';

export function findCollection(workspace, collectionId) {
  return findInWorkspace(Collection, workspace._id, collectionId, 'Collection');
}

export function listCollections(workspace) {
  return Collection.find({ workspaceId: workspace._id }).sort({ name: 1 });
}

export function createCollection(workspace, data) {
  return Collection.create({ ...data, workspaceId: workspace._id });
}

// Folders and request summaries are returned flat; clients build the tree from parentId/folderId.
export async function getCollectionTree(workspace, collectionId) {
  const collection = await findCollection(workspace, collectionId);
  const [folders, requests] = await Promise.all([
    Folder.find({ collectionId: collection._id }).sort({ name: 1 }),
    SavedRequest.find({ collectionId: collection._id })
      .select(REQUEST_SUMMARY_FIELDS)
      .sort({ name: 1 }),
  ]);
  return { collection, folders, requests };
}

export async function updateCollection(workspace, collectionId, data) {
  const collection = await findCollection(workspace, collectionId);
  collection.set(data);
  return collection.save();
}

export async function deleteCollection(workspace, collectionId) {
  const collection = await findCollection(workspace, collectionId);
  await Promise.all([
    SavedRequest.deleteMany({ collectionId: collection._id }),
    Folder.deleteMany({ collectionId: collection._id }),
  ]);
  await collection.deleteOne();
}
