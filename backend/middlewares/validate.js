import ApiError from '../utils/ApiError.js';

const TARGETS = ['body', 'query', 'params'];

/**
 * Runs Joi schemas against the request and replaces each validated section
 * with Joi's coerced, stripped output -- so controllers receive typed, known
 * fields only and unknown keys never reach a service.
 *
 * Express 5 makes `req.query` a lazily-computed getter, so the sanitized query
 * is written to `req.validatedQuery` instead of being assigned back.
 */
const validate = (schemas) => (req, _res, next) => {
  const errors = [];

  for (const target of TARGETS) {
    const schema = schemas[target];
    if (!schema) continue;

    const { value, error } = schema.validate(req[target], {
      abortEarly: false, // Report every problem at once, not one per round trip
      stripUnknown: true,
      convert: true,
    });

    if (error) {
      errors.push(
        ...error.details.map((detail) => ({
          field: detail.path.join('.'),
          message: detail.message,
          in: target,
        })),
      );
      continue;
    }

    if (target === 'query') req.validatedQuery = value;
    else req[target] = value;
  }

  if (errors.length) return next(ApiError.unprocessable('Validation failed', errors));

  return next();
};

export default validate;
