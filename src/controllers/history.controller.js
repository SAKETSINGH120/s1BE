import * as historyService from '../services/history.service.js';

export async function listHistory(req, res) {
  res.json({ history: await historyService.listHistory(req.workspace) });
}

export async function createHistoryEntry(req, res) {
  const entry = await historyService.recordHistory(req.workspace, req.body);
  res.status(201).json({ entry });
}

export async function deleteHistoryEntry(req, res) {
  await historyService.deleteHistoryEntry(req.workspace, req.params.entryId);
  res.status(204).end();
}

export async function clearHistory(req, res) {
  await historyService.clearHistory(req.workspace);
  res.status(204).end();
}
