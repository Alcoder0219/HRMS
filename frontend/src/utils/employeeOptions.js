import { humanize } from './format.js';
import { ROLES, ROLE_LABELS } from './roles.js';

/**
 * Option lists for the employee screens, mirroring the backend enums in
 * utils/constants.js. Kept as plain data so both a filter dropdown and a form
 * select can share one definition.
 */

const toOptions = (values) => values.map((value) => ({ value, label: humanize(value) }));

export const EMPLOYEE_STATUSES = [
  'PROBATION',
  'ACTIVE',
  'NOTICE_PERIOD',
  'RESIGNED',
  'TERMINATED',
  'RETIRED',
];

export const EMPLOYEE_STATUS_OPTIONS = toOptions(EMPLOYEE_STATUSES);

/**
 * Mirrors EMPLOYEE_STATUS_TRANSITIONS on the server. Used to offer only the
 * moves that will be accepted -- the server still enforces them, but a dropdown
 * that lists impossible options invites a guaranteed error.
 */
export const STATUS_TRANSITIONS = {
  PROBATION: ['ACTIVE', 'NOTICE_PERIOD', 'TERMINATED', 'RESIGNED'],
  ACTIVE: ['NOTICE_PERIOD', 'TERMINATED', 'RETIRED', 'RESIGNED'],
  NOTICE_PERIOD: ['RESIGNED', 'TERMINATED', 'RETIRED', 'ACTIVE'],
  RESIGNED: [],
  TERMINATED: [],
  RETIRED: [],
};

export const EMPLOYMENT_TYPE_OPTIONS = toOptions([
  'FULL_TIME',
  'PART_TIME',
  'CONTRACT',
  'INTERN',
  'CONSULTANT',
  'TEMPORARY',
]);

/** Workforce class. Distinct from employment type -- see backend constants. */
export const EMPLOYEE_CATEGORY_OPTIONS = toOptions([
  'WORKMAN',
  'STAFF',
  'SUPERVISOR',
  'EXECUTIVE',
  'MANAGEMENT',
  'TRAINEE',
  'APPRENTICE',
]);

export const GENDER_OPTIONS = toOptions(['MALE', 'FEMALE', 'OTHER', 'UNDISCLOSED']);

export const MARITAL_STATUS_OPTIONS = toOptions([
  'SINGLE',
  'MARRIED',
  'DIVORCED',
  'WIDOWED',
  'SEPARATED',
]);

export const BLOOD_GROUP_OPTIONS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map(
  (value) => ({ value, label: value }),
);

export const BANK_ACCOUNT_TYPE_OPTIONS = toOptions(['SAVINGS', 'CURRENT']);

/* -------------------------------------------------------- portal access -- */

/**
 * Roles that can be granted from the Employee form.
 *
 * SUPER_ADMIN is absent deliberately, and its absence is enforced on the server
 * as well -- it is a platform account that may have no employee record at all,
 * and granting it from an HR screen would hand over the whole system. The one
 * Super Admin is managed from the Users page.
 *
 * Derived from ROLE_LABELS rather than re-listed, so a role added to the
 * product appears here without a second edit.
 */
export const PORTAL_ROLE_OPTIONS = Object.entries(ROLE_LABELS)
  .filter(([value]) => value !== ROLES.SUPER_ADMIN)
  .map(([value, label]) => ({ value, label }));

/**
 * The account states an administrator may set here.
 *
 * PENDING and LOCKED are omitted: neither is a choice. PENDING is what an
 * unverified account starts as, and LOCKED is set by the failed-login counter
 * and cleared by unlocking -- offering either as a dropdown option would invite
 * somebody to "set" a state the system owns.
 */
export const PORTAL_STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'SUSPENDED', label: 'Suspended' },
  { value: 'DEACTIVATED', label: 'Deactivated' },
];

export const DOCUMENT_TYPE_OPTIONS = toOptions([
  'PHOTO',
  'RESUME',
  'OFFER_LETTER',
  'APPOINTMENT_LETTER',
  'JOINING_LETTER',
  'ID_PROOF',
  'ADDRESS_PROOF',
  'NATIONAL_ID_COPY',
  'TIN_COPY',
  'NSSF_CARD_COPY',
  'NHIF_CARD_COPY',
  'BIRTH_CERTIFICATE',
  'WORK_PERMIT',
  'PASSPORT_COPY',
  'DRIVING_LICENSE_COPY',
  'BANK_PASSBOOK',
  'EDUCATION',
  'EXPERIENCE',
  'RELIEVING_LETTER',
  'BANK_PROOF',
  'MEDICAL',
  'CONTRACT',
  'OTHER',
]);

/**
 * Salary component fields, in the order they appear on the payslip.
 *
 * Drives the Salary tab so the inputs, the totals and any future column list
 * are generated from one definition instead of being repeated.
 */
export const SALARY_EARNING_FIELDS = [
  { key: 'basic', label: 'Basic Salary' },
  { key: 'hraAllowance', label: 'HRA' },
  { key: 'foodAllowance', label: 'Food Allowance' },
  { key: 'transportationAllowance', label: 'Transportation Allowance' },
  { key: 'communicationAllowance', label: 'Communication Allowance' },
  { key: 'mediclaim', label: 'Mediclaim' },
  { key: 'schoolFeesAllowance', label: 'School Fees Allowance' },
  {
    key: 'annualLeaveAllowance',
    label: 'Annual Leave Allowance',
    help: 'Monthly equivalent — a per-annum entitlement divided by twelve',
  },
  { key: 'performanceIncentive', label: 'Performance Incentive' },
];

/** Employee-side deductions. These reduce take-home pay. */
export const SALARY_DEDUCTION_FIELDS = [
  { key: 'nssfEmployee', label: 'NSSF - Employee' },
  { key: 'nhif', label: 'NHIF' },
  { key: 'paye', label: 'PAYE' },
];

/* -------------------------------------------------------------- overtime -- */

export const OVERTIME_METHOD_OPTIONS = [
  {
    value: 'FIXED_HOURLY_RATE',
    label: 'Fixed Hourly Rate',
    help: 'Pay a flat hourly amount you enter, regardless of salary',
  },
  {
    value: 'SALARY_BASED',
    label: 'Salary Based',
    help: 'Derive the hourly rate from monthly gross ÷ working hours',
  },
  {
    value: 'COMPANY_POLICY',
    label: 'Company Policy',
    help: 'Use the organisation-wide multiplier from payroll settings',
  },
];

/** `CUSTOM` is last so the fixed choices read as a scale. */
export const OVERTIME_MULTIPLIER_OPTIONS = [
  { value: '1', label: '1x' },
  { value: '1.25', label: '1.25x' },
  { value: '1.5', label: '1.5x' },
  { value: '1.75', label: '1.75x' },
  { value: '2', label: '2x' },
  { value: '2.5', label: '2.5x' },
  { value: '3', label: '3x' },
  { value: 'CUSTOM', label: 'Custom' },
];

/** Holiday and night premiums use a shorter list. */
export const PREMIUM_MULTIPLIER_OPTIONS = [
  { value: '1', label: '1x' },
  { value: '1.5', label: '1.5x' },
  { value: '2', label: '2x' },
  { value: 'CUSTOM', label: 'Custom' },
];

/**
 * The three premium rates, so the inputs and their custom companions are
 * generated from one definition instead of three near-identical blocks.
 */
export const OVERTIME_PREMIUM_FIELDS = [
  {
    key: 'weeklyHolidayMultiplier',
    customKey: 'weeklyHolidayCustomMultiplier',
    label: 'Weekly holiday OT',
    help: 'Applied when overtime falls on a weekly off',
  },
  {
    key: 'publicHolidayMultiplier',
    customKey: 'publicHolidayCustomMultiplier',
    label: 'Public holiday OT',
    help: 'Applied when overtime falls on a declared holiday',
  },
  {
    key: 'nightShiftMultiplier',
    customKey: 'nightShiftCustomMultiplier',
    label: 'Night shift OT',
    help: 'Applied to overtime worked on a night shift',
  },
];

/**
 * Employer-side contributions. Cost to company, never deducted from salary.
 *
 * SDL and WCF have no employee half at all -- they are levies on the employer's
 * payroll rather than shares of a joint contribution, which is why neither
 * appears in the deduction list above.
 */
export const SALARY_EMPLOYER_FIELDS = [
  { key: 'nssfEmployer', label: 'NSSF - Employer' },
  { key: 'sdl', label: 'SDL' },
  { key: 'wcf', label: 'WCF' },
];
