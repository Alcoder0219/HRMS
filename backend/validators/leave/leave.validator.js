import Joi from 'joi';
import {
  LEAVE_STATUS,
  LEAVE_SESSION,
  LEAVE_ACCRUAL,
} from '../../utils/constants.js';

const objectId = Joi.string().hex().length(24).messages({
  'string.hex': 'Must be a valid identifier',
  'string.length': 'Must be a valid identifier',
});

const year = Joi.number().integer().min(2000).max(2100);
const days = (max = 365) => Joi.number().min(0).max(max);

const paging = {
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(200).default(25),
};

/* ------------------------------------------------------------ leave types -- */

const typeShape = {
  name: Joi.string().trim().min(2).max(80),
  code: Joi.string().trim().uppercase().min(1).max(20),
  description: Joi.string().trim().max(300).allow('', null),

  daysPerYear: days(),
  accrual: Joi.string().valid(...Object.values(LEAVE_ACCRUAL)),
  isPaid: Joi.boolean(),

  applicableAfterMonths: Joi.number().integer().min(0).max(60),
  applicableGender: Joi.string().valid('MALE', 'FEMALE', 'OTHER').allow(null),

  allowHalfDay: Joi.boolean(),
  minNoticeDays: Joi.number().integer().min(0).max(90),
  maxConsecutiveDays: Joi.number().integer().min(0).max(365),
  requiresDocumentAfterDays: Joi.number().integer().min(0).max(365),
  requiresApproval: Joi.boolean(),
  countsHolidays: Joi.boolean(),
  allowNegativeBalance: Joi.boolean(),

  carryForward: Joi.object({
    enabled: Joi.boolean(),
    maxDays: days(),
    expiryMonths: Joi.number().integer().min(1).max(60),
  }),

  encashment: Joi.object({
    enabled: Joi.boolean(),
    maxDays: days(),
    minBalanceToRetain: days(),
  }),

  colour: Joi.string().trim().max(20).allow('', null),
  isActive: Joi.boolean(),
};

export const listTypesSchema = {
  query: Joi.object({
    ...paging,
    search: Joi.string().trim().max(100).allow(''),
    status: Joi.string().valid('active', 'inactive', 'all').default('all'),
    sortBy: Joi.string().max(40),
    sortOrder: Joi.string().valid('asc', 'desc').default('asc'),
  }),
};

/**
 * Cross-field rules the model also enforces.
 *
 * The model's pre-validate hook is the backstop, but an error thrown there
 * surfaces as a 500 -- it is a raw Error, not an ApiError, and the handler has
 * no reason to treat it as the client's fault. Checking here turns the same
 * mistake into a 422 naming the field, which is what a form can act on.
 */
const withCapRules = (schema) =>
  schema.custom((value, helpers) => {
    const entitlement = value.daysPerYear;
    if (entitlement === undefined) return value;

    if (value.carryForward?.enabled && value.carryForward.maxDays > entitlement && entitlement > 0) {
      return helpers.message('Carry-forward days cannot exceed the annual entitlement');
    }

    if (value.encashment?.enabled && value.encashment.maxDays > entitlement && entitlement > 0) {
      return helpers.message('Encashable days cannot exceed the annual entitlement');
    }

    return value;
  });

export const createTypeSchema = {
  body: withCapRules(Joi.object(typeShape).fork(['name', 'code'], (rule) => rule.required())),
};

export const updateTypeSchema = {
  params: Joi.object({ id: objectId.required() }),
  body: withCapRules(Joi.object(typeShape).min(1)),
};

export const idParamSchema = {
  params: Joi.object({ id: objectId.required() }),
};

export const statusSchema = {
  params: Joi.object({ id: objectId.required() }),
  body: Joi.object({ isActive: Joi.boolean().required() }),
};

/* --------------------------------------------------------------- balances -- */

export const listBalancesSchema = {
  query: Joi.object({
    ...paging,
    year: year.default(() => new Date().getFullYear()),
    leaveTypeId: objectId,
    employeeId: objectId,
  }),
};

export const employeeBalancesSchema = {
  query: Joi.object({
    employeeId: objectId,
    year: year.default(() => new Date().getFullYear()),
  }),
};

export const carryForwardSchema = {
  body: Joi.object({
    fromYear: year.required(),
    // Only ever the next year: carrying across a gap would silently skip a
    // year's lapses.
    toYear: year.required().valid(Joi.ref('fromYear', { adjust: (value) => value + 1 })).messages({
      'any.only': 'Leave can only be carried into the following year',
    }),
    leaveTypeId: objectId,
  }),
};

export const encashSchema = {
  params: Joi.object({ id: objectId.required() }),
  body: Joi.object({
    days: days().min(0.5).required(),
    note: Joi.string().trim().max(250).allow('', null),
  }),
};

export const adjustSchema = {
  params: Joi.object({ id: objectId.required() }),
  body: Joi.object({
    // Signed: a correction can take days away as well as grant them.
    days: Joi.number().min(-365).max(365).invalid(0).required().messages({
      'any.invalid': 'An adjustment of zero days changes nothing',
    }),
    note: Joi.string().trim().min(3).max(250).required().messages({
      'any.required': 'Say why the balance is being adjusted',
    }),
  }),
};

/* --------------------------------------------------------------- requests -- */

const requestShape = {
  employeeId: objectId,
  leaveTypeId: objectId.required(),
  from: Joi.date().required(),
  to: Joi.date().min(Joi.ref('from')).required().messages({
    'date.min': 'The last day of leave cannot be before the first',
  }),
  isHalfDay: Joi.boolean().default(false),
  session: Joi.string().valid(...Object.values(LEAVE_SESSION)).allow(null),
  reason: Joi.string().trim().min(3).max(500).required(),
  contactDuringLeave: Joi.string().trim().max(60).allow('', null),
};

export const previewSchema = {
  body: Joi.object({ ...requestShape, reason: Joi.string().trim().max(500).allow('', null) }),
};

export const applySchema = {
  body: Joi.object(requestShape),
};

export const listRequestsSchema = {
  query: Joi.object({
    ...paging,
    status: Joi.string().valid(...Object.values(LEAVE_STATUS)),
    leaveTypeId: objectId,
    employeeId: objectId,
    year,
    from: Joi.date(),
    to: Joi.date().min(Joi.ref('from')),
    mine: Joi.boolean().default(false),
    sortBy: Joi.string().max(40),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
  }),
};

export const decisionSchema = {
  params: Joi.object({ id: objectId.required() }),
  body: Joi.object({
    decision: Joi.string().valid(LEAVE_STATUS.APPROVED, LEAVE_STATUS.REJECTED).required(),
    comment: Joi.string().trim().max(500).allow('', null),
  }).when(Joi.object({ decision: Joi.valid(LEAVE_STATUS.REJECTED) }).unknown(), {
    // Refusing leave without saying why guarantees the question comes back.
    then: Joi.object({ comment: Joi.string().trim().min(3).max(500).required() }),
  }),
};

export const cancelSchema = {
  params: Joi.object({ id: objectId.required() }),
  body: Joi.object({ reason: Joi.string().trim().max(300).allow('', null) }).default({}),
};

export const calendarSchema = {
  query: Joi.object({
    from: Joi.date().required(),
    to: Joi.date().min(Joi.ref('from')).required(),
    departmentId: objectId,
  }),
};

export const reportSchema = {
  query: Joi.object({
    year: year.default(() => new Date().getFullYear()),
    leaveTypeId: objectId,
    departmentId: objectId,
  }),
};

export default {
  listTypesSchema,
  createTypeSchema,
  updateTypeSchema,
  idParamSchema,
  statusSchema,
  listBalancesSchema,
  employeeBalancesSchema,
  carryForwardSchema,
  encashSchema,
  adjustSchema,
  previewSchema,
  applySchema,
  listRequestsSchema,
  decisionSchema,
  cancelSchema,
  calendarSchema,
  reportSchema,
};
