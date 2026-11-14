import * as collectionService from '../services/collection.service.js';
import {
  exportPostmanCollection,
  importPostmanCollection,
} from '../services/collectionTransfer.service.js';

export async function listCollections(req, res) {
  res.json({ collections: await collectionService.listCollections(req.workspace) });
}

export async function createCollection(req, res) {
  const collection = await collectionService.createCollection(req.workspace, req.body);
  res.status(201).json({ collection });
}

export async function getCollection(req, res) {
  res.json(await collectionService.getCollectionTree(req.workspace, req.params.collectionId));
}

export async function updateCollection(req, res) {
  const collection = await collectionService.updateCollection(
    req.workspace,
    req.params.collectionId,
    req.body,
  );
  res.json({ collection });
}

export async function deleteCollection(req, res) {
  await collectionService.deleteCollection(req.workspace, req.params.collectionId);
  res.status(204).end();
}

export async function importCollection(req, res) {
  const result = await importPostmanCollection(req.workspace, req.body);
  res.status(201).json(result);
}

export async function exportCollection(req, res) {
  res.json(await exportPostmanCollection(req.workspace, req.params.collectionId));
}
