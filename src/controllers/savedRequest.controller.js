import * as savedRequestService from '../services/savedRequest.service.js';

export async function listSavedRequests(req, res) {
  res.json({ requests: await savedRequestService.listSavedRequests(req.workspace) });
}

export async function createSavedRequest(req, res) {
  const request = await savedRequestService.createSavedRequest(req.workspace, req.body);
  res.status(201).json({ request });
}

export async function getSavedRequest(req, res) {
  const request = await savedRequestService.findSavedRequest(req.workspace, req.params.requestId);
  res.json({ request });
}

export async function updateSavedRequest(req, res) {
  const request = await savedRequestService.updateSavedRequest(
    req.workspace,
    req.params.requestId,
    req.body,
  );
  res.json({ request });
}

export async function deleteSavedRequest(req, res) {
  await savedRequestService.deleteSavedRequest(req.workspace, req.params.requestId);
  res.status(204).end();
}
