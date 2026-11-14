import * as folderService from '../services/folder.service.js';

export async function createFolder(req, res) {
  const folder = await folderService.createFolder(req.workspace, req.body);
  res.status(201).json({ folder });
}

export async function getFolder(req, res) {
  res.json(await folderService.getFolderContents(req.workspace, req.params.folderId));
}

export async function updateFolder(req, res) {
  const folder = await folderService.updateFolder(req.workspace, req.params.folderId, req.body);
  res.json({ folder });
}

export async function deleteFolder(req, res) {
  await folderService.deleteFolder(req.workspace, req.params.folderId);
  res.status(204).end();
}
