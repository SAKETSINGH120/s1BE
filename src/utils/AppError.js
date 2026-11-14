// An error whose message is safe to show to API clients.
// `code` is a stable machine-readable identifier, e.g. DESTINATION_BLOCKED.
export class AppError extends Error {
  constructor(status, message, { details, code } = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.details = details;
    this.code = code;
    this.expose = status < 500 || status === 502 || status === 504;
  }

  static notFound(resource) {
    return new AppError(404, `${resource} not found`);
  }
}
