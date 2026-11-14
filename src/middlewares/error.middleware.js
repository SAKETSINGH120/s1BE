import mongoose from 'mongoose';

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { message: `Route not found: ${req.method} ${req.path}` } });
}

function normalizeError(err) {
  if (err instanceof mongoose.Error.CastError) {
    return { status: 400, message: `Invalid value for ${err.path}`, expose: true };
  }
  if (err?.code === 11000) {
    return { status: 409, message: 'Resource already exists', expose: true };
  }
  return err;
}

// Client errors and errors explicitly flagged `expose` (AppError, body-parser, http-errors)
// carry client-safe messages; everything else is logged and replaced with a generic message.
export function errorHandler(err, req, res, _next) {
  const error = normalizeError(err);
  const status = Number.isInteger(error.status) && error.status >= 400 ? error.status : 500;
  const isClientSafe = error.expose === true || (status < 500 && error.expose !== false);

  if (!isClientSafe) {
    console.error(err);
  }

  const body = { message: isClientSafe ? error.message : 'Internal server error' };
  if (isClientSafe && typeof error.code === 'string') {
    body.code = error.code;
  }
  if (isClientSafe && error.details) {
    body.details = error.details;
  }

  res.status(status).json({ error: body });
}
