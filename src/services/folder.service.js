import { Folder } from '../models/folder.model.js';
import { SavedRequest } from '../models/savedRequest.model.js';
import { AppError } from '../utils/AppError.js';
import { findCollection, REQUEST_SUMMARY_FIELDS } from './collection.service.js';
import { findInWorkspace } from './workspace.service.js';

export function findFolder(workspace, folderId) {
  return findInWorkspace(Folder, workspace._id, folderId, 'Folder');
}

// Ensures folderId (if any) is a folder of the given collection.
export async function assertFolderInCollection(workspace, folderId, collectionId) {
  if (!folderId) return;
  const folder = await findFolder(workspace, folderId);
  if (!folder.collectionId.equals(collectionId)) {
    throw new AppError(400, 'Folder belongs to a different collection');
  }
}

async function assertNotDescendant(folder, newParentId) {
  let currentId = newParentId;
  while (currentId) {
    if (folder._id.equals(currentId)) {
      throw new AppError(400, 'A folder cannot be moved into itself or one of its subfolders');
    }
    const current = await Folder.findById(currentId).select('parentId');
    currentId = current?.parentId;
  }
}

async function collectDescendantIds(folderId) {
  const ids = [folderId];
  let frontier = [folderId];
  while (frontier.length) {
    const children = await Folder.find({ parentId: { $in: frontier } }).select('_id');
    frontier = children.map((child) => child._id);
    ids.push(...frontier);
  }
  return ids;
}

export async function createFolder(workspace, { name, collectionId, parentId = null }) {
  const collection = await findCollection(workspace, collectionId);
  await assertFolderInCollection(workspace, parentId, collection._id);

  return Folder.create({
    name,
    parentId,
    collectionId: collection._id,
    workspaceId: workspace._id,
  });
}

export async function getFolderContents(workspace, folderId) {
  const folder = await findFolder(workspace, folderId);
  const [folders, requests] = await Promise.all([
    Folder.find({ parentId: folder._id }).sort({ name: 1 }),
    SavedRequest.find({ folderId: folder._id }).select(REQUEST_SUMMARY_FIELDS).sort({ name: 1 }),
  ]);
  return { folder, folders, requests };
}

export async function updateFolder(workspace, folderId, { name, parentId }) {
  const folder = await findFolder(workspace, folderId);

  if (name !== undefined) folder.name = name;

  if (parentId !== undefined) {
    await assertFolderInCollection(workspace, parentId, folder.collectionId);
    await assertNotDescendant(folder, parentId);
    folder.parentId = parentId;
  }

  return folder.save();
}

export async function deleteFolder(workspace, folderId) {
  const folder = await findFolder(workspace, folderId);
  const folderIds = await collectDescendantIds(folder._id);

  await Promise.all([
    SavedRequest.deleteMany({ folderId: { $in: folderIds } }),
    Folder.deleteMany({ _id: { $in: folderIds } }),
  ]);
}
