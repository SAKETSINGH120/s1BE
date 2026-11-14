import { describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../src/middlewares/error.middleware.js';
import { AppError } from '../src/utils/AppError.js';

function run(error) {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  errorHandler(error, {}, res, () => {});
  return { status: res.status.mock.calls[0][0], body: res.json.mock.calls[0][0] };
}

describe('central error handler', () => {
  it('hides the message and stack of unexpected errors', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { status, body } = run(new Error('connect ECONNREFUSED 10.0.0.5:27017 at db.js:12'));

    expect(status).toBe(500);
    expect(body).toEqual({ error: { message: 'Internal server error' } });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('returns client-safe errors with their code and details', () => {
    const error = new AppError(400, 'Validation failed', {
      code: 'VALIDATION',
      details: [{ field: 'name', message: 'Required' }],
    });

    expect(run(error)).toEqual({
      status: 400,
      body: {
        error: {
          message: 'Validation failed',
          code: 'VALIDATION',
          details: [{ field: 'name', message: 'Required' }],
        },
      },
    });
  });

  it('exposes upstream failures (502/504) raised as AppError', () => {
    expect(run(new AppError(504, 'The request timed out', { code: 'TIMEOUT' })).body).toEqual({
      error: { message: 'The request timed out', code: 'TIMEOUT' },
    });
  });

  it('maps duplicate keys and invalid ids to client errors', () => {
    expect(run({ code: 11000 }).status).toBe(409);
  });
});
