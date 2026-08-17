import Joi from 'joi';
import ApiError from '../../utils/ApiError.js';
import { MASTER_KEYS } from '../../services/organization/organizationMaster.service.js';

/**
 * Validation for the organization master management endpoints.
 *
 * One body schema per master, selected by the `:master` path segment. The
 * alternative -- a single permissive schema -- would let a shift's `startTime`
 * be posted to a grade and silently dropped, which is exactly the class of
 * mistake validation exists to catch.
 */

const objectId = Joi.string().hex().length(24).messages({
  'string.hex': 'Must be a valid identifier',
  'string.length': 'Must be a valid identifier',
});

const code = Joi.string().trim().uppercase().min(1).max(20);
const money = Joi.number().min(0).max(100_000_000);

/** Optional single-line text that a form may legitimately submit as blank. */
const optionalText = (max) => Joi.string().trim().max(max).allow('', null);

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const time = Joi.string()
  .trim()
  .pattern(TIME)
  .messages({ 'string.pattern.base': 'Use 24-hour HH:mm, for example 09:30' });

/* ---------------------------------------------------------------- bodies -- */

const bodies = {
  units: {
    name: Joi.string().trim().min(2).max(120),
    code,
    city: optionalText(80),
    state: optionalText(80),
    address: optionalText(300),
    pfEstablishmentCode: optionalText(40),
    esiEstablishmentCode: optionalText(40),
    ptState: optionalText(60),
    lwfState: optionalText(60),
    isActive: Joi.boolean(),
  },

  departments: {
    name: Joi.string().trim().min(2).max(100),
    code,
    description: optionalText(500),
    headId: objectId.allow('', null),
    parentId: objectId.allow('', null),
    isActive: Joi.boolean(),
  },

  designations: {
    name: Joi.string().trim().min(2).max(100),
    code,
    level: Joi.number().integer().min(1).max(20),
    departmentId: objectId.allow('', null),
    isActive: Joi.boolean(),
  },

  grades: {
    name: Joi.string().trim().min(1).max(60),
    code,
    level: Joi.number().integer().min(1).max(100),
    minGross: money,
    maxGross: money,
    description: optionalText(250),
    isActive: Joi.boolean(),
  },

  shifts: {
    name: Joi.string().trim().min(2).max(60),
    code,
    startTime: time,
    endTime: time,
    breakMinutes: Joi.number().integer().min(0).max(480),
    isNightShift: Joi.boolean(),
    weeklyOffs: Joi.array().items(Joi.number().integer().min(0).max(6)).max(7),
    isActive: Joi.boolean(),
  },
};

/**
 * A band whose ceiling sits below its floor would accept every salary and
 * reject none, so it is caught here as well as in the model -- the client gets
 * a field-level message instead of a generic 500 from the schema hook.
 */
const gradeBand = (schema) =>
  schema.custom((value, helpers) => {
    const { minGross, maxGross } = value;
    if (minGross !== undefined && maxGross !== undefined && maxGross > 0 && maxGross < minGross) {
      return helpers.message('Max gross cannot be below min gross');
    }
    return value;
  });

/** Required fields on create; every field optional on update (a partial patch). */
const bodyFor = (master, { partial }) => {
  const shape = bodies[master];
  if (!shape) return Joi.object();

  const required = ['name', 'code', ...(master === 'shifts' ? ['startTime', 'endTime'] : [])];

  const built = Joi.object(
    Object.fromEntries(
      Object.entries(shape).map(([field, rule]) => [
        field,
        partial || !required.includes(field) ? rule : rule.required(),
      ]),
    ),
  );

  const withBand = master === 'grades' ? gradeBand(built) : built;

  // An empty PATCH is a mistake, not a no-op worth a database round trip.
  return partial ? withBand.min(1) : withBand;
};

const masterParam = Joi.string()
  .valid(...MASTER_KEYS)
  .required()
  .messages({ 'any.only': 'Unknown organization master' });

/* ---------------------------------------------------------------- schemas -- */

export const listMasterSchema = {
  params: Joi.object({ master: masterParam }),
  query: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(200).default(25),
    search: Joi.string().trim().max(100).allow(''),
    // Defaults to everything: a management screen must show retired rows, which
    // is precisely what the picker endpoints hide.
    status: Joi.string().valid('active', 'inactive', 'all').default('all'),
    sortBy: Joi.string().max(40),
    sortOrder: Joi.string().valid('asc', 'desc').default('asc'),
  }),
};

export const masterIdSchema = {
  params: Joi.object({ master: masterParam, id: objectId.required() }),
};

/**
 * Params only. The body shape depends on which master the path names, which Joi
 * cannot resolve in the same pass -- `validateMasterBody` below handles it.
 */
export const masterParamSchema = {
  params: Joi.object({ master: masterParam }),
};

export const statusSchema = {
  params: Joi.object({ master: masterParam, id: objectId.required() }),
  body: Joi.object({ isActive: Joi.boolean().required() }),
};

export const auditSchema = {
  params: Joi.object({ master: masterParam, id: objectId.required() }),
  query: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
  }),
};

export const transferSchema = {
  params: Joi.object({ master: masterParam }),
  query: Joi.object({
    search: Joi.string().trim().max(100).allow(''),
    status: Joi.string().valid('active', 'inactive', 'all').default('all'),
    sortBy: Joi.string().max(40),
    sortOrder: Joi.string().valid('asc', 'desc').default('asc'),
  }),
};

export const templateSchema = {
  params: Joi.object({ master: masterParam }),
};

/**
 * Body validation for create and update.
 *
 * Joi cannot select a body shape from a path parameter in one pass, so this is
 * middleware rather than a schema: it reads `:master`, picks the matching
 * schema and validates in place. Unknown keys are rejected, so a field the
 * client invented fails loudly instead of vanishing.
 */
export const validateMasterBody = (partial) => (req, _res, next) => {
  const schema = bodyFor(req.params.master, { partial });

  const { error, value } = schema.validate(req.body, {
    abortEarly: false,
    allowUnknown: false,
    stripUnknown: false,
    convert: true,
  });

  if (error) {
    // Raised exactly as middlewares/validate.js does, so the client's error
    // handling needs no second case for these routes.
    return next(
      ApiError.unprocessable(
        'Validation failed',
        error.details.map((detail) => ({
          field: detail.path.join('.'),
          message: detail.message,
          in: 'body',
        })),
      ),
    );
  }

  req.body = value;
  return next();
};

export default {
  listMasterSchema,
  masterIdSchema,
  masterParamSchema,
  statusSchema,
  auditSchema,
  transferSchema,
  templateSchema,
  validateMasterBody,
};
