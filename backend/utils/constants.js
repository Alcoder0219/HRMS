/**
 * Cross-cutting enums. Every value that is persisted or compared lives here so
 * a typo becomes an import error instead of a silent behavioural bug.
 */

export const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN', // Platform operator, above all tenants
  COMPANY_ADMIN: 'COMPANY_ADMIN', // Owns one customer organisation
  HR: 'HR', // People operations
  PAYROLL: 'PAYROLL', // Runs and approves payroll
  ACCOUNTS: 'ACCOUNTS', // Finance; consumes payroll output
  HOD: 'HOD', // Head of department
  MANAGER: 'MANAGER', // Line manager of a direct team
  SECURITY: 'SECURITY', // Gate / physical attendance desk
  AUDITOR: 'AUDITOR', // Read-only compliance access
  EMPLOYEE: 'EMPLOYEE', // Self-service only
};

export const ROLE_VALUES = Object.values(ROLES);

/**
 * Seniority rank for "this role or above" checks. Higher wins. Spaced by 10 so
 * a new tier can be inserted without renumbering.
 *
 * Rank is NOT the permission model -- AUDITOR outranks EMPLOYEE yet cannot
 * write anything. Use it only for genuinely hierarchical checks; use the
 * permission matrix for everything else.
 */
export const ROLE_RANK = {
  [ROLES.SUPER_ADMIN]: 100,
  [ROLES.COMPANY_ADMIN]: 90,
  [ROLES.HR]: 70,
  [ROLES.PAYROLL]: 65,
  [ROLES.ACCOUNTS]: 60,
  [ROLES.HOD]: 50,
  [ROLES.MANAGER]: 40,
  [ROLES.AUDITOR]: 30,
  [ROLES.SECURITY]: 20,
  [ROLES.EMPLOYEE]: 10,
};

export const ROLE_LABELS = {
  [ROLES.SUPER_ADMIN]: 'Super Admin',
  [ROLES.COMPANY_ADMIN]: 'Company Admin',
  [ROLES.HR]: 'HR',
  [ROLES.PAYROLL]: 'Payroll',
  [ROLES.ACCOUNTS]: 'Accounts',
  [ROLES.HOD]: 'Head of Department',
  [ROLES.MANAGER]: 'Manager',
  [ROLES.SECURITY]: 'Security',
  [ROLES.AUDITOR]: 'Auditor',
  [ROLES.EMPLOYEE]: 'Employee',
};

/** SUPER_ADMIN operates across tenants; every other role is tenant-scoped. */
export const CROSS_TENANT_ROLES = [ROLES.SUPER_ADMIN];

/* -------------------------------------------------------------------------- */
/*                                Permissions                                 */
/* -------------------------------------------------------------------------- */

/**
 * What a role may DO. Combined with a RESOURCE to form a permission string
 * (`payroll:approve`), which is the unit the middleware checks.
 */
export const ACTIONS = {
  READ: 'read',
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  APPROVE: 'approve',
  REJECT: 'reject',
  EXPORT: 'export',
  PRINT: 'print',
  // "Dashboard access" as a per-resource privilege: aggregate figures for a
  // module are a separate disclosure from its records. A line manager may read
  // individual payslips of nobody, yet still need headcount analytics.
  DASHBOARD: 'dashboard',
};

export const ACTION_VALUES = Object.values(ACTIONS);

export const ACTION_LABELS = {
  [ACTIONS.READ]: 'Read',
  [ACTIONS.CREATE]: 'Create',
  [ACTIONS.UPDATE]: 'Update',
  [ACTIONS.DELETE]: 'Delete',
  [ACTIONS.APPROVE]: 'Approve',
  [ACTIONS.REJECT]: 'Reject',
  [ACTIONS.EXPORT]: 'Export',
  [ACTIONS.PRINT]: 'Print',
  [ACTIONS.DASHBOARD]: 'Dashboard Access',
};

/** What a role may act ON. One entry per protected area of the product. */
export const RESOURCES = {
  DASHBOARD: 'dashboard',
  TENANT: 'tenant',
  USER: 'user', // Login accounts
  ROLE: 'role', // RBAC configuration itself
  EMPLOYEE: 'employee',
  ORGANIZATION: 'organization', // Departments, designations, branches
  ATTENDANCE: 'attendance',
  LEAVE: 'leave',
  PAYROLL: 'payroll',
  RECRUITMENT: 'recruitment',
  PERFORMANCE: 'performance',
  DOCUMENT: 'document',
  NOTIFICATION: 'notification',
  REPORT: 'report',
  AUDIT: 'audit', // Login history, activity trail
};

export const RESOURCE_VALUES = Object.values(RESOURCES);

/** Matches any resource or any action in the permission matrix. */
export const WILDCARD = '*';

/**
 * How wide a role's reach is over a resource. Ordered: a higher scope contains
 * every lower one.
 *
 * This is the half of RBAC that role checks alone cannot express -- MANAGER and
 * HR both hold `leave:approve`, but a manager may only approve their own team's.
 */
export const SCOPES = {
  SELF: 'SELF',
  TEAM: 'TEAM',
  DEPARTMENT: 'DEPARTMENT',
  TENANT: 'TENANT',
  GLOBAL: 'GLOBAL',
};

export const SCOPE_RANK = {
  [SCOPES.SELF]: 10,
  [SCOPES.TEAM]: 20,
  [SCOPES.DEPARTMENT]: 30,
  [SCOPES.TENANT]: 40,
  [SCOPES.GLOBAL]: 50,
};

/* -------------------------------------------------------------------------- */
/*                              Employee master                               */
/* -------------------------------------------------------------------------- */

export const GENDER = {
  MALE: 'MALE',
  FEMALE: 'FEMALE',
  OTHER: 'OTHER',
  UNDISCLOSED: 'UNDISCLOSED',
};

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

export const MARITAL_STATUS = {
  SINGLE: 'SINGLE',
  MARRIED: 'MARRIED',
  DIVORCED: 'DIVORCED',
  WIDOWED: 'WIDOWED',
  SEPARATED: 'SEPARATED',
};

export const EMPLOYMENT_TYPE = {
  FULL_TIME: 'FULL_TIME',
  PART_TIME: 'PART_TIME',
  CONTRACT: 'CONTRACT',
  INTERN: 'INTERN',
  CONSULTANT: 'CONSULTANT',
  TEMPORARY: 'TEMPORARY',
};

/**
 * Workforce classification, distinct from employment type.
 *
 * Employment type is the contract (full time, contract); category is the class
 * of work. Statutory obligations key off the category -- overtime entitlement
 * treats a workman differently from an executive -- which is why it is not
 * folded into employment type.
 */
export const EMPLOYEE_CATEGORY = {
  WORKMAN: 'WORKMAN',
  STAFF: 'STAFF',
  SUPERVISOR: 'SUPERVISOR',
  EXECUTIVE: 'EXECUTIVE',
  MANAGEMENT: 'MANAGEMENT',
  TRAINEE: 'TRAINEE',
  APPRENTICE: 'APPRENTICE',
};

/* -------------------------------------------------------------------------- */
/*                           Overtime configuration                           */
/* -------------------------------------------------------------------------- */

/**
 * How an employee's overtime hourly rate is arrived at.
 *
 * The method decides which inputs matter: a fixed rate ignores salary entirely,
 * a salary-based rate divides gross by working hours, and company policy defers
 * to the tenant default so a rate change does not require editing every record.
 */
export const OVERTIME_CALCULATION_METHOD = {
  FIXED_HOURLY_RATE: 'FIXED_HOURLY_RATE',
  SALARY_BASED: 'SALARY_BASED',
  COMPANY_POLICY: 'COMPANY_POLICY',
};

/**
 * Multipliers offered as fixed choices, plus CUSTOM.
 *
 * Stored as strings so the selected option round-trips exactly -- a numeric
 * enum could not distinguish "2x chosen from the list" from "2 typed as a
 * custom value", and the two mean different things when a policy changes.
 */
export const OVERTIME_MULTIPLIERS = ['1', '1.25', '1.5', '1.75', '2', '2.5', '3', 'CUSTOM'];

/** Holiday and night-shift premiums use a shorter list. */
export const PREMIUM_MULTIPLIERS = ['1', '1.5', '2', 'CUSTOM'];

/**
 * Legacy default for the `monthlyWorkingHours` payroll setting only.
 *
 * NOT the overtime divisor. Overtime prices an hour at gross divided by the
 * payroll month's own length times eight hours -- 248 in August, 224 in
 * February -- which no single constant can express. See
 * helpers/overtimeRate.helper.js; nothing in the rate calculation reads this.
 */
export const DEFAULT_MONTHLY_WORKING_HOURS = 240;

/**
 * Employee lifecycle. PROBATION precedes ACTIVE because a confirmation date is
 * meaningless without a state to be confirmed out of.
 */
export const EMPLOYEE_STATUS = {
  PROBATION: 'PROBATION',
  ACTIVE: 'ACTIVE',
  NOTICE_PERIOD: 'NOTICE_PERIOD',
  RESIGNED: 'RESIGNED',
  TERMINATED: 'TERMINATED',
  RETIRED: 'RETIRED',
};

/**
 * Legal state transitions. Enforced in the service so an employee cannot go
 * from RESIGNED back to ACTIVE without an explicit rehire, and so exit dates
 * are never recorded against someone who is still employed.
 *
 * The exit states are terminal: correcting a mistaken exit is a deliberate
 * administrative act, not an ordinary edit.
 */
export const EMPLOYEE_STATUS_TRANSITIONS = {
  [EMPLOYEE_STATUS.PROBATION]: [
    EMPLOYEE_STATUS.ACTIVE,
    EMPLOYEE_STATUS.NOTICE_PERIOD,
    EMPLOYEE_STATUS.TERMINATED,
    EMPLOYEE_STATUS.RESIGNED,
  ],
  [EMPLOYEE_STATUS.ACTIVE]: [
    EMPLOYEE_STATUS.NOTICE_PERIOD,
    EMPLOYEE_STATUS.TERMINATED,
    EMPLOYEE_STATUS.RETIRED,
    EMPLOYEE_STATUS.RESIGNED,
  ],
  [EMPLOYEE_STATUS.NOTICE_PERIOD]: [
    EMPLOYEE_STATUS.RESIGNED,
    EMPLOYEE_STATUS.TERMINATED,
    EMPLOYEE_STATUS.RETIRED,
    // Withdrawn resignation.
    EMPLOYEE_STATUS.ACTIVE,
  ],
  [EMPLOYEE_STATUS.RESIGNED]: [],
  [EMPLOYEE_STATUS.TERMINATED]: [],
  [EMPLOYEE_STATUS.RETIRED]: [],
};

/** Statuses that count as currently employed, for headcount and payroll. */
export const ACTIVE_EMPLOYEE_STATUSES = [
  EMPLOYEE_STATUS.PROBATION,
  EMPLOYEE_STATUS.ACTIVE,
  EMPLOYEE_STATUS.NOTICE_PERIOD,
];

/**
 * Employee document classes.
 *
 * The identity-proof types are the Tanzanian ones: NIDA national id, TIN for
 * PAYE, and the two social-fund cards. `ID_PROOF` and `ADDRESS_PROOF` remain
 * the generic fallbacks they always were, and `WORK_PERMIT` exists because an
 * expatriate's right to work is a document with an expiry date -- exactly what
 * the expiring-documents report is for.
 */
export const DOCUMENT_TYPES = {
  PHOTO: 'PHOTO',
  RESUME: 'RESUME',
  OFFER_LETTER: 'OFFER_LETTER',
  APPOINTMENT_LETTER: 'APPOINTMENT_LETTER',
  JOINING_LETTER: 'JOINING_LETTER',
  ID_PROOF: 'ID_PROOF',
  ADDRESS_PROOF: 'ADDRESS_PROOF',
  NATIONAL_ID_COPY: 'NATIONAL_ID_COPY',
  TIN_COPY: 'TIN_COPY',
  NSSF_CARD_COPY: 'NSSF_CARD_COPY',
  NHIF_CARD_COPY: 'NHIF_CARD_COPY',
  BIRTH_CERTIFICATE: 'BIRTH_CERTIFICATE',
  WORK_PERMIT: 'WORK_PERMIT',
  PASSPORT_COPY: 'PASSPORT_COPY',
  DRIVING_LICENSE_COPY: 'DRIVING_LICENSE_COPY',
  BANK_PASSBOOK: 'BANK_PASSBOOK',
  EDUCATION: 'EDUCATION',
  EXPERIENCE: 'EXPERIENCE',
  RELIEVING_LETTER: 'RELIEVING_LETTER',
  BANK_PROOF: 'BANK_PROOF',
  MEDICAL: 'MEDICAL',
  CONTRACT: 'CONTRACT',
  OTHER: 'OTHER',
};

/** Tanzanian banks offer savings and current accounts; there is no salary type. */
export const BANK_ACCOUNT_TYPES = {
  SAVINGS: 'SAVINGS',
  CURRENT: 'CURRENT',
};

/**
 * The currency every amount in this system is denominated in.
 *
 * `CODE` is ISO 4217 and is what gets stored; `SYMBOL` is what a Tanzanian
 * reader expects to see written. The two differ deliberately -- ISO says TZS,
 * the shilling is written TSH -- and a screen should read the way the user
 * writes rather than the way a standards body does.
 */
export const CURRENCY = {
  CODE: 'TZS',
  SYMBOL: 'TSH',
  LOCALE: 'en-TZ',
  LABEL: 'Tanzanian Shilling',
};

export const DEFAULT_CURRENCY = CURRENCY.CODE;

export const PAY_FREQUENCY = {
  MONTHLY: 'MONTHLY',
  BIWEEKLY: 'BIWEEKLY',
  WEEKLY: 'WEEKLY',
};

/* -------------------------------------------------------------------------- */
/*                                 Attendance                                 */
/* -------------------------------------------------------------------------- */

/**
 * Where a punch came from. Recorded per punch, not per day: a single day may
 * legitimately mix a biometric entry with a manually corrected exit, and an
 * auditor needs to see which was which.
 */
export const ATTENDANCE_SOURCE = {
  MANUAL: 'MANUAL', // Entered by HR or a manager
  BIOMETRIC: 'BIOMETRIC', // Device push / pull API
  CSV: 'CSV', // Bulk file upload
  GEO: 'GEO', // Mobile punch with coordinates
  WEB: 'WEB', // Self-service from the browser
  SYSTEM: 'SYSTEM', // Generated by the day-close job
};

/**
 * The computed state of one employee-day.
 *
 * ABSENT is a computed outcome, not an input -- nobody marks it, the rules
 * engine concludes it. MISSING_PUNCH is deliberately distinct from ABSENT: the
 * person was here, the data is incomplete, and treating that as absence is how
 * payroll ends up docking someone who worked.
 */
export const ATTENDANCE_STATUS = {
  PRESENT: 'PRESENT',
  HALF_DAY: 'HALF_DAY',
  ABSENT: 'ABSENT',
  MISSING_PUNCH: 'MISSING_PUNCH',
  ON_LEAVE: 'ON_LEAVE',
  HOLIDAY: 'HOLIDAY',
  WEEKLY_OFF: 'WEEKLY_OFF',
  ON_DUTY: 'ON_DUTY', // Client visit, off-site work
  WORK_FROM_HOME: 'WORK_FROM_HOME',
};

/** Statuses that count as a working day for payroll. */
export const PAYABLE_ATTENDANCE_STATUSES = [
  ATTENDANCE_STATUS.PRESENT,
  ATTENDANCE_STATUS.ON_DUTY,
  ATTENDANCE_STATUS.WORK_FROM_HOME,
  ATTENDANCE_STATUS.HOLIDAY,
  ATTENDANCE_STATUS.WEEKLY_OFF,
];

/** Statuses an employee can be marked into without a punch pair. */
export const NON_WORKING_STATUSES = [
  ATTENDANCE_STATUS.ABSENT,
  ATTENDANCE_STATUS.ON_LEAVE,
  ATTENDANCE_STATUS.HOLIDAY,
  ATTENDANCE_STATUS.WEEKLY_OFF,
];

export const HOLIDAY_TYPES = {
  PUBLIC: 'PUBLIC', // Gazetted, applies to everyone
  RESTRICTED: 'RESTRICTED', // Optional, employee elects to take it
  COMPANY: 'COMPANY', // Company-declared
};

export const REGULARIZATION_TYPES = {
  MISSED_PUNCH: 'MISSED_PUNCH',
  WRONG_TIME: 'WRONG_TIME',
  FORGOT_TO_PUNCH: 'FORGOT_TO_PUNCH',
  ON_DUTY: 'ON_DUTY',
  WORK_FROM_HOME: 'WORK_FROM_HOME',
  TECHNICAL_ISSUE: 'TECHNICAL_ISSUE',
};

export const REGULARIZATION_STATUS = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED', // Withdrawn by the requester
};

export const COMP_OFF_STATUS = {
  EARNED: 'EARNED',
  CONSUMED: 'CONSUMED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
};

/* -------------------------------------------------------------------------- */
/*                                  Payroll                                   */
/* -------------------------------------------------------------------------- */

export const COMPONENT_TYPE = {
  EARNING: 'EARNING',
  DEDUCTION: 'DEDUCTION',
  EMPLOYER_CONTRIBUTION: 'EMPLOYER_CONTRIBUTION',
};

/**
 * Canonical component codes.
 *
 * Fixed identifiers rather than free text: payslips, bank files and statutory
 * returns all key off these, and a renamed label must never change what a
 * component means.
 */
export const COMPONENT_CODE = {
  // Earnings
  BASIC: 'BASIC',
  HRA: 'HRA',
  FOOD_ALLOWANCE: 'FOOD_ALLOWANCE',
  TRANSPORTATION_ALLOWANCE: 'TRANSPORTATION_ALLOWANCE',
  COMMUNICATION_ALLOWANCE: 'COMMUNICATION_ALLOWANCE',
  MEDICLAIM: 'MEDICLAIM',
  SCHOOL_FEES_ALLOWANCE: 'SCHOOL_FEES_ALLOWANCE',
  ANNUAL_LEAVE_ALLOWANCE: 'ANNUAL_LEAVE_ALLOWANCE',
  PERFORMANCE_INCENTIVE: 'PERFORMANCE_INCENTIVE',
  OTHER_ALLOWANCE: 'OTHER_ALLOWANCE',
  OVERTIME: 'OVERTIME',
  BONUS: 'BONUS',
  INCENTIVE: 'INCENTIVE',
  ARREARS: 'ARREARS',

  // Deductions
  NSSF_EMPLOYEE: 'NSSF_EMPLOYEE',
  NHIF: 'NHIF',
  PAYE: 'PAYE',
  LOAN_EMI: 'LOAN_EMI',
  ADVANCE_RECOVERY: 'ADVANCE_RECOVERY',
  LOP: 'LOP',
  OTHER_DEDUCTION: 'OTHER_DEDUCTION',

  /**
   * Employer side -- reported for cost to company and for the monthly returns,
   * never deducted from the employee.
   *
   * SDL and WCF have no employee half at all: they are levies on the employer's
   * payroll, so naming them here is what lets them appear on a payslip as
   * themselves rather than hiding inside a generic contribution total.
   */
  NSSF_EMPLOYER: 'NSSF_EMPLOYER',
  SDL: 'SDL',
  WCF: 'WCF',
};

/**
 * Payroll run lifecycle.
 *
 * APPROVED is separate from PAID because approving a register and actually
 * disbursing it are different acts, often days apart and by different people.
 * The bank file is generated from an APPROVED run; PAID records that the money
 * left.
 */
export const PAYROLL_STATUS = {
  DRAFT: 'DRAFT',
  PROCESSING: 'PROCESSING',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  PAID: 'PAID',
  CANCELLED: 'CANCELLED',
};

/** Only a run in one of these states may still be recalculated. */
export const EDITABLE_PAYROLL_STATUSES = [
  PAYROLL_STATUS.DRAFT,
  PAYROLL_STATUS.PROCESSING,
  PAYROLL_STATUS.PENDING_APPROVAL,
];

export const PAYROLL_STATUS_TRANSITIONS = {
  [PAYROLL_STATUS.DRAFT]: [PAYROLL_STATUS.PROCESSING, PAYROLL_STATUS.CANCELLED],
  [PAYROLL_STATUS.PROCESSING]: [PAYROLL_STATUS.PENDING_APPROVAL, PAYROLL_STATUS.CANCELLED],
  [PAYROLL_STATUS.PENDING_APPROVAL]: [
    PAYROLL_STATUS.APPROVED,
    // Sent back for correction.
    PAYROLL_STATUS.PROCESSING,
    PAYROLL_STATUS.CANCELLED,
  ],
  [PAYROLL_STATUS.APPROVED]: [PAYROLL_STATUS.PAID],
  // Terminal: money has moved, or the run was abandoned.
  [PAYROLL_STATUS.PAID]: [],
  [PAYROLL_STATUS.CANCELLED]: [],
};

export const PAYSLIP_STATUS = {
  DRAFT: 'DRAFT',
  FINALISED: 'FINALISED',
  PUBLISHED: 'PUBLISHED', // Visible to the employee
  ON_HOLD: 'ON_HOLD', // Excluded from this run's disbursement
};

export const LOAN_STATUS = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  DISBURSED: 'DISBURSED',
  ACTIVE: 'ACTIVE',
  CLOSED: 'CLOSED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
};

export const LOAN_TYPES = {
  PERSONAL: 'PERSONAL',
  SALARY_ADVANCE: 'SALARY_ADVANCE',
  EMERGENCY: 'EMERGENCY',
  VEHICLE: 'VEHICLE',
  HOUSING: 'HOUSING',
  OTHER: 'OTHER',
};

/**
 * Salary disbursement file layouts.
 *
 * The three named banks are the ones that clear most Tanzanian payrolls. Each
 * publishes its own bulk-transfer template, so the format is a per-tenant
 * setting rather than a constant.
 */
export const BANK_FILE_FORMATS = {
  GENERIC_CSV: 'GENERIC_CSV',
  CRDB: 'CRDB',
  NMB: 'NMB',
  NBC: 'NBC',
};

/* -------------------------------------------------------------------------- */
/*                        Full & final settlement                             */
/* -------------------------------------------------------------------------- */

/** What ended the employment. Drives eligibility, notice and severance rules. */
export const SETTLEMENT_TRIGGER = {
  RESIGNATION: 'RESIGNATION',
  TERMINATION: 'TERMINATION',
  RETIREMENT: 'RETIREMENT',
  ABSCONDING: 'ABSCONDING',
  DEATH: 'DEATH',
  END_OF_CONTRACT: 'END_OF_CONTRACT',
};

/**
 * Settlement lifecycle.
 *
 * Two approvals rather than one: HR confirms the exit facts (dates, notice,
 * assets), finance confirms the money. They are different judgements made by
 * different people, and collapsing them hides which one actually happened.
 */
export const SETTLEMENT_STATUS = {
  DRAFT: 'DRAFT',
  PENDING_HR: 'PENDING_HR',
  PENDING_FINANCE: 'PENDING_FINANCE',
  APPROVED: 'APPROVED',
  PAID: 'PAID',
  ON_HOLD: 'ON_HOLD',
  CANCELLED: 'CANCELLED',
};

export const SETTLEMENT_STATUS_TRANSITIONS = {
  [SETTLEMENT_STATUS.DRAFT]: [SETTLEMENT_STATUS.PENDING_HR, SETTLEMENT_STATUS.CANCELLED],
  [SETTLEMENT_STATUS.PENDING_HR]: [
    SETTLEMENT_STATUS.PENDING_FINANCE,
    // Sent back for correction.
    SETTLEMENT_STATUS.DRAFT,
    SETTLEMENT_STATUS.ON_HOLD,
    SETTLEMENT_STATUS.CANCELLED,
  ],
  [SETTLEMENT_STATUS.PENDING_FINANCE]: [
    SETTLEMENT_STATUS.APPROVED,
    SETTLEMENT_STATUS.PENDING_HR,
    SETTLEMENT_STATUS.ON_HOLD,
    SETTLEMENT_STATUS.CANCELLED,
  ],
  [SETTLEMENT_STATUS.APPROVED]: [SETTLEMENT_STATUS.PAID, SETTLEMENT_STATUS.ON_HOLD],
  // A hold can be released back to whichever queue it came from.
  [SETTLEMENT_STATUS.ON_HOLD]: [
    SETTLEMENT_STATUS.PENDING_HR,
    SETTLEMENT_STATUS.PENDING_FINANCE,
    SETTLEMENT_STATUS.APPROVED,
    SETTLEMENT_STATUS.CANCELLED,
  ],
  [SETTLEMENT_STATUS.PAID]: [],
  [SETTLEMENT_STATUS.CANCELLED]: [],
};

export const EDITABLE_SETTLEMENT_STATUSES = [
  SETTLEMENT_STATUS.DRAFT,
  SETTLEMENT_STATUS.PENDING_HR,
  SETTLEMENT_STATUS.ON_HOLD,
];

/** Line items on a settlement sheet. */
export const SETTLEMENT_COMPONENT = {
  // Payable to the employee
  PENDING_SALARY: 'PENDING_SALARY',
  LEAVE_ENCASHMENT: 'LEAVE_ENCASHMENT',
  /**
   * Severance, under the Employment and Labour Relations Act.
   *
   * Not gratuity: Tanzania has no equivalent of the Indian Payment of Gratuity
   * Act, and severance is a different entitlement with a different trigger --
   * it is owed on termination by the employer after a qualifying period, not on
   * any exit after five years.
   */
  SEVERANCE_PAY: 'SEVERANCE_PAY',
  BONUS: 'BONUS',
  INCENTIVE: 'INCENTIVE',
  NOTICE_PAY: 'NOTICE_PAY', // Pay in lieu, when the employer waives service
  ARREARS: 'ARREARS',
  REIMBURSEMENT: 'REIMBURSEMENT',
  OTHER_EARNING: 'OTHER_EARNING',

  // Recoverable from the employee
  NOTICE_RECOVERY: 'NOTICE_RECOVERY', // Shortfall in notice served
  LOAN_RECOVERY: 'LOAN_RECOVERY',
  ADVANCE_RECOVERY: 'ADVANCE_RECOVERY',
  ASSET_RECOVERY: 'ASSET_RECOVERY',
  EXCESS_LEAVE: 'EXCESS_LEAVE',
  PAYE: 'PAYE',
  OTHER_DEDUCTION: 'OTHER_DEDUCTION',
};

/* ----------------------------------------------------------------- assets -- */

export const ASSET_CATEGORY = {
  LAPTOP: 'LAPTOP',
  DESKTOP: 'DESKTOP',
  MOBILE: 'MOBILE',
  SIM: 'SIM',
  ACCESS_CARD: 'ACCESS_CARD',
  VEHICLE: 'VEHICLE',
  FURNITURE: 'FURNITURE',
  TOOL: 'TOOL',
  OTHER: 'OTHER',
};

export const ASSET_STATUS = {
  AVAILABLE: 'AVAILABLE',
  ASSIGNED: 'ASSIGNED',
  RETURNED: 'RETURNED',
  LOST: 'LOST',
  DAMAGED: 'DAMAGED',
  RETIRED: 'RETIRED',
};

export const ASSET_CONDITION = {
  NEW: 'NEW',
  GOOD: 'GOOD',
  FAIR: 'FAIR',
  DAMAGED: 'DAMAGED',
  UNUSABLE: 'UNUSABLE',
};

/* -------------------------------------------------------------------------- */
/*                                    Leave                                   */
/* -------------------------------------------------------------------------- */

/**
 * Leave lifecycle.
 *
 * Balance is committed on APPROVED, not on application -- otherwise a stack of
 * speculative requests would exhaust an entitlement nobody has actually taken.
 * PENDING days are tracked separately so a second request cannot quietly
 * over-commit the same balance.
 */
export const LEAVE_STATUS = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
};

export const LEAVE_STATUS_TRANSITIONS = {
  [LEAVE_STATUS.PENDING]: [LEAVE_STATUS.APPROVED, LEAVE_STATUS.REJECTED, LEAVE_STATUS.CANCELLED],
  // An approved future leave can still be withdrawn; the balance is returned.
  [LEAVE_STATUS.APPROVED]: [LEAVE_STATUS.CANCELLED],
  [LEAVE_STATUS.REJECTED]: [],
  [LEAVE_STATUS.CANCELLED]: [],
};

/** Which half a half-day request covers. Drives the attendance mark. */
export const LEAVE_SESSION = {
  FIRST_HALF: 'FIRST_HALF',
  SECOND_HALF: 'SECOND_HALF',
};

/**
 * How an entitlement is granted.
 *
 * ANNUAL credits the whole allowance at the start of the year; MONTHLY accrues
 * it in twelfths as the year runs. The difference matters on exit: a leaver in
 * March has earned a quarter of a monthly-accrued entitlement but all of an
 * annual one.
 */
export const LEAVE_ACCRUAL = {
  ANNUAL: 'ANNUAL',
  MONTHLY: 'MONTHLY',
  NONE: 'NONE',
};

/** Ledger movements against a balance, recorded for explainability. */
export const LEAVE_LEDGER_ACTIONS = {
  OPENING: 'OPENING',
  ACCRUAL: 'ACCRUAL',
  CARRY_FORWARD: 'CARRY_FORWARD',
  TAKEN: 'TAKEN',
  RETURNED: 'RETURNED',
  ENCASHED: 'ENCASHED',
  ADJUSTMENT: 'ADJUSTMENT',
  LAPSED: 'LAPSED',
};

/* -------------------------------------------------------------------------- */
/*                                 Recruitment                                */
/* -------------------------------------------------------------------------- */

/** A requisition's life. Only OPEN roles accept applications. */
export const JOB_STATUS = {
  DRAFT: 'DRAFT',
  OPEN: 'OPEN',
  ON_HOLD: 'ON_HOLD',
  CLOSED: 'CLOSED', // Abandoned without hiring
  FILLED: 'FILLED', // Every vacancy taken
};

/**
 * The hiring funnel, in order.
 *
 * Ordered deliberately: the reports measure drop-off between adjacent stages,
 * which is only meaningful if the sequence is the real one.
 */
export const CANDIDATE_STAGE = {
  APPLIED: 'APPLIED',
  SCREENING: 'SCREENING',
  INTERVIEW: 'INTERVIEW',
  OFFER: 'OFFER',
  HIRED: 'HIRED',
  REJECTED: 'REJECTED',
  WITHDRAWN: 'WITHDRAWN', // The candidate pulled out
};

/** Stages a candidate can still move forward from. */
export const ACTIVE_CANDIDATE_STAGES = [
  CANDIDATE_STAGE.APPLIED,
  CANDIDATE_STAGE.SCREENING,
  CANDIDATE_STAGE.INTERVIEW,
  CANDIDATE_STAGE.OFFER,
];

export const CANDIDATE_STAGE_ORDER = [
  CANDIDATE_STAGE.APPLIED,
  CANDIDATE_STAGE.SCREENING,
  CANDIDATE_STAGE.INTERVIEW,
  CANDIDATE_STAGE.OFFER,
  CANDIDATE_STAGE.HIRED,
];

export const CANDIDATE_SOURCE = {
  DIRECT: 'DIRECT',
  REFERRAL: 'REFERRAL',
  JOB_PORTAL: 'JOB_PORTAL',
  CONSULTANT: 'CONSULTANT',
  CAMPUS: 'CAMPUS',
  SOCIAL: 'SOCIAL',
  OTHER: 'OTHER',
};

export const INTERVIEW_MODE = {
  IN_PERSON: 'IN_PERSON',
  VIDEO: 'VIDEO',
  PHONE: 'PHONE',
};

export const INTERVIEW_STATUS = {
  SCHEDULED: 'SCHEDULED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  NO_SHOW: 'NO_SHOW',
};

export const INTERVIEW_RECOMMENDATION = {
  STRONG_YES: 'STRONG_YES',
  YES: 'YES',
  NO: 'NO',
  STRONG_NO: 'STRONG_NO',
};

/**
 * An offer's life.
 *
 * ACCEPTED is not the end: the candidate still has to turn up, which is what
 * JOINED records. The gap between the two is the drop-off every recruiter
 * wants measured.
 */
export const OFFER_STATUS = {
  DRAFT: 'DRAFT',
  SENT: 'SENT',
  ACCEPTED: 'ACCEPTED',
  DECLINED: 'DECLINED',
  WITHDRAWN: 'WITHDRAWN',
  JOINED: 'JOINED', // Converted into an employee
};

export const OFFER_STATUS_TRANSITIONS = {
  [OFFER_STATUS.DRAFT]: [OFFER_STATUS.SENT, OFFER_STATUS.WITHDRAWN],
  [OFFER_STATUS.SENT]: [OFFER_STATUS.ACCEPTED, OFFER_STATUS.DECLINED, OFFER_STATUS.WITHDRAWN],
  // Only an accepted offer can become an employee.
  [OFFER_STATUS.ACCEPTED]: [OFFER_STATUS.JOINED, OFFER_STATUS.WITHDRAWN],
  [OFFER_STATUS.DECLINED]: [],
  [OFFER_STATUS.WITHDRAWN]: [],
  [OFFER_STATUS.JOINED]: [],
};

/* -------------------------------------------------------------------------- */
/*                              Account & audit                               */
/* -------------------------------------------------------------------------- */

/** Actions recorded in the audit trail. */
export const AUDIT_ACTIONS = {
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
  RESTORE: 'RESTORE',
  STATUS_CHANGE: 'STATUS_CHANGE',
  IMPORT: 'IMPORT',
  EXPORT: 'EXPORT',
  UPLOAD: 'UPLOAD',
  BULK_UPDATE: 'BULK_UPDATE',
};

/**
 * Fields never written to the audit trail in clear text. An audit log that
 * records a national identity number in its `before` snapshot has simply
 * duplicated the sensitive data into a second, longer-lived table.
 */
export const AUDIT_REDACTED_FIELDS = [
  'password',
  'statutory.nationalIdNumber',
  'statutory.tinNumber',
  'bankDetails.accountNumber',
];


export const ACCOUNT_STATUS = {
  PENDING: 'PENDING', // Registered, email not yet verified
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED', // Disabled by an administrator
  LOCKED: 'LOCKED', // Auto-locked by the failed-login counter
  DEACTIVATED: 'DEACTIVATED', // Offboarded
};

export const TOKEN_TYPES = {
  EMAIL_VERIFICATION: 'EMAIL_VERIFICATION',
  PASSWORD_RESET: 'PASSWORD_RESET',
};

export const LOGIN_STATUS = {
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
};

/** Recorded on every failed attempt so support can explain a lockout. */
export const LOGIN_FAILURE_REASONS = {
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  INVALID_PASSWORD: 'INVALID_PASSWORD',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
  ACCOUNT_DEACTIVATED: 'ACCOUNT_DEACTIVATED',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  ROLE_NOT_PERMITTED: 'ROLE_NOT_PERMITTED',
};

export const LOGIN_EVENTS = {
  LOGIN: 'LOGIN',
  LOGOUT: 'LOGOUT',
  TOKEN_REFRESH: 'TOKEN_REFRESH',
  PASSWORD_CHANGE: 'PASSWORD_CHANGE',
  PASSWORD_RESET: 'PASSWORD_RESET',
};

export const COOKIE_NAMES = {
  REFRESH_TOKEN: 'hrms_rt',
};

export const ERROR_CODES = {
  INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  ACCOUNT_LOCKED: 'AUTH_ACCOUNT_LOCKED',
  EMAIL_NOT_VERIFIED: 'AUTH_EMAIL_NOT_VERIFIED',
  TOKEN_EXPIRED: 'AUTH_TOKEN_EXPIRED',
  TOKEN_INVALID: 'AUTH_TOKEN_INVALID',
  TOKEN_REUSED: 'AUTH_TOKEN_REUSED',
  SESSION_EXPIRED: 'AUTH_SESSION_EXPIRED',
  PASSWORD_CHANGED: 'AUTH_PASSWORD_CHANGED',
  FORBIDDEN_ROLE: 'AUTH_FORBIDDEN_ROLE',
  FORBIDDEN_PERMISSION: 'RBAC_PERMISSION_DENIED',
  FORBIDDEN_SCOPE: 'RBAC_SCOPE_DENIED',
  FORBIDDEN_TENANT: 'RBAC_TENANT_DENIED',
};
