/**
 * Every failure the API intends to expose is thrown as an ApiError. The global
 * error handler treats `isOperational` as the switch between "tell the client
 * what happened" and "log it and return a generic 500", which is how internal
 * details stay out of responses.
 */
class ApiError extends Error {
  constructor(statusCode, message, { details = null, code = null, isOperational = true } = {}) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.details = details;
    this.code = code;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message = 'Bad request', details) {
    return new ApiError(400, message, { details });
  }

  static unauthorized(message = 'Authentication required', details) {
    return new ApiError(401, message, { details });
  }

  static forbidden(message = 'You do not have permission to perform this action', details) {
    return new ApiError(403, message, { details });
  }

  static notFound(message = 'Resource not found', details) {
    return new ApiError(404, message, { details });
  }

  static conflict(message = 'Resource already exists', details) {
    return new ApiError(409, message, { details });
  }

  static unprocessable(message = 'Validation failed', details) {
    return new ApiError(422, message, { details });
  }

  static tooManyRequests(message = 'Too many requests') {
    return new ApiError(429, message);
  }

  static internal(message = 'Internal server error', details) {
    return new ApiError(500, message, { details, isOperational: false });
  }
}

export default ApiError;
