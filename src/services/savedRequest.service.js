import { SavedRequest } from '../models/savedRequest.model.js';
import { findCollection, REQUEST_SUMMARY_FIELDS } from './collection.service.js';
import { assertFolderInCollection } from './folder.service.js';
import { findInWorkspace } from './workspace.service.js';

export function findSavedRequest(workspace, requestId) {
  return findInWorkspace(SavedRequest, workspace._id, requestId, 'Request');
}

export function listSavedRequests(workspace) {
  return SavedRequest.find({ workspaceId: workspace._id })
    .select(REQUEST_SUMMARY_FIELDS)
    .sort({ name: 1 });
}

export async function createSavedRequest(workspace, { collectionId, folderId = null, ...data }) {
  const collection = await findCollection(workspace, collectionId);
  await assertFolderInCollection(workspace, folderId, collection._id);

  return SavedRequest.create({
    ...data,
    folderId,
    collectionId: collection._id,
    workspaceId: workspace._id,
  });
}

export async function updateSavedRequest(
  workspace,
  requestId,
  { collectionId, folderId, ...data },
) {
  const request = await findSavedRequest(workspace, requestId);

  const isChangingCollection = collectionId && !request.collectionId.equals(collectionId);
  if (isChangingCollection || folderId !== undefined) {
    const targetCollection = isChangingCollection
      ? (await findCollection(workspace, collectionId))._id
      : request.collectionId;
    // Moving to another collection without naming a folder places the request at its root.
    const targetFolderId = folderId !== undefined ? folderId : null;

    await assertFolderInCollection(workspace, targetFolderId, targetCollection);
    request.collectionId = targetCollection;
    request.folderId = targetFolderId;
  }

  request.set(data);
  return request.save();
}

export async function deleteSavedRequest(workspace, requestId) {
  const request = await findSavedRequest(workspace, requestId);
  await request.deleteOne();
}
