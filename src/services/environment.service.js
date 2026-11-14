import { Environment } from '../models/environment.model.js';
import { AppError } from '../utils/AppError.js';
import { decryptSecret } from '../utils/secretBox.js';
import { findInWorkspace } from './workspace.service.js';

function findEnvironment(workspace, environmentId) {
  return findInWorkspace(Environment, workspace._id, environmentId, 'Environment');
}

// Secret values never leave the server; clients only learn whether one is set.
export function toPublicEnvironment(environment) {
  const json = environment.toJSON();
  json.variables = environment.variables.map(({ key, value, secret, enabled }) => ({
    key,
    value: secret ? '' : value,
    secret,
    enabled,
    hasValue: value !== '',
  }));
  return json;
}

// A variable sent without `value` keeps its stored value, except that a stored secret is never
// carried into a non-secret variable: that would make the next read return it in plain text.
function mergeVariables(incoming, existing = []) {
  const previousByKey = new Map(existing.map((variable) => [variable.key, variable]));
  return incoming.map((variable) => {
    const previous = previousByKey.get(variable.key);
    const revealsSecret = previous?.secret && !variable.secret;
    const keptValue = revealsSecret ? '' : previous?.value;
    return { ...variable, value: variable.value ?? keptValue ?? '' };
  });
}

async function saveUnique(environment) {
  try {
    return await environment.save();
  } catch (error) {
    if (error?.code === 11000) {
      throw new AppError(409, 'An environment with this name already exists');
    }
    throw error;
  }
}

// Server-side only: includes secret values for request execution.
export async function getVariablesForExecution(workspace, environmentId) {
  if (!environmentId) return new Map();
  const environment = await findEnvironment(workspace, environmentId);
  return new Map(
    environment.variables
      .filter((variable) => variable.enabled)
      .map((variable) => [
        variable.key,
        variable.secret ? decryptSecretValue(variable) : variable.value,
      ]),
  );
}

function decryptSecretValue(variable) {
  try {
    return decryptSecret(variable.value);
  } catch {
    throw new AppError(500, `The secret variable "${variable.key}" could not be decrypted`, {
      code: 'SECRET_DECRYPTION_FAILED',
    });
  }
}

const MAX_VARIABLES = 500;

/**
 * Stores values captured from a response. Existing variables keep their secret/enabled flags;
 * new ones are added as plain, enabled variables. Returns the names that were saved.
 */
export async function saveCapturedVariables(workspace, environmentId, captured) {
  const environment = await findEnvironment(workspace, environmentId);
  const saved = [];

  for (const { variable, value } of captured) {
    const existing = environment.variables.find(({ key }) => key === variable);
    if (existing) {
      existing.value = value.slice(0, 16_384);
      saved.push(variable);
    } else if (environment.variables.length < MAX_VARIABLES) {
      environment.variables.push({ key: variable, value: value.slice(0, 16_384) });
      saved.push(variable);
    }
  }

  if (saved.length) await environment.save();
  return saved;
}

export function listEnvironments(workspace) {
  return Environment.find({ workspaceId: workspace._id }).sort({ name: 1 });
}

export function getEnvironment(workspace, environmentId) {
  return findEnvironment(workspace, environmentId);
}

export function createEnvironment(workspace, { name, variables = [] }) {
  const environment = new Environment({
    name,
    workspaceId: workspace._id,
    variables: mergeVariables(variables),
  });
  return saveUnique(environment);
}

export async function updateEnvironment(workspace, environmentId, { name, variables }) {
  const environment = await findEnvironment(workspace, environmentId);

  if (name !== undefined) environment.name = name;
  if (variables !== undefined) {
    environment.variables = mergeVariables(variables, environment.variables);
  }

  return saveUnique(environment);
}

export async function deleteEnvironment(workspace, environmentId) {
  const environment = await findEnvironment(workspace, environmentId);
  await environment.deleteOne();

  if (workspace.activeEnvironmentId?.equals(environment._id)) {
    workspace.activeEnvironmentId = null;
    await workspace.save();
  }
}
