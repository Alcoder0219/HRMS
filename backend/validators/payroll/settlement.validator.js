import Joi from 'joi';
import {
  SETTLEMENT_STATUS,
  SETTLEMENT_TRIGGER,
  ASSET_CATEGORY,
  ASSET_STATUS,
  ASSET_CONDITION,
} from '../../utils/constants.js';
import { SORTABLE_FIELDS } from '../../services/payroll/settlement.service.js';
import { SORTABLE_FIELDS as ASSET_SORTABLE } from '../../services/employee/asset.service.js';

const objectId = Joi.string().hex().length(24).messages({
  'string.hex': 'Must be a valid identifier',
  'string.length': 'Must be a valid identifier',
});

const money = (max = 100_000_000) => Joi.number().min(0).max(max).precision(2);
const days = (max = 365) => Joi.number().min(0).max(max);

const paging = {
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(200).default(25),
};

/* ------------------------------------------------------------ settlement -- */

const noticeInput = Joi.object({
  requiredDays: days(365),
  servedDays: days(365),
  waivedDays: days(365),
  employerWaived: Joi.boolean(),
});

const leaveInput = Joi.object({
  // Supplied by HR until the Leave module owns balances.
  encashableDays: days(365),
  excessDays: days(365),
});

const extrasInput = Joi.object({
  bonus: money(),
  incentive: money(),
  arrears: money(),
  reimbursement: money(),
  paye: money(),
  otherEarnings: Joi.array()
    .items(Joi.object({ label: Joi.string().trim().max(60).required(), amount: money().required() }))
    .max(10),
  otherDeductions: Joi.array()
    .items(Joi.object({ label: Joi.string().trim().max(60).required(), amount: money().required() }))
    .max(10),
});

const rulesInput = Joi.object({
  severance: Joi.object({
    enabled: Joi.boolean(),
    minimumMonths: Joi.number().min(0).max(120),
    daysPerYear: Joi.number().min(1).max(30),
    monthDays: Joi.number().min(20).max(31),
    maxYears: Joi.number().min(1).max(50),
    roundUpFromMonths: Joi.number().min(0).max(12),
    payableOnTriggers: Joi.array().items(Joi.string().valid(...Object.values(SETTLEMENT_TRIGGER))).max(6),
  }),
  notice: Joi.object({
    perDayBasis: Joi.string().valid('GROSS', 'BASIC'),
    monthDays: Joi.number().min(20).max(31),
  }),
  leaveEncashment: Joi.object({
    enabled: Joi.boolean(),
    perDayBasis: Joi.string().valid('GROSS', 'BASIC'),
    monthDays: Joi.number().min(20).max(31),
    // The statutory cycle entitlement is 28 days; a tenant may configure less
    // but not a figure an employee could never have accrued.
    maxDays: days(28),
  }),
});

export const createSettlementSchema = {
  body: Joi.object({
    employeeId: objectId.required(),
    trigger: Joi.string().valid(...Object.values(SETTLEMENT_TRIGGER)),
    // Both fall back to the lifecycle dates the employee record already holds.
    lastWorkingDate: Joi.date(),
    resignationDate: Joi.date().allow(null, ''),
    lastPaidUpto: Joi.date().allow(null, ''),
    exitReason: Joi.string().trim().max(500).allow('', null),
    rehireEligible: Joi.boolean(),

    notice: noticeInput,
    leave: leaveInput,
    extras: extrasInput,
    rules: rulesInput,

    remarks: Joi.string().trim().max(1000).allow('', null),
  }),
};

export const recalculateSchema = {
  params: Joi.object({ id: objectId.required() }),
  body: Joi.object({
    trigger: Joi.string().valid(...Object.values(SETTLEMENT_TRIGGER)),
    lastWorkingDate: Joi.date(),
    resignationDate: Joi.date().allow(null, ''),
    lastPaidUpto: Joi.date().allow(null, ''),
    exitReason: Joi.string().trim().max(500).allow('', null),
    rehireEligible: Joi.boolean(),
    notice: noticeInput,
    leave: leaveInput,
    extras: extrasInput,
    rules: rulesInput,
    remarks: Joi.string().trim().max(1000).allow('', null),
  }).default({}),
};

export const idParamSchema = {
  params: Joi.object({ id: objectId.required() }),
};

export const decisionSchema = {
  params: Joi.object({ id: objectId.required() }),
  body: Joi.object({
    decision: Joi.string().valid('APPROVED', 'RETURNED').required(),
    comment: Joi.string().trim().max(500).allow('', null),
  }).when(Joi.object({ decision: Joi.valid('RETURNED') }).unknown(), {
    // Sending a settlement back without saying why guarantees a second round.
    then: Joi.object({ comment: Joi.string().trim().min(3).max(500).required() }),
  }),
};

export const markPaidSchema = {
  params: Joi.object({ id: objectId.required() }),
  body: Joi.object({
    paymentReference: Joi.string().trim().max(120).allow('', null),
    paymentMode: Joi.string().trim().max(40).allow('', null),
  }).default({}),
};

export const holdSchema = {
  params: Joi.object({ id: objectId.required() }),
  body: Joi.object({ reason: Joi.string().trim().min(3).max(500).required() }),
};

export const releaseSchema = {
  params: Joi.object({ id: objectId.required() }),
  body: Joi.object({
    toStatus: Joi.string()
      .valid(SETTLEMENT_STATUS.PENDING_HR, SETTLEMENT_STATUS.PENDING_FINANCE, SETTLEMENT_STATUS.APPROVED)
      .required(),
  }),
};

export const cancelSchema = {
  params: Joi.object({ id: objectId.required() }),
  body: Joi.object({ reason: Joi.string().trim().min(3).max(500).required() }),
};

export const listSettlementsSchema = {
  query: Joi.object({
    ...paging,
    sortBy: Joi.string().valid(...SORTABLE_FIELDS),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
    status: Joi.string().valid(...Object.values(SETTLEMENT_STATUS)),
    trigger: Joi.string().valid(...Object.values(SETTLEMENT_TRIGGER)),
    employeeId: objectId,
    from: Joi.date(),
    to: Joi.date().min(Joi.ref('from')).messages({
      'date.min': 'The end of the range must be after its start',
    }),
  }),
};

/* ---------------------------------------------------------------- assets -- */

export const createAssetSchema = {
  body: Joi.object({
    assetCode: Joi.string().trim().uppercase().max(30),
    name: Joi.string().trim().min(2).max(120).required(),
    category: Joi.string().valid(...Object.values(ASSET_CATEGORY)).default(ASSET_CATEGORY.OTHER),
    serialNumber: Joi.string().trim().max(60).allow('', null),
    make: Joi.string().trim().max(60).allow('', null),
    model: Joi.string().trim().max(60).allow('', null),
    purchaseDate: Joi.date().allow(null, ''),
    purchaseCost: money(10_000_000),
    // Normally the depreciated or agreed value, not the purchase price.
    recoveryValue: money(10_000_000),
    condition: Joi.string().valid(...Object.values(ASSET_CONDITION)),
    notes: Joi.string().trim().max(500).allow('', null),
  }),
};

export const assignAssetSchema = {
  params: Joi.object({ id: objectId.required() }),
  body: Joi.object({
    employeeId: objectId.required(),
    assignedOn: Joi.date().allow(null, ''),
    condition: Joi.string().valid(...Object.values(ASSET_CONDITION)),
    remarks: Joi.string().trim().max(300).allow('', null),
  }),
};

export const returnAssetSchema = {
  params: Joi.object({ id: objectId.required() }),
  body: Joi.object({
    returnedOn: Joi.date().allow(null, ''),
    condition: Joi.string().valid(...Object.values(ASSET_CONDITION)),
    recoveryAmount: money(10_000_000).default(0),
    remarks: Joi.string().trim().max(300).allow('', null),
  }).default({}),
};

export const lostAssetSchema = {
  params: Joi.object({ id: objectId.required() }),
  body: Joi.object({
    recoveryAmount: money(10_000_000),
    remarks: Joi.string().trim().max(300).allow('', null),
  }).default({}),
};

export const listAssetsSchema = {
  query: Joi.object({
    ...paging,
    sortBy: Joi.string().valid(...ASSET_SORTABLE),
    sortOrder: Joi.string().valid('asc', 'desc').default('asc'),
    status: Joi.string().valid(...Object.values(ASSET_STATUS)),
    category: Joi.string().valid(...Object.values(ASSET_CATEGORY)),
    employeeId: objectId,
    search: Joi.string().trim().max(100).allow(''),
  }),
};

export default {
  createSettlementSchema,
  recalculateSchema,
  idParamSchema,
  decisionSchema,
  markPaidSchema,
  holdSchema,
  releaseSchema,
  cancelSchema,
  listSettlementsSchema,
  createAssetSchema,
  assignAssetSchema,
  returnAssetSchema,
  lostAssetSchema,
  listAssetsSchema,
};
