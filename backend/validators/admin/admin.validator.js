import Joi from 'joi';

import {
  ROLES,
  ACCOUNT_STATUS,
  AUDIT_ACTIONS,
  LOGIN_EVENTS,
  LOGIN_STATUS,
} from '../../utils/constants.js';
import { RESTORE_MODES, CONFIRMATION_PHRASE } from '../../services/admin/backup.service.js';

const objectId = Joi.string().hex().length(24);
const isoDate = Joi.string().isoDate();

/**
 * Shape-checked, not registry-checked -- the same rule the auth and employee
 * validators use.
 *
 * Joi's default `.email()` validates the TLD against the IANA list, which
 * rejects the internal domains organisations actually run on. This product
 * seeds its own administrator as `super.admin@hrms.local`; a stricter rule
 * here would refuse to create a second account alongside it.
 */
const emailAddress = () => Joi.string().trim().lowercase().email({ minDomainSegments: 2, tlds: { allow: false } });

const pagination = {
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(200).default(25),
  sortBy: Joi.string().max(40).allow('', null),
  sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
};

/**
 * Passwords set by an administrator meet the same bar as one a user chooses.
 *
 * A weaker rule here would make "ask an admin to reset it" the way around the
 * policy, which is precisely the door worth keeping shut.
 */
const password = Joi.string()
  .min(10)
  .max(128)
  .pattern(/[a-z]/, 'a lowercase letter')
  .pattern(/[A-Z]/, 'an uppercase letter')
  .pattern(/[0-9]/, 'a digit')
  .messages({ 'string.pattern.name': 'The password must contain {#name}' });

/* ------------------------------------------------------------------- users */

export const idParamSchema = Joi.object({ id: objectId.required() });

export const listUsersSchema = Joi.object({
  ...pagination,
  search: Joi.string().trim().max(120).allow('', null),
  role: Joi.string().valid(...Object.values(ROLES)).allow('', null),
  status: Joi.string().valid(...Object.values(ACCOUNT_STATUS)).allow('', null),
  isEmailVerified: Joi.boolean().allow('', null),
  linked: Joi.string().valid('true', 'false').allow('', null),
});

export const createUserSchema = Joi.object({
  email: emailAddress().max(150).required(),
  password: password.required(),
  firstName: Joi.string().trim().min(1).max(60).required(),
  lastName: Joi.string().trim().min(1).max(60).required(),
  phone: Joi.string().trim().max(20).allow('', null),
  role: Joi.string().valid(...Object.values(ROLES)).required(),
  employeeId: objectId.allow(null),
  departmentId: objectId.allow(null),
  status: Joi.string().valid(...Object.values(ACCOUNT_STATUS)),
  mustChangePassword: Joi.boolean(),
  isEmailVerified: Joi.boolean(),
});

export const updateUserSchema = Joi.object({
  firstName: Joi.string().trim().min(1).max(60),
  lastName: Joi.string().trim().min(1).max(60),
  phone: Joi.string().trim().max(20).allow('', null),
  role: Joi.string().valid(...Object.values(ROLES)),
  employeeId: objectId.allow(null),
  departmentId: objectId.allow(null),
  mustChangePassword: Joi.boolean(),
})
  .min(1)
  .messages({ 'object.min': 'Nothing to update' });

export const userStatusSchema = Joi.object({
  status: Joi.string().valid(...Object.values(ACCOUNT_STATUS)).required(),
  reason: Joi.string().trim().max(300).allow('', null),
});

export const resetPasswordSchema = Joi.object({
  password: password.required(),
  notify: Joi.boolean().default(false),
});

/* -------------------------------------------------------------- audit logs */

export const listAuditSchema = Joi.object({
  ...pagination,
  search: Joi.string().trim().max(120).allow('', null),
  entity: Joi.string().trim().max(60).allow('', null),
  action: Joi.string().valid(...Object.values(AUDIT_ACTIONS)).allow('', null),
  actorId: objectId.allow('', null),
  entityId: objectId.allow('', null),
  from: isoDate.allow('', null),
  to: isoDate.allow('', null),
  format: Joi.string().valid('excel', 'pdf').allow('', null),
}).custom((value, helpers) =>
  value.from && value.to && value.from > value.to
    ? helpers.message('"from" cannot be later than "to"')
    : value,
);

export const listLoginHistorySchema = Joi.object({
  ...pagination,
  search: Joi.string().trim().max(120).allow('', null),
  status: Joi.string().valid(...Object.values(LOGIN_STATUS)).allow('', null),
  event: Joi.string().valid(...Object.values(LOGIN_EVENTS)).allow('', null),
  userId: objectId.allow('', null),
  from: isoDate.allow('', null),
  to: isoDate.allow('', null),
});

export const activitySchema = Joi.object({
  ...pagination,
  search: Joi.string().trim().max(120).allow('', null),
  kind: Joi.string().valid('CHANGE', 'ACCESS').allow('', null),
  actorId: objectId.allow('', null),
  from: isoDate.allow('', null),
  to: isoDate.allow('', null),
});

export const statsSchema = Joi.object({
  days: Joi.number().integer().min(1).max(90).default(30),
});

/* ---------------------------------------------------------------- settings */

export const companySchema = Joi.object({
  name: Joi.string().trim().max(150).allow('', null),
  legalName: Joi.string().trim().max(200).allow('', null),
  registrationNumber: Joi.string().trim().max(60).allow('', null),
  taxNumber: Joi.string().trim().max(30).allow('', null),
  pan: Joi.string().trim().max(10).allow('', null),
  pfCode: Joi.string().trim().max(30).allow('', null),
  esiCode: Joi.string().trim().max(30).allow('', null),
  email: emailAddress().max(120).allow('', null),
  phone: Joi.string().trim().max(20).allow('', null),
  website: Joi.string().trim().max(150).allow('', null),
  addressLine1: Joi.string().trim().max(150).allow('', null),
  addressLine2: Joi.string().trim().max(150).allow('', null),
  city: Joi.string().trim().max(80).allow('', null),
  state: Joi.string().trim().max(80).allow('', null),
  country: Joi.string().trim().max(80).allow('', null),
  postalCode: Joi.string().trim().max(12).allow('', null),
  financialYearStartMonth: Joi.number().integer().min(1).max(12),
  dateFormat: Joi.string().trim().max(20).allow('', null),
  currency: Joi.string().trim().length(3).allow('', null),
  timezone: Joi.string().trim().max(60).allow('', null),
})
  .min(1)
  .messages({ 'object.min': 'Nothing to update' });

export const emailConfigSchema = Joi.object({
  enabled: Joi.boolean(),
  host: Joi.string().trim().max(150).allow('', null),
  port: Joi.number().integer().min(1).max(65535),
  secure: Joi.boolean(),
  username: Joi.string().trim().max(150).allow('', null),
  // The masked placeholder is accepted and means "leave it as it is", so a
  // save from a loaded form does not have to resend the secret.
  password: Joi.string().max(200).allow('', null),
  clearPassword: Joi.boolean(),
  fromName: Joi.string().trim().max(100).allow('', null),
  fromAddress: emailAddress().max(150).allow('', null),
  replyTo: emailAddress().max(150).allow('', null),
})
  .min(1)
  .messages({ 'object.min': 'Nothing to update' });

export const testEmailSchema = Joi.object({
  to: emailAddress().max(150).allow('', null),
});

export const notificationSchema = Joi.object({
  leaveRequested: Joi.boolean(),
  leaveDecided: Joi.boolean(),
  payslipPublished: Joi.boolean(),
  attendanceMissing: Joi.boolean(),
  regularizationRaised: Joi.boolean(),
  loanDecided: Joi.boolean(),
  settlementApproved: Joi.boolean(),
  offerSent: Joi.boolean(),
  interviewScheduled: Joi.boolean(),
  accountLocked: Joi.boolean(),
  passwordChanged: Joi.boolean(),
  adminRecipients: Joi.array().items(emailAddress()).max(10),
  dailyDigestHour: Joi.number().integer().min(0).max(23).allow(null),
})
  .min(1)
  .messages({ 'object.min': 'Nothing to update' });

export const maintenanceSchema = Joi.object({
  enabled: Joi.boolean().required(),
  message: Joi.string().trim().max(300).allow('', null),
});

/* --------------------------------------------------------------- restore -- */

/**
 * A restore is a preview unless the caller says otherwise, in writing.
 *
 * `dryRun` defaults to true, and applying additionally requires the literal
 * confirmation phrase. Two independent things must be wrong for a destructive
 * restore to happen by accident, which is the point.
 */
export const restoreSchema = Joi.object({
  mode: Joi.string()
    .valid(...Object.values(RESTORE_MODES))
    .default(RESTORE_MODES.MERGE),
  dryRun: Joi.boolean().default(true),
  confirm: Joi.string().max(40).allow('', null),
  archive: Joi.alternatives().try(Joi.object(), Joi.string()),
}).custom((value, helpers) => {
  if (value.dryRun === false && value.confirm !== CONFIRMATION_PHRASE) {
    return helpers.message(`Type ${CONFIRMATION_PHRASE} to confirm a restore`);
  }
  return value;
});

export default {
  idParamSchema,
  listUsersSchema,
  createUserSchema,
  updateUserSchema,
  userStatusSchema,
  resetPasswordSchema,
  listAuditSchema,
  listLoginHistorySchema,
  activitySchema,
  statsSchema,
  companySchema,
  emailConfigSchema,
  testEmailSchema,
  notificationSchema,
  maintenanceSchema,
  restoreSchema,
};
