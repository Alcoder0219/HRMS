import Joi from 'joi';
import {
  GENDER,
  BLOOD_GROUPS,
  MARITAL_STATUS,
  EMPLOYMENT_TYPE,
  EMPLOYEE_CATEGORY,
  EMPLOYEE_STATUS,
  BANK_ACCOUNT_TYPES,
  PAY_FREQUENCY,
  DOCUMENT_TYPES,
  OVERTIME_CALCULATION_METHOD,
  OVERTIME_MULTIPLIERS,
  PREMIUM_MULTIPLIERS,
  ROLES,
  ACCOUNT_STATUS,
} from '../../utils/constants.js';
import { checkPasswordStrength } from '../../helpers/password.helper.js';
import { SORTABLE_FIELDS } from '../../services/employee/employee.service.js';
// One definition of what an earning and a deduction are, shared with the model
// and the totals derivation, so the cross-field check cannot fall behind.
import {
  EARNING_COMPONENTS as EARNING_KEYS,
  EMPLOYEE_DEDUCTION_COMPONENTS as DEDUCTION_KEYS,
} from '../../models/employee/employee.model.js';

const objectId = Joi.string().hex().length(24).messages({
  'string.hex': 'Must be a valid identifier',
  'string.length': 'Must be a valid identifier',
});

const optionalObjectId = objectId.allow(null, '');

const name = (label, min = 1) =>
  Joi.string().trim().min(min).max(60).messages({
    'string.max': `${label} must be at most 60 characters`,
  });

const email = Joi.string()
  // The ICANN TLD list is off for the same reason as in auth: corporate
  // deployments use internal domains it would reject.
  .email({ minDomainSegments: 2, tlds: { allow: false } })
  .lowercase()
  .trim()
  .max(255)
  .allow(null, '')
  .messages({ 'string.email': 'Enter a valid email address' });

const phone = Joi.string()
  .trim()
  .pattern(/^[+\d][\d\s-]{6,19}$/)
  .allow(null, '')
  .messages({ 'string.pattern.base': 'Enter a valid phone number' });

const addressSchema = Joi.object({
  line1: Joi.string().trim().max(200).allow(null, ''),
  line2: Joi.string().trim().max(200).allow(null, ''),
  city: Joi.string().trim().max(80).allow(null, ''),
  state: Joi.string().trim().max(80).allow(null, ''),
  country: Joi.string().trim().max(80).allow(null, ''),
  postalCode: Joi.string().trim().max(12).allow(null, ''),
  landmark: Joi.string().trim().max(120).allow(null, ''),
});

const statutorySchema = Joi.object({
  nssfApplicable: Joi.boolean(),
  nssfNumber: Joi.string().trim().uppercase().max(20).allow(null, ''),
  nhifApplicable: Joi.boolean(),
  nhifNumber: Joi.string().trim().uppercase().max(20).allow(null, ''),

  /**
   * TIN, as the TRA issues it: nine digits, conventionally written in
   * 3-3-3 groups. Both forms are accepted, and the separators are not
   * stripped here -- the model stores what was entered, and a validator that
   * silently rewrites an identifier makes the stored value harder to match
   * against a paper certificate.
   */
  tinNumber: Joi.string()
    .trim()
    .pattern(/^\d{3}-?\d{3}-?\d{3}$/)
    .allow(null, '')
    .messages({ 'string.pattern.base': 'TIN must be 9 digits, e.g. 123-456-789' }),
  payeApplicable: Joi.boolean(),

  // NIDA numbers are 20 digits, usually written in dash-separated groups.
  nationalIdNumber: Joi.string().trim().max(25).allow(null, ''),
  nationalIdExpiry: Joi.date().allow(null, ''),

  workPermitNumber: Joi.string().trim().max(30).allow(null, ''),
  workPermitExpiry: Joi.date().allow(null, ''),

  passportNumber: Joi.string().trim().max(20).allow(null, ''),
  passportExpiry: Joi.date().allow(null, ''),
  drivingLicense: Joi.string().trim().max(25).allow(null, ''),
  drivingLicenseExpiry: Joi.date().allow(null, ''),
});

const money = (max = 10_000_000) => Joi.number().min(0).max(max).precision(2);

const bankDetailsSchema = Joi.object({
  accountHolderName: Joi.string().trim().max(120).allow(null, ''),
  accountNumber: Joi.string()
    .trim()
    .pattern(/^\d{6,20}$/)
    .allow(null, '')
    .messages({ 'string.pattern.base': 'Account number must be 6-20 digits' }),
  bankName: Joi.string().trim().max(120).allow(null, ''),
  branch: Joi.string().trim().max(120).allow(null, ''),
  /**
   * SWIFT/BIC: four letters for the bank, two for the country, two for the
   * location, and an optional three-character branch suffix. `XXX` in that
   * suffix means the head office, which is why the pattern allows X as a
   * character rather than only alphanumerics that identify a branch.
   */
  swiftCode: Joi.string()
    .trim()
    .uppercase()
    .pattern(/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/)
    .allow(null, '')
    .messages({ 'string.pattern.base': 'SWIFT code must look like CORUTZTZ or CORUTZTZXXX' }),
  branchCode: Joi.string().trim().uppercase().max(10).allow(null, ''),
  accountType: Joi.string().valid(...Object.values(BANK_ACCOUNT_TYPES)).allow(null, ''),
})
  // An account number without a SWIFT code cannot be paid into, and a SWIFT
  // code without an account number is meaningless. Requiring them together
  // stops a half-filled bank record reaching payroll.
  .and('accountNumber', 'swiftCode');

const emergencyContactSchema = Joi.object({
  name: Joi.string().trim().min(2).max(120).required(),
  relationship: Joi.string().trim().min(2).max(60).required(),
  phone: phone.required().disallow(null, ''),
  alternatePhone: phone,
  address: Joi.string().trim().max(250).allow(null, ''),
  isPrimary: Joi.boolean().default(false),
});

const salaryStructureSchema = Joi.object({
  ctc: Joi.number().min(0).max(1_000_000_000).allow(null),
  grade: Joi.string().trim().max(20).allow(null, ''),
  band: Joi.string().trim().max(20).allow(null, ''),
  payFrequency: Joi.string().valid(...Object.values(PAY_FREQUENCY)),
  effectiveFrom: Joi.date().allow(null, ''),
  structureId: optionalObjectId,

  /* ------------------------------------------- monthly components ------ */
  basic: money(),
  hraAllowance: money(),
  foodAllowance: money(),
  transportationAllowance: money(),
  communicationAllowance: money(),
  mediclaim: money(),
  schoolFeesAllowance: money(),
  // Per annum by entitlement, supplied as its monthly equivalent.
  annualLeaveAllowance: money(),
  performanceIncentive: money(),

  /* ---------------------------------------------- contributions -------- */
  nssfEmployee: money(),
  nssfEmployer: money(),
  nhif: money(1_000_000),
  // Employer only. Accepted so the record round-trips, never deducted.
  sdl: money(),
  wcf: money(),
  paye: money(),

  /**
   * Derived totals are accepted but never trusted -- the server recomputes
   * them from the components on every write. They are allowed through so the
   * client can round-trip a record it just fetched without a validation error.
   */
  grossSalary: money(),
  totalDeductions: money(),
  netSalary: money(),
})
  // A deduction total above the gross it comes out of is a data-entry slip
  // worth catching at the edge rather than after it reaches payroll.
  .custom((value, helpers) => {
    const gross = EARNING_KEYS.reduce((sum, key) => sum + (value[key] ?? 0), 0);
    const employeeDeductions = DEDUCTION_KEYS.reduce((sum, key) => sum + (value[key] ?? 0), 0);

    if (gross > 0 && employeeDeductions > gross) return helpers.error('salary.deductions');
    return value;
  })
  .messages({ 'salary.deductions': 'Total deductions cannot exceed gross salary' });

/**
 * Overtime configuration.
 *
 * Every field is optional so existing payloads validate unchanged, but the
 * combinations that would produce a meaningless rate are rejected: a custom
 * multiplier with no value, or a fixed-rate method with no rate.
 */
const overtimeSchema = Joi.object({
  eligible: Joi.boolean(),
  calculationMethod: Joi.string().valid(...Object.values(OVERTIME_CALCULATION_METHOD)),
  fixedHourlyRate: Joi.number().min(0).max(100_000).allow(null),
  workingHoursPerMonth: Joi.number().min(1).max(744).allow(null),

  multiplier: Joi.string().valid(...OVERTIME_MULTIPLIERS),
  customMultiplier: Joi.number().min(1).max(10).allow(null),

  maxDailyOT: Joi.number().min(0).max(24).allow(null).messages({
    'number.max': 'Daily overtime cannot exceed 24 hours',
  }),
  maxMonthlyOT: Joi.number().min(0).max(400).allow(null),

  weeklyHolidayMultiplier: Joi.string().valid(...PREMIUM_MULTIPLIERS),
  weeklyHolidayCustomMultiplier: Joi.number().min(1).max(10).allow(null),
  publicHolidayMultiplier: Joi.string().valid(...PREMIUM_MULTIPLIERS),
  publicHolidayCustomMultiplier: Joi.number().min(1).max(10).allow(null),
  nightShiftMultiplier: Joi.string().valid(...PREMIUM_MULTIPLIERS),
  nightShiftCustomMultiplier: Joi.number().min(1).max(10).allow(null),

  // Accepted but never trusted; the server recomputes all three on write.
  hourlySalary: Joi.number().min(0),
  overtimeRate: Joi.number().min(0),
  effectiveMultiplier: Joi.number().min(0),
})
  .custom((value, helpers) => {
    // Only meaningful when overtime is actually switched on; an ineligible
    // employee's leftover settings must not block a save.
    if (!value.eligible) return value;

    if (value.multiplier === 'CUSTOM' && !(value.customMultiplier > 0)) {
      return helpers.error('overtime.customMultiplier');
    }
    if (
      value.calculationMethod === OVERTIME_CALCULATION_METHOD.FIXED_HOURLY_RATE &&
      !(value.fixedHourlyRate > 0)
    ) {
      return helpers.error('overtime.fixedRate');
    }

    const premiums = [
      ['weeklyHolidayMultiplier', 'weeklyHolidayCustomMultiplier', 'Weekly holiday'],
      ['publicHolidayMultiplier', 'publicHolidayCustomMultiplier', 'Public holiday'],
      ['nightShiftMultiplier', 'nightShiftCustomMultiplier', 'Night shift'],
    ];

    for (const [selection, custom, label] of premiums) {
      if (value[selection] === 'CUSTOM' && !(value[custom] > 0)) {
        return helpers.error('overtime.customPremium', { label });
      }
    }

    if (value.maxDailyOT && value.maxMonthlyOT && value.maxDailyOT > value.maxMonthlyOT) {
      return helpers.error('overtime.capOrder');
    }

    return value;
  })
  .messages({
    'overtime.customMultiplier': 'Enter a custom overtime multiplier',
    'overtime.fixedRate': 'Enter the fixed hourly rate',
    'overtime.customPremium': '{{#label}} is set to Custom, so it needs a multiplier',
    'overtime.capOrder': 'The daily overtime cap cannot exceed the monthly cap',
  });

/* -------------------------------------------------------------- payloads */

/**
 * Every field is optional here. `create` forks the three that are mandatory,
 * and `update` uses it as-is -- so the two schemas cannot drift apart as fields
 * are added.
 */
const employeeBody = {
  employeeId: Joi.string().trim().max(30).allow(null, ''),
  firstName: name('First name', 2),
  middleName: name('Middle name').allow(null, ''),
  lastName: name('Last name').allow(null, ''),
  fatherName: Joi.string().trim().max(120).allow(null, ''),
  motherName: Joi.string().trim().max(120).allow(null, ''),

  gender: Joi.string().valid(...Object.values(GENDER)),
  dateOfBirth: Joi.date().max('now').allow(null, '').messages({
    'date.max': 'Date of birth cannot be in the future',
  }),
  bloodGroup: Joi.string().valid(...BLOOD_GROUPS).allow(null, ''),
  maritalStatus: Joi.string().valid(...Object.values(MARITAL_STATUS)).allow(null, ''),

  personalEmail: email,
  mobile: phone,
  alternateMobile: phone,
  workEmail: email,

  joiningDate: Joi.date().messages({ 'any.required': 'Joining date is required' }),
  confirmationDate: Joi.date().allow(null, ''),
  probationMonths: Joi.number().integer().min(0).max(24).allow(null),

  departmentId: optionalObjectId,
  designationId: optionalObjectId,
  shiftId: optionalObjectId,
  reportingManagerId: optionalObjectId,
  unitId: optionalObjectId,
  gradeId: optionalObjectId,
  salaryTemplateId: optionalObjectId,

  employmentType: Joi.string().valid(...Object.values(EMPLOYMENT_TYPE)),
  employeeCategory: Joi.string().valid(...Object.values(EMPLOYEE_CATEGORY)).allow(null, ''),
  overtimeEligible: Joi.boolean(),

  // The employee's full working day in minutes; attendance subtracts it from
  // hours worked to get overtime. Capped at a day, and null resets it to the
  // 08:30 company default rather than storing a zero-hour duty day -- which
  // would make every worked minute overtime.
  standardDutyMinutes: Joi.number().integer().min(0).max(1440).allow(null),
  overtime: overtimeSchema,
  workLocation: Joi.string().trim().max(120).allow(null, ''),

  salaryStructure: salaryStructureSchema,
  statutory: statutorySchema,
  bankDetails: bankDetailsSchema,
  emergencyContacts: Joi.array().items(emergencyContactSchema).max(5),

  currentAddress: addressSchema,
  permanentAddress: addressSchema,
  sameAsCurrentAddress: Joi.boolean(),

  remarks: Joi.string().trim().max(1000).allow(null, ''),
  notes: Joi.string().trim().max(4000).allow(null, ''),

  /* ------------------------------------------------------ portal access -- */
  /**
   * The login account, managed from the Employee form.
   *
   * These are not Employee fields -- the service splits them off and hands them
   * to the portal-access service, which owns the User record. They are declared
   * here because `stripUnknown` is on, and an undeclared field would be dropped
   * before the service ever saw it.
   */
  portalAccess: Joi.boolean(),
  portalEmail: email,
  /**
   * SUPER_ADMIN is absent on purpose, and this is the enforcing copy.
   *
   * It is a platform account that may have no employee at all, and granting it
   * from an HR form would be a route to the whole system. The role dropdown
   * omits it too, but a dropdown is a courtesy and this is the rule.
   */
  portalRole: Joi.string().valid(
    ...Object.values(ROLES).filter((role) => role !== ROLES.SUPER_ADMIN),
  ),
  /**
   * Blank means "generate one" on create and "leave it alone" on update, so an
   * empty string is accepted rather than rejected as too short.
   */
  portalPassword: Joi.string()
    .allow('', null)
    .custom((value, helpers) => {
      if (!value) return value;

      const failures = checkPasswordStrength(value);
      return failures.length ? helpers.message(failures.join('. ')) : value;
    }),
  portalStatus: Joi.string().valid(
    ACCOUNT_STATUS.ACTIVE,
    ACCOUNT_STATUS.SUSPENDED,
    ACCOUNT_STATUS.DEACTIVATED,
  ),
};

const employeeObject = Joi.object(employeeBody);

const REQUIRED_ON_CREATE = ['firstName', 'joiningDate'];

export const createEmployeeSchema = {
  body: employeeObject.fork(REQUIRED_ON_CREATE, (schema) => schema.required()),
};

export const updateEmployeeSchema = {
  params: Joi.object({ id: objectId.required() }),
  // At least one field must be present -- an empty PATCH is a client bug, and
  // silently returning 200 hides it.
  body: employeeObject.min(1),
};

/* ------------------------------------------- transfers and promotions -- */

/**
 * `type` selects which movements are returned. A designation change counts as a
 * promotion or a lateral transfer depending on the levels involved, which the
 * service decides -- see employeeMovement.service.js.
 */
const movementType = Joi.string().valid('transfer', 'promotion', 'all').default('all');

export const movementsSchema = {
  params: Joi.object({ id: objectId.required() }),
  query: Joi.object({
    type: movementType,
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(200).default(25),
  }),
};

export const allMovementsSchema = {
  query: Joi.object({
    type: movementType,
    from: Joi.date(),
    to: Joi.date().min(Joi.ref('from')).messages({
      'date.min': 'The end of the range must be after its start',
    }),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(200).default(25),
  }),
};

export const idParamSchema = {
  params: Joi.object({ id: objectId.required() }),
};

export const changeStatusSchema = {
  params: Joi.object({ id: objectId.required() }),
  body: Joi.object({
    status: Joi.string().valid(...Object.values(EMPLOYEE_STATUS)).required(),
    effectiveDate: Joi.date().allow(null, ''),
    lastWorkingDate: Joi.date().allow(null, ''),
    resignationDate: Joi.date().allow(null, ''),
    noticePeriodDays: Joi.number().integer().min(0).max(365).allow(null),
    rehireEligible: Joi.boolean(),
    reason: Joi.string().trim().max(500).allow(null, ''),
  })
    // An exit without a stated reason is the one an auditor always asks about.
    .when(Joi.object({ status: Joi.valid(EMPLOYEE_STATUS.TERMINATED) }).unknown(), {
      then: Joi.object({ reason: Joi.string().trim().min(3).max(500).required() }),
    }),
};

export const deleteEmployeeSchema = {
  params: Joi.object({ id: objectId.required() }),
  body: Joi.object({
    reason: Joi.string().trim().max(500).allow(null, ''),
    /**
     * Also delete the employee's attachment folder.
     *
     * Defaults to false because the delete itself is reversible and this is
     * not: restoring an employee whose documents were destroyed gives back a
     * record with nothing attached to it. The screen asks for this separately.
     */
    purgeAttachments: Joi.boolean().default(false),
  }).default({}),
};

export const listEmployeesSchema = {
  query: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(200).default(25),
    sortBy: Joi.string().valid(...SORTABLE_FIELDS),
    sortOrder: Joi.string().valid('asc', 'desc').default('asc'),
    search: Joi.string().trim().max(100).allow(''),

    // Repeatable query parameters arrive as a single value or an array.
    status: Joi.alternatives().try(
      Joi.string().valid(...Object.values(EMPLOYEE_STATUS)),
      Joi.array().items(Joi.string().valid(...Object.values(EMPLOYEE_STATUS))),
    ),
    employmentType: Joi.alternatives().try(
      Joi.string().valid(...Object.values(EMPLOYMENT_TYPE)),
      Joi.array().items(Joi.string().valid(...Object.values(EMPLOYMENT_TYPE))),
    ),
    departmentId: objectId,
    designationId: objectId,
    shiftId: objectId,
    reportingManagerId: objectId,
    gender: Joi.string().valid(...Object.values(GENDER)),
    bloodGroup: Joi.string().valid(...BLOOD_GROUPS),
    maritalStatus: Joi.string().valid(...Object.values(MARITAL_STATUS)),
    workLocation: Joi.string().trim().max(120),
    joinedFrom: Joi.date(),
    joinedTo: Joi.date().min(Joi.ref('joinedFrom')).messages({
      'date.min': 'The end of the range must be after its start',
    }),
    includeDeleted: Joi.boolean().default(false),
  }),
};

export const exportEmployeesSchema = {
  query: listEmployeesSchema.query.fork(['page', 'limit', 'includeDeleted'], (schema) =>
    schema.forbidden(),
  ),
};

export const importEmployeesSchema = {
  body: Joi.object({ dryRun: Joi.boolean().default(false) }).default({}),
};

export const uploadDocumentsSchema = {
  params: Joi.object({ id: objectId.required() }),
  body: Joi.object({
    type: Joi.string().valid(...Object.values(DOCUMENT_TYPES)),
    types: Joi.array().items(Joi.string().valid(...Object.values(DOCUMENT_TYPES))),
    titles: Joi.array().items(Joi.string().trim().max(150)),
    expiresAt: Joi.array().items(Joi.date().allow(null, '')),
  }).default({}),
};

export const documentParamSchema = {
  params: Joi.object({ id: objectId.required(), documentId: objectId.required() }),
};

/* ------------------------------------------------- employee attachments -- */

/**
 * The document type arrives in the path, so it is validated against the enum
 * before the upload middleware turns it into a folder name. An unchecked value
 * here would be a directory chosen by the caller.
 */
const documentType = Joi.string()
  .valid(...Object.values(DOCUMENT_TYPES))
  .required()
  .messages({ 'any.only': 'That is not a document type this employee can hold' });

export const attachmentParamSchema = {
  params: Joi.object({ id: objectId.required(), documentId: objectId.required() }),
  query: Joi.object({ disposition: Joi.string().valid('inline', 'attachment') }),
};

/**
 * Listing one employee's documents, optionally a page at a time.
 *
 * Neither `page` nor `limit` carries a default, and that is deliberate: a
 * default limit would silently paginate the Documents tab, which asks for the
 * grouped shape and renders every section in full. Pagination is opt-in, so a
 * caller that sends nothing gets what it always got.
 */
export const attachmentListSchema = {
  params: Joi.object({ id: objectId.required() }),
  query: Joi.object({
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
  }),
};

export const attachmentTypeParamSchema = {
  params: Joi.object({ id: objectId.required(), type: documentType }),
};

export const attachmentReplaceParamSchema = {
  params: Joi.object({
    id: objectId.required(),
    documentId: objectId.required(),
    type: documentType,
  }),
};

export const auditTrailSchema = {
  params: Joi.object({ id: objectId.required() }),
  query: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
  }),
};

export default {
  createEmployeeSchema,
  updateEmployeeSchema,
  movementsSchema,
  allMovementsSchema,
  idParamSchema,
  changeStatusSchema,
  deleteEmployeeSchema,
  listEmployeesSchema,
  exportEmployeesSchema,
  importEmployeesSchema,
  uploadDocumentsSchema,
  documentParamSchema,
  attachmentParamSchema,
  attachmentListSchema,
  attachmentTypeParamSchema,
  attachmentReplaceParamSchema,
  auditTrailSchema,
};
