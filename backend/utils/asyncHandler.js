/**
 * Wraps an async route handler so a rejected promise reaches Express' error
 * pipeline instead of dying as an unhandled rejection. Every async controller
 * is expected to be wrapped in this.
 */
const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

export default asyncHandler;
