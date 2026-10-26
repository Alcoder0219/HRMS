import Joi from 'joi';

import {
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
  // Shape-checked, not registry-checked -- roles now live in the `Role`
  // collection, so the real check is the model's dynamic validator.
  role: Joi.string().trim().max(40).allow('', null),
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
  role: Joi.string().trim().max(40).required(),
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
  role: Joi.string().trim().max(40),
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
  tinNumber: Joi.string().trim().max(20).allow('', null),
  nssfCode: Joi.string().trim().max(30).allow('', null),
  nhifCode: Joi.string().trim().max(30).allow('', null),
  wcfCode: Joi.string().trim().max(30).allow('', null),
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

/* ----------------------------------------------------- biometric devices -- */

/**
 * An IPv4 address or a hostname.
 *
 * Joi's `.ip()` would reject `zk-gate-1.local`, and terminals are routinely
 * reached by name on an office network. Both forms are accepted and neither is
 * resolved here -- the device either answers when it is polled or it does not,
 * and that is a better test than a regex.
 */
const deviceHost = Joi.alternatives()
  .try(
    Joi.string().ip({ version: ['ipv4', 'ipv6'] }),
    Joi.string()
      .trim()
      .hostname()
      .max(45),
  )
  .messages({ 'alternatives.match': 'Enter an IP address or a hostname' });

const deviceBody = {
  name: Joi.string().trim().min(2).max(100),
  ipAddress: deviceHost,
  port: Joi.number().integer().min(1).max(65535),
  protocol: Joi.string().valid('ZK_UDP', 'ZK_TCP', 'ZK_WEB', 'GENERIC_API', 'WDMS_API', 'ADMS_PUSH'),
  serialNumber: Joi.string().trim().max(60).allow('', null),
  acceptPunchesFrom: Joi.date().iso().allow(null),

  /* ------------------------------------------------- WDMS credentials -- */
  username: Joi.string().trim().max(150).allow('', null),
  // The masked placeholder is accepted and means "leave it as it is", so a
  // save from a loaded form does not have to resend the secret.
  password: Joi.string().max(200).allow('', null),
  wdmsTerminalSerial: Joi.string().trim().max(60).allow('', null),

  isActive: Joi.boolean(),
  autoSync: Joi.boolean(),
  // A minute is the floor because the scheduler ticks every minute; anything
  // shorter would not run more often, it would only look as though it should.
  syncIntervalMinutes: Joi.number().integer().min(1).max(1440),
};

/**
 * A WDMS server is useless without credentials, so it will not be saved
 * without them.
 *
 * Caught here rather than at the first sync: a device that looks configured and
 * fails silently every five minutes is exactly the failure this whole feature
 * is meant to make visible.
 */
/**
 * An ADMS device is the mirror image: it has no address worth typing -- it
 * calls in from wherever the office router puts it -- and is known only by its
 * serial, so the serial is mandatory and the address is not.
 */
const pushSerial = Joi.string()
  .trim()
  .pattern(/^[A-Za-z0-9_-]{4,60}$/)
  .required()
  .messages({
    'any.required': 'An ADMS device needs the serial number shown in its System Info',
    'string.empty': 'An ADMS device needs the serial number shown in its System Info',
    'string.pattern.base': 'A serial number is 4–60 letters, digits, dashes or underscores',
  });

export const createBiometricDeviceSchema = Joi.object(deviceBody)
  .fork(['name', 'port'], (schema) => schema.required())
  .when(Joi.object({ protocol: Joi.valid('ADMS_PUSH') }).unknown(), {
    then: Joi.object({ serialNumber: pushSerial, ipAddress: deviceHost.allow('', null) }),
    otherwise: Joi.object({ ipAddress: deviceHost.required() }),
  })
  .when(Joi.object({ protocol: Joi.valid('WDMS_API') }).unknown(), {
    then: Joi.object({
      username: Joi.string().trim().min(1).max(150).required().messages({
        'any.required': 'A WDMS server needs a username',
      }),
      password: Joi.string().min(1).max(200).required().messages({
        'any.required': 'A WDMS server needs a password',
      }),
    }),
  });

export const updateBiometricDeviceSchema = Joi.object(deviceBody)
  .min(1)
  .messages({ 'object.min': 'Nothing to update' });

export const deviceIdParamSchema = Joi.object({
  deviceId: objectId.required().messages({
    'string.hex': 'Must be a valid device identifier',
    'string.length': 'Must be a valid device identifier',
  }),
});

/**
 * The whole mapping table, replaced in one write.
 *
 * An empty array is allowed and means "this device maps to nobody", which is a
 * legitimate thing to save -- it is how an administrator clears a table.
 */
export const mapDeviceUsersSchema = Joi.object({
  mappings: Joi.array()
    .items(
      Joi.object({
        deviceUserId: Joi.string().trim().max(30).required(),
        employeeCode: Joi.string().trim().uppercase().max(20).required(),
        deviceUserName: Joi.string().trim().max(120).allow('', null),
      }),
    )
    .max(5000)
    .required(),
});

const paging = {
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(200).default(25),
};

export const deviceEventsQuerySchema = Joi.object({
  ...paging,
  status: Joi.string().valid('IMPORTED', 'UNMAPPED', 'HELD', 'IGNORED', 'FAILED', 'PENDING'),
  from: Joi.date().iso(),
  to: Joi.date().iso().min(Joi.ref('from')),
});

export const deviceLogsQuerySchema = Joi.object(paging);

/**
 * Reprocess. HELD events are opt-in because including them overrides a human
 * correction; IGNORED ones are opt-in because they are a backlog someone chose
 * not to import.
 */
export const reprocessDeviceSchema = Joi.object({
  includeHeld: Joi.boolean().default(false),
  includeIgnored: Joi.boolean().default(false),
  acceptPunchesFrom: Joi.date().iso().allow(null),
  from: Joi.date().iso(),
  to: Joi.date().iso().min(Joi.ref('from')),
});

export const deviceCommandSchema = Joi.object({
  type: Joi.string().valid('QUERY_ATTLOG', 'QUERY_USERINFO', 'INFO').required(),
  from: Joi.date().iso().when('type', { is: 'QUERY_ATTLOG', then: Joi.required() }),
  to: Joi.date().iso().min(Joi.ref('from')).when('type', { is: 'QUERY_ATTLOG', then: Joi.required() }),
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

  createBiometricDeviceSchema,
  updateBiometricDeviceSchema,
  deviceIdParamSchema,
  mapDeviceUsersSchema,
  deviceEventsQuerySchema,
  deviceLogsQuerySchema,
  reprocessDeviceSchema,
  deviceCommandSchema,
};
