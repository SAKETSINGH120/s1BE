import { findOwnedWorkspace } from '../services/workspace.service.js';

// Every workspace-scoped route goes through here, so resources are only reachable by their owner.
export async function loadWorkspace(req, res, next) {
  req.workspace = await findOwnedWorkspace(req.user._id, req.params.workspaceId);
  next();
}
