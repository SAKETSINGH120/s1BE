import jwt from 'jsonwebtoken';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { User } from '../src/models/user.model.js';
import { sendPasswordResetEmail } from '../src/services/email.service.js';

vi.mock('../src/services/email.service.js', () => ({ sendPasswordResetEmail: vi.fn() }));

const app = createApp();
const credentials = { name: 'Ada Lovelace', email: 'ada@example.com', password: 'correct-horse-1' };

function sessionCookie(res) {
  return res.headers['set-cookie']?.find((cookie) => cookie.startsWith('relay_session='));
}

async function registerAgent(body = credentials) {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/register').send(body);
  return { agent, res };
}

// The reset email is issued in the background, after the response has been sent.
async function requestResetToken(email = credentials.email) {
  await request(app).post('/api/v1/auth/forgot-password').send({ email });
  await vi.waitFor(() => expect(sendPasswordResetEmail).toHaveBeenCalled());
  const resetUrl = sendPasswordResetEmail.mock.calls.at(-1)[1];
  return new URL(resetUrl).searchParams.get('token');
}

beforeEach(() => {
  sendPasswordResetEmail.mockClear();
});

describe('POST /auth/register', () => {
  it('creates the user, starts a session and never returns the password hash', async () => {
    const { res } = await registerAgent();

    expect(res.status).toBe(201);
    expect(res.body.user).toEqual({
      id: expect.any(String),
      name: credentials.name,
      email: credentials.email,
      createdAt: expect.any(String),
    });

    const cookie = sessionCookie(res);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it('stores a bcrypt hash, not the password', async () => {
    await registerAgent();
    const user = await User.findOne({ email: credentials.email }).select('+passwordHash');

    expect(user.passwordHash).not.toBe(credentials.password);
    expect(user.passwordHash).toMatch(/^\$2[aby]\$/);
  });

  it('rejects a duplicate email regardless of case', async () => {
    await registerAgent();
    const { res } = await registerAgent({ ...credentials, email: 'ADA@Example.com' });

    expect(res.status).toBe(409);
  });

  it('returns field-level validation errors', async () => {
    const { res } = await registerAgent({ name: '', email: 'not-an-email', password: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.error.details.map((detail) => detail.field).sort()).toEqual([
      'email',
      'name',
      'password',
    ]);
  });

  it('ignores fields that are not part of the schema', async () => {
    const { res } = await registerAgent({ ...credentials, sessionVersion: 99, passwordHash: 'x' });
    const user = await User.findById(res.body.user.id).select('+passwordHash');

    expect(user.sessionVersion).toBe(0);
    expect(user.passwordHash).not.toBe('x');
  });
});

describe('POST /auth/login', () => {
  beforeEach(() => registerAgent());

  it('starts a session with valid credentials', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'Ada@Example.com', password: credentials.password });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(credentials.email);
    expect(sessionCookie(res)).toBeDefined();
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const wrongPassword = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: credentials.email, password: 'wrong-password' });
    const unknownEmail = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.com', password: 'wrong-password' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
    expect(sessionCookie(wrongPassword)).toBeUndefined();
  });
});

describe('GET /auth/me and POST /auth/logout', () => {
  it('returns the current user for a valid session', async () => {
    const { agent } = await registerAgent();
    const res = await agent.get('/api/v1/auth/me');

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(credentials.email);
  });

  it('rejects requests without a session', async () => {
    const res = await request(app).get('/api/v1/auth/me');

    expect(res.status).toBe(401);
  });

  it('rejects a token signed with another secret', async () => {
    const { res: registerRes } = await registerAgent();
    const forged = jwt.sign({ sv: 0 }, 'some-other-secret-that-is-also-long-enough', {
      subject: registerRes.body.user.id,
    });

    const res = await request(app).get('/api/v1/auth/me').set('Cookie', `relay_session=${forged}`);

    expect(res.status).toBe(401);
  });

  it('rejects an unsigned (alg=none) token', async () => {
    const { res: registerRes } = await registerAgent();
    const unsigned = jwt.sign({ sv: 0 }, null, {
      subject: registerRes.body.user.id,
      algorithm: 'none',
    });

    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', `relay_session=${unsigned}`);

    expect(res.status).toBe(401);
  });

  it('clears the session cookie on logout', async () => {
    const { agent } = await registerAgent();
    const logoutRes = await agent.post('/api/v1/auth/logout');

    expect(logoutRes.status).toBe(204);
    expect(sessionCookie(logoutRes)).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect((await agent.get('/api/v1/auth/me')).status).toBe(401);
  });
});

describe('password reset', () => {
  it('responds identically for known and unknown emails', async () => {
    await registerAgent();

    const known = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: credentials.email });
    const unknown = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'nobody@example.com' });

    expect(known.status).toBe(200);
    expect(known.body).toEqual(unknown.body);
    await vi.waitFor(() => expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1));
  });

  it('responds without waiting for the email to be sent', async () => {
    await registerAgent();
    sendPasswordResetEmail.mockImplementationOnce(() => new Promise(() => {}));

    const startedAt = Date.now();
    const res = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: credentials.email });

    expect(res.status).toBe(200);
    expect(Date.now() - startedAt).toBeLessThan(2000);
    await vi.waitFor(() => expect(sendPasswordResetEmail).toHaveBeenCalled());
  });

  it('stores only a hash of the reset token', async () => {
    await registerAgent();
    const token = await requestResetToken();
    const user = await User.findOne({ email: credentials.email }).select('+passwordResetTokenHash');

    expect(user.passwordResetTokenHash).toBeDefined();
    expect(user.passwordResetTokenHash).not.toBe(token);
  });

  it('changes the password, ends existing sessions and is single-use', async () => {
    const { agent } = await registerAgent();
    const token = await requestResetToken();
    const newPassword = 'brand-new-password-2';

    const resetRes = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: newPassword });
    expect(resetRes.status).toBe(200);

    expect((await agent.get('/api/v1/auth/me')).status).toBe(401);

    const oldLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: credentials.email, password: credentials.password });
    const newLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: credentials.email, password: newPassword });
    expect(oldLogin.status).toBe(401);
    expect(newLogin.status).toBe(200);

    const reuse = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'another-password-3' });
    expect(reuse.status).toBe(400);
  });

  it('rejects an expired token', async () => {
    await registerAgent();
    const token = await requestResetToken();
    await User.updateOne(
      { email: credentials.email },
      { passwordResetExpiresAt: new Date(Date.now() - 1000) },
    );

    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'brand-new-password-2' });

    expect(res.status).toBe(400);
  });
});
