import mongoose from 'mongoose';
import multer from 'multer';
import jwt from 'jsonwebtoken';
import ApiError from '../utils/ApiError.js';
import logger from '../config/logger.js';
import env from '../config/env.js';

/**
 * Translates the error types this stack actually produces into ApiError, so the
 * handler below only ever formats one shape.
 */
const normalize = (error) => {
  if (error instanceof ApiError) return error;

  if (error instanceof mongoose.Error.ValidationError) {
    const details = Object.values(error.errors).map((e) => ({
      field: e.path,
      message: e.message,
    }));
    return ApiError.unprocessable('Validation failed', details);
  }

  if (error instanceof mongoose.Error.CastError) {
    return ApiError.badRequest(`Invalid value for '${error.path}'`);
  }

  // Duplicate key on a unique index -- e.g. two employees with one email.
  if (error?.code === 11000) {
    const fields = Object.keys(error.keyPattern ?? {});
    return ApiError.conflict(
      `Duplicate value for ${fields.join(', ') || 'unique field'}`,
      fields.map((field) => ({ field, message: 'Already in use' })),
    );
  }

  if (error instanceof jwt.TokenExpiredError) {
    return ApiError.unauthorized('Token has expired');
  }

  if (error instanceof jwt.JsonWebTokenError) {
    return ApiError.unauthorized('Invalid token');
  }

  if (error instanceof multer.MulterError) {
    const message =
      error.code === 'LIMIT_FILE_SIZE'
        ? `File exceeds the ${env.upload.maxSizeBytes / 1024 / 1024}MB limit`
        : error.message;
    return ApiError.badRequest(message, { field: error.field });
  }

  if (error?.message?.includes('not allowed by CORS')) {
    return ApiError.forbidden(error.message);
  }

  if (error?.type === 'entity.parse.failed') {
    return ApiError.badRequest('Malformed JSON in request body');
  }

  return new ApiError(error.statusCode || 500, error.message || 'Internal server error', {
    isOperational: false,
  });
};

// eslint-disable-next-line no-unused-vars -- Express identifies the error
// handler by its four-parameter arity; `next` must stay in the signature.
const errorHandler = (error, req, res, next) => {
  const apiError = normalize(error);

  const context = {
    method: req.method,
    path: req.originalUrl,
    statusCode: apiError.statusCode,
    requestId: req.id,
    userId: req.user?.id,
    tenantId: req.tenantId,
  };

  if (apiError.statusCode >= 500 || !apiError.isOperational) {
    logger.error(apiError.message, { ...context, stack: apiError.stack });
  } else {
    logger.warn(apiError.message, context);
  }

  // Unexpected failures never leak their message or stack to the client.
  const expose = apiError.isOperational && apiError.statusCode < 500;

  res.status(apiError.statusCode).json({
    success: false,
    statusCode: apiError.statusCode,
    message: expose ? apiError.message : 'Internal server error',
    ...(expose && apiError.details ? { details: apiError.details } : {}),
    ...(apiError.code ? { code: apiError.code } : {}),
    ...(env.isProduction ? {} : { stack: apiError.stack }),
  });
};

export default errorHandler;
