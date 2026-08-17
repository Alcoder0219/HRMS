import ApiError from '../utils/ApiError.js';

/**
 * Terminal middleware: any request that matched no route becomes a 404
 * ApiError so unknown paths return the same envelope as every other failure.
 */
const notFound = (req, _res, next) => {
  next(ApiError.notFound(`Route ${req.method} ${req.originalUrl} not found`));
};

export default notFound;
