import Joi from 'joi';

import {
  EMPLOYEE_STATUS,
  ATTENDANCE_STATUS,
  LEAVE_STATUS,
  LOAN_STATUS,
  LOAN_TYPES,
  SETTLEMENT_STATUS,
  SETTLEMENT_TRIGGER,
  ASSET_STATUS,
  ASSET_CATEGORY,
} from '../../utils/constants.js';

const objectId = Joi.string().hex().length(24);
const isoDate = Joi.string().isoDate();

/**
 * One query schema for every report rather than eight.
 *
 * The alternative -- a schema per slug -- reads tidier but fails the moment a
 * caller keeps a filter in the URL while switching reports, which is exactly
 * what the report switcher does. Unknown-but-declared filters are simply
 * ignored by the builder that does not use them.
 *
 * `status` is the one field whose vocabulary genuinely differs per report, so
 * it is validated as the union and the builder narrows it. A leave status sent
 * to the asset report matches nothing and returns an empty set, which is the
 * honest answer rather than a 422 about a filter the user did not type.
 */
const statusValues = [
  ...new Set([
    ...Object.values(EMPLOYEE_STATUS),
    ...Object.values(ATTENDANCE_STATUS),
    ...Object.values(LEAVE_STATUS),
    ...Object.values(LOAN_STATUS),
    ...Object.values(SETTLEMENT_STATUS),
    ...Object.values(ASSET_STATUS),
  ]),
];

/**
 * The slug is deliberately NOT validated here.
 *
 * It names a resource in the path, so an unknown one is a 404, not a 422 about
 * malformed input -- and Joi runs before the controller, so validating it here
 * would make the service's 404 unreachable. The registry lookup is the check,
 * which also keeps the list of reports in one place instead of two.
 */

export const reportQuerySchema = Joi.object({
  // Organisation scope
  departmentId: objectId.allow('', null),
  unitId: objectId.allow('', null),
  designationId: objectId.allow('', null),
  employeeId: objectId.allow('', null),

  // Period
  year: Joi.number().integer().min(2000).max(2100),
  month: Joi.number().integer().min(1).max(12),
  from: isoDate.allow('', null),
  to: isoDate.allow('', null),
  joinedFrom: isoDate.allow('', null),
  joinedTo: isoDate.allow('', null),

  // Report-specific
  status: Joi.string()
    .valid(...statusValues)
    .allow('', null),
  trigger: Joi.string()
    .valid(...Object.values(SETTLEMENT_TRIGGER))
    .allow('', null),
  category: Joi.string()
    .valid(...Object.values(ASSET_CATEGORY))
    .allow('', null),
  type: Joi.string()
    .valid(...Object.values(LOAN_TYPES))
    .allow('', null),
  leaveTypeId: objectId.allow('', null),
  jobOpeningId: objectId.allow('', null),
  payrollRunId: objectId.allow('', null),

  // Presentation
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(200).default(25),
  sortBy: Joi.string().max(40).allow('', null),
  sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
}).custom((value, helpers) => {
  if (value.from && value.to && value.from > value.to) {
    return helpers.message('"from" cannot be later than "to"');
  }
  if (value.joinedFrom && value.joinedTo && value.joinedFrom > value.joinedTo) {
    return helpers.message('"joined from" cannot be later than "joined to"');
  }
  return value;
});

/** The exporters run the whole set, so pagination is not part of their contract. */
export const exportQuerySchema = reportQuerySchema.fork(['page', 'limit'], (schema) => schema.strip());

export default { reportQuerySchema, exportQuerySchema };
