import crypto from 'node:crypto';
import request from 'supertest';

// Registers a fresh user and returns a cookie-carrying agent plus a helper for workspace URLs.
export async function signUp(app) {
  const agent = request.agent(app);
  await agent.post('/api/v1/auth/register').send({
    name: 'Test User',
    email: `user-${crypto.randomUUID()}@example.com`,
    password: 'password-123',
  });

  const { body } = await agent.get('/api/v1/workspaces');
  const workspaceId = body.workspaces[0].id;

  return { agent, workspaceId, url: (path = '') => `/api/v1/workspaces/${workspaceId}${path}` };
}
