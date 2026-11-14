import * as environmentService from '../services/environment.service.js';

const { toPublicEnvironment } = environmentService;

export async function listEnvironments(req, res) {
  const environments = await environmentService.listEnvironments(req.workspace);
  res.json({ environments: environments.map(toPublicEnvironment) });
}

export async function createEnvironment(req, res) {
  const environment = await environmentService.createEnvironment(req.workspace, req.body);
  res.status(201).json({ environment: toPublicEnvironment(environment) });
}

export async function getEnvironment(req, res) {
  const environment = await environmentService.getEnvironment(
    req.workspace,
    req.params.environmentId,
  );
  res.json({ environment: toPublicEnvironment(environment) });
}

export async function updateEnvironment(req, res) {
  const environment = await environmentService.updateEnvironment(
    req.workspace,
    req.params.environmentId,
    req.body,
  );
  res.json({ environment: toPublicEnvironment(environment) });
}

export async function deleteEnvironment(req, res) {
  await environmentService.deleteEnvironment(req.workspace, req.params.environmentId);
  res.status(204).end();
}
