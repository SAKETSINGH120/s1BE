import * as workspaceService from '../services/workspace.service.js';

export async function listWorkspaces(req, res) {
  res.json({ workspaces: await workspaceService.listWorkspaces(req.user._id) });
}

export async function createWorkspace(req, res) {
  const workspace = await workspaceService.createWorkspace(req.user._id, req.body);
  res.status(201).json({ workspace });
}

export function getWorkspace(req, res) {
  res.json({ workspace: req.workspace });
}

export async function updateWorkspace(req, res) {
  res.json({ workspace: await workspaceService.updateWorkspace(req.workspace, req.body) });
}

export async function deleteWorkspace(req, res) {
  await workspaceService.deleteWorkspace(req.workspace);
  res.status(204).end();
}
