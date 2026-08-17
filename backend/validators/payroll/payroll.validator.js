import Joi from 'joi';
import {
  PAYROLL_STATUS,
  PAYSLIP_STATUS,
  LOAN_TYPES,
  LOAN_STATUS,
  TAX_REGIME,
  BANK_FILE_FORMATS,
  COMPONENT_CODE,
} from '../../utils/constants.js';
import { RUN_SORTABLE_FIELDS, PAYSLIP_SORTABLE_FIELDS } from '../../services/payroll/payroll.service.js';
import { SORTABLE_FIELDS as LOAN_SORTABLE } from '../../services/payroll/loan.service.js';

const objectId = Joi.string().hex().length(24).messages({
  'string.hex': 'Must be a valid identifier',
  'string.length': 'Must be a valid identifier',
});

const money = (max = 100_000_000) => Joi.number().min(0).max(max).precision(2);

const paging = {
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(200).default(25),
};

const year = Joi.number().integer().min(2000).max(2100);
const month = Joi.number().integer().min(1).max(12);

/* ---------------------------------------------------- salary structure -- */

const allowance = Joi.object({
  code: Joi.string().trim().uppercase().max(40).default(COMPONENT_CODE.OTHER_ALLOWANCE),
  label: Joi.string().trim().min(2).max(60).required(),
  amount: money().required(),
  prorate: Joi.boolean().default(true),
  taxable: Joi.boolean().default(true),
});

export const createStructureSchema = {
  body: Joi.object({
    employeeId: objectId.required(),
    effectiveFrom: Joi.date().required(),
    annualCtc: money(1_000_000_000).required(),
    monthlyCtc: money(),

    basic: money().required(),
    hra: money().default(0),
    da: money().default(0),
    specialAllowance: money().default(0),
    otherAllowances: Joi.array().items(allowance).max(15).default([]),

    pfApplicable: Joi.boolean().default(true),
    esiApplicable: Joi.boolean().default(true),
    ptApplicable: Joi.boolean().default(true),
    tdsApplicable: Joi.boolean().default(true),
    taxRegime: Joi.string().valid(...Object.values(TAX_REGIME)).default(TAX_REGIME.NEW),
    tdsOverride: money().allow(null),

    overtimeEligible: Joi.boolean().default(true),
    overtimeMultiplier: Joi.number().min(1).max(4).default(2),

    revisionReason: Joi.string().trim().max(300).allow('', null),
  }),
};

export const ctcPreviewSchema = {
  query: Joi.object({
    annualCtc: money(1_000_000_000).required(),
    basicPercent: Joi.number().min(20).max(70).default(40),
    hraPercent: Joi.number().min(0).max(100).default(50),
    daPercent: Joi.number().min(0).max(100).default(0),
  }),
};

export const employeeParamSchema = {
  params: Joi.object({ employeeId: objectId.required() }),
};

/* --------------------------------------------------------- payroll run -- */

/**
 * One-off pay for a single employee in this run.
 *
 * Bonus, incentive and arrears are payslip lines, not standing entitlements --
 * they apply to one period and are recorded on the payslip the run produces.
 * That payslip IS the record, which is why none of this needs a table of its
 * own: a parallel bonus collection would be a second place for the same figure
 * to live and drift from.
 */
const variablePayEntry = Joi.object({
  employeeId: objectId.required(),
  bonus: money(10_000_000),
  incentive: money(10_000_000),
  arrears: money(10_000_000),
  otherEarnings: Joi.array()
    .items(
      Joi.object({
        code: Joi.string().trim().uppercase().max(30),
        label: Joi.string().trim().max(60).required(),
        amount: money(10_000_000).required(),
      }),
    )
    .max(10),
  otherDeductions: Joi.array()
    .items(
      Joi.object({
        code: Joi.string().trim().uppercase().max(30),
        label: Joi.string().trim().max(60).required(),
        amount: money(10_000_000).required(),
      }),
    )
    .max(10),
})
  // An entry that grants nothing is a client bug, not a no-op worth storing.
  .or('bonus', 'incentive', 'arrears', 'otherEarnings', 'otherDeductions');

export const processRunSchema = {
  body: Joi.object({
    year: year.required(),
    month: month.required(),
    // Omit to price the whole organisation; supply ids for a partial rerun.
    employeeIds: Joi.array().items(objectId).max(5000),
    variablePay: Joi.array().items(variablePayEntry).max(5000),
    remarks: Joi.string().trim().max(1000).allow('', null),
  }),
};

export const idParamSchema = {
  params: Joi.object({ id: objectId.required() }),
};

export const markPaidSchema = {
  params: Joi.object({ id: objectId.required() }),
  body: Joi.object({
    paymentReference: Joi.string().trim().max(120).allow('', null),
  }).default({}),
};

export const cancelRunSchema = {
  params: Joi.object({ id: objectId.required() }),
  body: Joi.object({
    // Cancelling a priced register is the question an auditor always asks.
    reason: Joi.string().trim().min(3).max(500).required(),
  }),
};

export const listRunsSchema = {
  query: Joi.object({
    ...paging,
    sortBy: Joi.string().valid(...RUN_SORTABLE_FIELDS),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
    status: Joi.string().valid(...Object.values(PAYROLL_STATUS)),
    year,
  }),
};

export const bankFileSchema = {
  params: Joi.object({ id: objectId.required() }),
  query: Joi.object({
    format: Joi.string().valid(...Object.values(BANK_FILE_FORMATS)),
  }),
};

/* ------------------------------------------------------------ payslips -- */

export const listPayslipsSchema = {
  query: Joi.object({
    ...paging,
    sortBy: Joi.string().valid(...PAYSLIP_SORTABLE_FIELDS),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
    payrollRunId: objectId,
    employeeId: objectId,
    year,
    month,
    status: Joi.string().valid(...Object.values(PAYSLIP_STATUS)),
  }),
};

export const holdPayslipSchema = {
  params: Joi.object({ id: objectId.required() }),
  body: Joi.object({
    hold: Joi.boolean().required(),
    reason: Joi.string().trim().max(300).allow('', null),
  }).when(Joi.object({ hold: Joi.valid(true) }).unknown(), {
    // Holding someone's salary without a stated reason is not defensible.
    then: Joi.object({ reason: Joi.string().trim().min(3).max(300).required() }),
  }),
};

/* --------------------------------------------------------------- loans -- */

export const createLoanSchema = {
  body: Joi.object({
    employeeId: objectId.required(),
    type: Joi.string().valid(...Object.values(LOAN_TYPES)).default(LOAN_TYPES.PERSONAL),
    principal: money(50_000_000).min(1).required(),
    interestRate: Joi.number().min(0).max(100).default(0),
    tenureMonths: Joi.number().integer().min(1).max(120).required(),
    recoveryStartYear: year.required(),
    recoveryStartMonth: month.required(),
    purpose: Joi.string().trim().max(300).allow('', null),
  }),
};

export const decideLoanSchema = {
  params: Joi.object({ id: objectId.required() }),
  body: Joi.object({
    decision: Joi.string().valid(LOAN_STATUS.APPROVED, LOAN_STATUS.REJECTED).required(),
    reason: Joi.string().trim().max(300).allow('', null),
  }).when(Joi.object({ decision: Joi.valid(LOAN_STATUS.REJECTED) }).unknown(), {
    then: Joi.object({ reason: Joi.string().trim().min(3).max(300).required() }),
  }),
};

export const disburseLoanSchema = {
  params: Joi.object({ id: objectId.required() }),
  body: Joi.object({ disbursedOn: Joi.date().allow(null, '') }).default({}),
};

export const loanHoldSchema = {
  params: Joi.object({ id: objectId.required() }),
  body: Joi.object({
    hold: Joi.boolean().required(),
    reason: Joi.string().trim().max(300).allow('', null),
  }),
};

export const loanRepaymentSchema = {
  params: Joi.object({ id: objectId.required() }),
  body: Joi.object({
    amount: money(50_000_000).min(1).required(),
    note: Joi.string().trim().max(300).allow('', null),
  }),
};

export const listLoansSchema = {
  query: Joi.object({
    ...paging,
    sortBy: Joi.string().valid(...LOAN_SORTABLE),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
    status: Joi.string().valid(...Object.values(LOAN_STATUS)),
    type: Joi.string().valid(...Object.values(LOAN_TYPES)),
    employeeId: objectId,
  }),
};

/* ------------------------------------------------------------- reports -- */

export const periodQuerySchema = {
  query: Joi.object({ year: year.required(), month: month.required() }),
};

export const yearQuerySchema = {
  query: Joi.object({ year: year.required() }),
};

/* ------------------------------------------------------------ settings -- */

const slab = Joi.object({
  upTo: Joi.number().min(0).allow(null),
  rate: Joi.number().min(0).max(100).default(0),
  amount: Joi.number().min(0).default(0),
});

export const upsertSettingsSchema = {
  body: Joi.object({
    currency: Joi.string().trim().uppercase().length(3),
    financialYearStartMonth: month,

    pf: Joi.object({
      enabled: Joi.boolean(),
      employeeRate: Joi.number().min(0).max(100),
      employerRate: Joi.number().min(0).max(100),
      pensionRate: Joi.number().min(0).max(100),
      wageCeiling: money(),
      applyCeiling: Joi.boolean(),
      includeDaInWages: Joi.boolean(),
      establishmentCode: Joi.string().trim().max(40).allow('', null),
    }),

    esi: Joi.object({
      enabled: Joi.boolean(),
      employeeRate: Joi.number().min(0).max(100),
      employerRate: Joi.number().min(0).max(100),
      grossCeiling: money(),
      establishmentCode: Joi.string().trim().max(40).allow('', null),
    }),

    professionalTax: Joi.object({
      enabled: Joi.boolean(),
      state: Joi.string().trim().max(60).allow('', null),
      slabs: Joi.array().items(slab).max(12),
      februaryAmount: money(10_000),
      annualCap: money(100_000),
    }),

    incomeTax: Joi.object({
      enabled: Joi.boolean(),
      regime: Joi.string().valid(...Object.values(TAX_REGIME)),
      standardDeduction: money(1_000_000),
      slabs: Joi.array().items(slab).max(12),
      rebateLimit: money(10_000_000),
      rebateAmount: money(1_000_000),
      cessRate: Joi.number().min(0).max(100),
      tanNumber: Joi.string().trim().max(20).allow('', null),
    }),

    payableDaysBasis: Joi.string().valid('CALENDAR', 'WORKING'),
    overtimeMultiplier: Joi.number().min(1).max(4),
    requireAttendanceLock: Joi.boolean(),

    bank: Joi.object({
      format: Joi.string().valid(...Object.values(BANK_FILE_FORMATS)),
      companyAccountNumber: Joi.string().trim().max(30).allow('', null),
      companyName: Joi.string().trim().max(120).allow('', null),
      ifsc: Joi.string().trim().uppercase().max(11).allow('', null),
      debitNarration: Joi.string().trim().max(20).allow('', null),
    }),
  }).min(1),
};

export default {
  createStructureSchema,
  ctcPreviewSchema,
  employeeParamSchema,
  processRunSchema,
  idParamSchema,
  markPaidSchema,
  cancelRunSchema,
  listRunsSchema,
  bankFileSchema,
  listPayslipsSchema,
  holdPayslipSchema,
  createLoanSchema,
  decideLoanSchema,
  disburseLoanSchema,
  loanHoldSchema,
  loanRepaymentSchema,
  listLoansSchema,
  periodQuerySchema,
  yearQuerySchema,
  upsertSettingsSchema,
};
