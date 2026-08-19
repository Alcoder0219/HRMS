import logger from '../../config/logger.js';
import ApiError from '../../utils/ApiError.js';
import {
  AUDIT_ACTIONS,
  EDITABLE_SETTLEMENT_STATUSES,
  EMPLOYEE_STATUS,
  LOAN_STATUS,
  RESOURCES,
  SETTLEMENT_STATUS,
  SETTLEMENT_STATUS_TRANSITIONS,
  SETTLEMENT_TRIGGER,
} from '../../utils/constants.js';
import { buildPagination, buildSort, dateRange } from '../../utils/queryBuilder.js';

import Settlement from '../../models/payroll/settlement.model.js';
import Employee from '../../models/employee/employee.model.js';
import Loan from '../../models/payroll/loan.model.js';
import Payslip from '../../models/payroll/payslip.model.js';
import { structureGross } from '../../models/payroll/salaryStructure.model.js';
import payrollRepository from '../../repositories/payroll/payroll.repository.js';
import employeeRepository from '../../repositories/employee/employee.repository.js';
import assetService from '../employee/asset.service.js';

import {
  buildSettlementSheet,
  calculateService,
  DEFAULT_SETTLEMENT_RULES,
} from '../../helpers/settlementCalculator.helper.js';
import { roundToCurrency } from '../../helpers/statutory.helper.js';
import { recordAudit } from '../../helpers/audit.helper.js';
import { buildScopeFilter } from '../../helpers/permission.helper.js';

const ENTITY = 'Settlement';

export const SORTABLE_FIELDS = ['lastWorkingDate', 'netSettlement', 'status', 'createdAt'];

const POPULATE = [
  {
    path: 'employeeId',
    select: 'employeeCode employeeId firstName lastName departmentId designationId bankDetails statutory',
    populate: [
      { path: 'departmentId', select: 'name code' },
      { path: 'designationId', select: 'name code' },
    ],
  },
];

/** Exit states that make a settlement legitimate. */
const EXIT_STATUSES = [
  EMPLOYEE_STATUS.NOTICE_PERIOD,
  EMPLOYEE_STATUS.RESIGNED,
  EMPLOYEE_STATUS.TERMINATED,
  EMPLOYEE_STATUS.RETIRED,
];

const TRIGGER_FROM_STATUS = {
  [EMPLOYEE_STATUS.RESIGNED]: SETTLEMENT_TRIGGER.RESIGNATION,
  [EMPLOYEE_STATUS.NOTICE_PERIOD]: SETTLEMENT_TRIGGER.RESIGNATION,
  [EMPLOYEE_STATUS.TERMINATED]: SETTLEMENT_TRIGGER.TERMINATION,
  [EMPLOYEE_STATUS.RETIRED]: SETTLEMENT_TRIGGER.RETIREMENT,
};

/** Ageing buckets, in days since the last working date. */
const AGEING_BOUNDARIES = [0, 15, 30, 60, 90];
const AGEING_LABELS = {
  0: '0-14 days',
  15: '15-29 days',
  30: '30-59 days',
  60: '60-89 days',
  '90+': '90+ days',
};

const nextSettlementNumber = async (tenantId) => {
  const latest = await Settlement.findOne({ tenantId: tenantId ?? null, settlementNumber: /^FNF\d+$/ })
    .sort({ settlementNumber: -1 })
    .select('settlementNumber')
    .lean();

  const current = latest ? Number(latest.settlementNumber.slice(3)) : 0;
  return `FNF${String(current + 1).padStart(6, '0')}`;
};

const assertTenant = (record, req) => {
  const callerTenant = req.user.tenantId ?? null;
  if (callerTenant !== null && String(record.tenantId) !== callerTenant) {
    throw ApiError.notFound('Settlement not found');
  }
};

const assertEditable = (settlement) => {
  if (!EDITABLE_SETTLEMENT_STATUSES.includes(settlement.status)) {
    throw ApiError.badRequest(
      `This settlement is ${settlement.status.toLowerCase().replace(/_/g, ' ')} and can no longer be changed`,
    );
  }
};

/* -------------------------------------------------------------------------- */
/*                              Input gathering                               */
/* -------------------------------------------------------------------------- */

/**
 * Pending (unpaid) days between the last paid date and the last working day.
 *
 * Derived from the last payslip rather than trusted from the caller, because
 * the single most expensive settlement error is paying a month twice.
 */
const resolvePendingSalary = async (employeeId, lastWorkingDate, lastPaidUpto) => {
  let paidUpto = lastPaidUpto ? new Date(lastPaidUpto) : null;

  if (!paidUpto) {
    const latest = await Payslip.findOne({ employeeId }).sort({ year: -1, month: -1 }).lean();
    // End of the last month actually paid.
    paidUpto = latest ? new Date(latest.year, latest.month, 0) : null;
  }

  if (!paidUpto) {
    return { days: 0, fromDate: null, toDate: lastWorkingDate, note: 'No prior payslip found' };
  }

  const from = new Date(paidUpto);
  from.setDate(from.getDate() + 1);

  const to = new Date(lastWorkingDate);
  const days = Math.max(0, Math.floor((to - from) / 86_400_000) + 1);

  return { days, fromDate: from, toDate: to, paidUpto };
};

/**
 * Everything recoverable at exit, gathered in one place.
 *
 * Loan and advance balances fall due in full -- there are no further payslips
 * to take an EMI from. Assets still held are valued at their recovery amount,
 * and counted so approval can be blocked while kit is outstanding.
 */
const gatherRecoveries = async (employeeId) => {
  const [loans, assets] = await Promise.all([
    Loan.find({
      employeeId,
      status: { $in: [LOAN_STATUS.DISBURSED, LOAN_STATUS.ACTIVE, LOAN_STATUS.APPROVED] },
      outstanding: { $gt: 0 },
    }).lean(),
    assetService.findHeldByEmployee(employeeId),
  ]);

  // Salary advances are modelled as short-tenure loans, so they are separated
  // by type rather than by collection.
  const isAdvance = (loan) => loan.type === 'SALARY_ADVANCE';

  return {
    loans: loans.filter((loan) => !isAdvance(loan)).map((loan) => ({
      loanId: loan._id,
      loanNumber: loan.loanNumber,
      type: loan.type,
      outstanding: roundToCurrency(loan.outstanding),
    })),
    advances: loans.filter(isAdvance).map((loan) => ({
      advanceId: loan._id,
      reference: loan.loanNumber,
      outstanding: roundToCurrency(loan.outstanding),
    })),
    assets: assets.map((asset) => ({
      assetId: asset._id,
      assetCode: asset.assetCode,
      name: asset.name,
      category: asset.category,
      recoveryAmount: roundToCurrency(asset.recoveryValue ?? 0),
    })),
  };
};

/* -------------------------------------------------------------------------- */
/*                                 Calculation                                */
/* -------------------------------------------------------------------------- */

/**
 * Prices a settlement from the employee's records plus the HR-supplied inputs
 * that cannot be derived (encashable leave, notice served, discretionary
 * bonus).
 *
 * Used by both create and recalculate, so a draft that is edited is priced by
 * exactly the same path as one that is created.
 */
const priceSettlement = async ({ employee, payload, rules }) => {
  const lastWorkingDate = new Date(payload.lastWorkingDate);
  const joiningDate = new Date(employee.joiningDate);

  if (lastWorkingDate < joiningDate) {
    throw ApiError.unprocessable('Validation failed', [
      { field: 'lastWorkingDate', message: 'The last working date cannot precede the joining date' },
    ]);
  }

  const structure = await payrollRepository.findStructureOn(employee._id, lastWorkingDate);
  if (!structure) {
    throw ApiError.badRequest('This employee has no salary structure, so a settlement cannot be priced');
  }

  const service = calculateService(joiningDate, lastWorkingDate, {
    roundUpFromMonths: rules.severance?.roundUpFromMonths ?? 6,
  });

  const pending = await resolvePendingSalary(employee._id, lastWorkingDate, payload.lastPaidUpto);
  const recoveries = await gatherRecoveries(employee._id);

  // Through the structure's own gross helper, so the figure a settlement is
  // priced from is the same one payroll priced the last payslip from.
  const monthlyGross = structureGross(structure);

  const sheet = buildSettlementSheet({
    structure: { ...structure, monthlyGross },
    service,
    trigger: payload.trigger,
    pendingSalary: { days: pending.days, perDay: monthlyGross / 30 },
    notice: {
      requiredDays: payload.notice?.requiredDays ?? 0,
      servedDays: payload.notice?.servedDays ?? 0,
      waivedDays: payload.notice?.waivedDays ?? 0,
      employerWaived: payload.notice?.employerWaived ?? false,
    },
    leave: {
      encashableDays: payload.leave?.encashableDays ?? 0,
      excessDays: payload.leave?.excessDays ?? 0,
    },
    loans: recoveries.loans,
    advances: recoveries.advances,
    assets: recoveries.assets,
    extras: payload.extras ?? {},
    rules,
  });

  return { sheet, service, structure, pending, recoveries, monthlyGross, lastWorkingDate, joiningDate };
};

const toDocument = ({ employee, payload, priced, rules, req }) => ({
  tenantId: employee.tenantId ?? null,
  employeeId: employee._id,
  trigger: payload.trigger,

  resignationDate: payload.resignationDate ? new Date(payload.resignationDate) : null,
  lastWorkingDate: priced.lastWorkingDate,
  lastPaidUpto: priced.pending.paidUpto ?? null,
  exitReason: payload.exitReason ?? null,
  rehireEligible: payload.rehireEligible ?? true,

  joiningDate: priced.joiningDate,
  service: priced.service,

  notice: {
    requiredDays: payload.notice?.requiredDays ?? 0,
    servedDays: payload.notice?.servedDays ?? 0,
    waivedDays: payload.notice?.waivedDays ?? 0,
    employerWaived: payload.notice?.employerWaived ?? false,
    ...priced.sheet.breakdown.notice,
  },

  leave: {
    encashableDays: payload.leave?.encashableDays ?? 0,
    excessDays: payload.leave?.excessDays ?? 0,
    perDay: priced.sheet.breakdown.leaveEncashment.perDay,
    amount: priced.sheet.breakdown.leaveEncashment.amount,
  },

  severance: priced.sheet.breakdown.severance,

  employeeSnapshot: {
    employeeCode: employee.employeeCode,
    employeeId: employee.employeeId ?? null,
    fullName: [employee.firstName, employee.middleName, employee.lastName].filter(Boolean).join(' '),
    designation: employee.designationId?.name ?? null,
    department: employee.departmentId?.name ?? null,
    joiningDate: employee.joiningDate,
    tinNumber: employee.statutory?.tinNumber ?? null,
    nssfNumber: employee.statutory?.nssfNumber ?? null,
    bankName: employee.bankDetails?.bankName ?? null,
    swiftCode: employee.bankDetails?.swiftCode ?? null,
  },
  structureSnapshot: {
    basic: priced.structure.basic,
    hraAllowance: priced.structure.hraAllowance,
    transportationAllowance: priced.structure.transportationAllowance,
    communicationAllowance: priced.structure.communicationAllowance,
    monthlyGross: roundToCurrency(priced.monthlyGross),
    effectiveFrom: priced.structure.effectiveFrom,
  },
  rulesSnapshot: rules,

  loans: priced.recoveries.loans,
  advances: priced.recoveries.advances,
  assets: priced.recoveries.assets,
  pendingAssetCount: priced.recoveries.assets.length,

  earnings: priced.sheet.earnings,
  deductions: priced.sheet.deductions,
  totalEarnings: priced.sheet.totalEarnings,
  totalDeductions: priced.sheet.totalDeductions,
  netSettlement: priced.sheet.netSettlement,
  payableTo: priced.sheet.payableTo,
  recoverableAmount: priced.sheet.recoverableAmount,

  remarks: payload.remarks ?? null,
  updatedBy: req.user.id,
});

/* -------------------------------------------------------------------------- */
/*                                   Create                                   */
/* -------------------------------------------------------------------------- */

export const createSettlement = async (payload, req) => {
  const employee = await Employee.findById(payload.employeeId)
    .populate([
      { path: 'departmentId', select: 'name code' },
      { path: 'designationId', select: 'name code' },
    ])
    .lean();

  if (!employee || employee.deletedAt) throw ApiError.notFound('Employee not found');

  const callerTenant = req.user.tenantId ?? null;
  if (callerTenant !== null && String(employee.tenantId ?? null) !== callerTenant) {
    throw ApiError.notFound('Employee not found');
  }

  // Settling someone who is still employed would pay out severance and
  // encashment to a person who has not left.
  if (!EXIT_STATUSES.includes(employee.status)) {
    throw ApiError.badRequest(
      `A settlement can only be raised for an exiting employee. ${employee.employeeCode} is ${employee.status}.`,
    );
  }

  const existing = await Settlement.findOne({
    employeeId: employee._id,
    status: { $nin: [SETTLEMENT_STATUS.PAID, SETTLEMENT_STATUS.CANCELLED] },
  });
  if (existing) {
    throw ApiError.conflict(`Settlement ${existing.settlementNumber} is already open for this employee`);
  }

  const rules = { ...DEFAULT_SETTLEMENT_RULES, ...(payload.rules ?? {}) };

  const body = {
    ...payload,
    trigger: payload.trigger ?? TRIGGER_FROM_STATUS[employee.status] ?? SETTLEMENT_TRIGGER.RESIGNATION,
    // Fall back to the lifecycle dates the employee module already recorded.
    lastWorkingDate: payload.lastWorkingDate ?? employee.lifecycle?.lastWorkingDate,
    resignationDate: payload.resignationDate ?? employee.lifecycle?.resignationDate,
    exitReason: payload.exitReason ?? employee.lifecycle?.exitReason,
    rehireEligible: payload.rehireEligible ?? employee.lifecycle?.rehireEligible,
  };

  if (!body.lastWorkingDate) {
    throw ApiError.badRequest('A last working date is required and none is recorded against this employee');
  }

  const priced = await priceSettlement({ employee, payload: body, rules });

  const settlement = await Settlement.create({
    ...toDocument({ employee, payload: body, priced, rules, req }),
    settlementNumber: await nextSettlementNumber(employee.tenantId),
    status: SETTLEMENT_STATUS.DRAFT,
    createdBy: req.user.id,
  });

  await recordAudit({
    req,
    entity: ENTITY,
    entityId: settlement._id,
    entityLabel: `${settlement.settlementNumber} · ${employee.employeeCode}`,
    action: AUDIT_ACTIONS.CREATE,
    metadata: {
      trigger: settlement.trigger,
      net: settlement.netSettlement,
      pendingAssets: settlement.pendingAssetCount,
    },
  });

  logger.info('Settlement created', {
    settlementNumber: settlement.settlementNumber,
    employee: employee.employeeCode,
    net: settlement.netSettlement,
  });

  return Settlement.findById(settlement._id).populate(POPULATE);
};

/**
 * Reprices an open settlement.
 *
 * Idempotent, and the only way a draft changes: an asset returned or a loan
 * settled after the draft was raised has to flow through the same calculation
 * rather than being patched onto the sheet by hand.
 */
export const recalculateSettlement = async (settlementId, payload, req) => {
  const settlement = await Settlement.findById(settlementId);
  if (!settlement) throw ApiError.notFound('Settlement not found');
  assertTenant(settlement, req);
  assertEditable(settlement);

  const employee = await Employee.findById(settlement.employeeId)
    .populate([
      { path: 'departmentId', select: 'name code' },
      { path: 'designationId', select: 'name code' },
    ])
    .lean();
  if (!employee) throw ApiError.notFound('Employee not found');

  const rules = { ...DEFAULT_SETTLEMENT_RULES, ...(payload.rules ?? settlement.rulesSnapshot ?? {}) };

  const merged = {
    trigger: payload.trigger ?? settlement.trigger,
    lastWorkingDate: payload.lastWorkingDate ?? settlement.lastWorkingDate,
    resignationDate: payload.resignationDate ?? settlement.resignationDate,
    lastPaidUpto: payload.lastPaidUpto ?? settlement.lastPaidUpto,
    exitReason: payload.exitReason ?? settlement.exitReason,
    rehireEligible: payload.rehireEligible ?? settlement.rehireEligible,
    notice: { ...(settlement.notice?.toObject?.() ?? settlement.notice ?? {}), ...(payload.notice ?? {}) },
    leave: { ...(settlement.leave?.toObject?.() ?? settlement.leave ?? {}), ...(payload.leave ?? {}) },
    extras: payload.extras ?? {},
    remarks: payload.remarks ?? settlement.remarks,
  };

  const priced = await priceSettlement({ employee, payload: merged, rules });
  const previousNet = settlement.netSettlement;

  Object.assign(settlement, toDocument({ employee, payload: merged, priced, rules, req }));
  await settlement.save();

  await recordAudit({
    req,
    entity: ENTITY,
    entityId: settlement._id,
    entityLabel: settlement.settlementNumber,
    action: AUDIT_ACTIONS.UPDATE,
    changes: [{ field: 'netSettlement', from: String(previousNet), to: String(settlement.netSettlement) }],
  });

  return Settlement.findById(settlement._id).populate(POPULATE);
};

/* -------------------------------------------------------------------------- */
/*                                  Workflow                                  */
/* -------------------------------------------------------------------------- */

const moveTo = async (settlement, next, req, { comment, stage, decision, extra = {} } = {}) => {
  const allowed = SETTLEMENT_STATUS_TRANSITIONS[settlement.status] ?? [];

  if (!allowed.includes(next)) {
    throw ApiError.badRequest(
      `A settlement that is ${settlement.status.toLowerCase().replace(/_/g, ' ')} cannot move to ${next.toLowerCase().replace(/_/g, ' ')}`,
      { from: settlement.status, allowed },
    );
  }

  const from = settlement.status;
  settlement.status = next;
  Object.assign(settlement, extra);

  if (stage) {
    settlement.approvals.push({
      stage,
      decision,
      by: req.user.id,
      byEmail: req.user.email,
      at: new Date(),
      comment: comment ?? null,
    });
  }

  settlement.updatedBy = req.user.id;
  await settlement.save();

  await recordAudit({
    req,
    entity: ENTITY,
    entityId: settlement._id,
    entityLabel: settlement.settlementNumber,
    action: AUDIT_ACTIONS.STATUS_CHANGE,
    changes: [{ field: 'status', from, to: next }],
    metadata: { comment, stage },
  });

  return settlement;
};

const load = async (settlementId, req) => {
  const settlement = await Settlement.findById(settlementId);
  if (!settlement) throw ApiError.notFound('Settlement not found');
  assertTenant(settlement, req);
  return settlement;
};

export const submitSettlement = async (settlementId, req) => {
  const settlement = await load(settlementId, req);
  await moveTo(settlement, SETTLEMENT_STATUS.PENDING_HR, req);
  return Settlement.findById(settlementId).populate(POPULATE);
};

/**
 * HR stage: confirms the exit facts -- dates, notice, and that company
 * property is accounted for.
 */
export const hrDecision = async (settlementId, { decision, comment }, req) => {
  const settlement = await load(settlementId, req);

  if (settlement.status !== SETTLEMENT_STATUS.PENDING_HR) {
    throw ApiError.badRequest('This settlement is not awaiting HR approval');
  }

  if (decision === 'RETURNED') {
    await moveTo(settlement, SETTLEMENT_STATUS.DRAFT, req, { comment, stage: 'HR', decision });
    return Settlement.findById(settlementId).populate(POPULATE);
  }

  // Unreturned kit is almost never recovered once the final payment has gone
  // out, so the sheet must either charge for it or record its return first.
  if (settlement.pendingAssetCount > 0) {
    const chargedForAssets = settlement.deductions.some((entry) => entry.code === 'ASSET_RECOVERY');
    if (!chargedForAssets) {
      throw ApiError.badRequest(
        `${settlement.pendingAssetCount} asset(s) are still held and not charged. Record their return, or set a recovery value and recalculate.`,
      );
    }
  }

  await moveTo(settlement, SETTLEMENT_STATUS.PENDING_FINANCE, req, {
    comment,
    stage: 'HR',
    decision: 'APPROVED',
    extra: { hrApprovedAt: new Date(), hrApprovedBy: req.user.id },
  });

  return Settlement.findById(settlementId).populate(POPULATE);
};

/** Finance stage: confirms the money. */
export const financeDecision = async (settlementId, { decision, comment }, req) => {
  const settlement = await load(settlementId, req);

  if (settlement.status !== SETTLEMENT_STATUS.PENDING_FINANCE) {
    throw ApiError.badRequest('This settlement is not awaiting finance approval');
  }

  if (decision === 'RETURNED') {
    await moveTo(settlement, SETTLEMENT_STATUS.PENDING_HR, req, { comment, stage: 'FINANCE', decision });
    return Settlement.findById(settlementId).populate(POPULATE);
  }

  // The same person cannot clear both gates: two approvals that are really one
  // signature are not two approvals.
  if (settlement.hrApprovedBy && String(settlement.hrApprovedBy) === String(req.user.id)) {
    throw ApiError.forbidden('You approved this settlement at the HR stage and cannot also approve it for finance');
  }

  await moveTo(settlement, SETTLEMENT_STATUS.APPROVED, req, {
    comment,
    stage: 'FINANCE',
    decision: 'APPROVED',
    extra: { financeApprovedAt: new Date(), financeApprovedBy: req.user.id },
  });

  return Settlement.findById(settlementId).populate(POPULATE);
};

/**
 * Records payment and closes the exit.
 *
 * Loans are written off against the settlement here rather than at approval,
 * because approval is a decision and this is the money actually moving.
 */
export const markSettlementPaid = async (settlementId, { paymentReference, paymentMode }, req) => {
  const settlement = await load(settlementId, req);

  await moveTo(settlement, SETTLEMENT_STATUS.PAID, req, {
    extra: {
      paidAt: new Date(),
      paidBy: req.user.id,
      paymentReference: paymentReference ?? null,
      paymentMode: paymentMode ?? null,
    },
  });

  // Every outstanding balance was charged on the sheet, so nothing remains to
  // recover from a person who no longer receives a payslip.
  const loanIds = [
    ...(settlement.loans ?? []).map((loan) => loan.loanId),
    ...(settlement.advances ?? []).map((advance) => advance.advanceId),
  ].filter(Boolean);

  if (loanIds.length) {
    await Loan.updateMany(
      { _id: { $in: loanIds } },
      {
        $set: {
          outstanding: 0,
          status: LOAN_STATUS.CLOSED,
          closedOn: new Date(),
        },
      },
    );
  }

  logger.info('Settlement paid', {
    settlementNumber: settlement.settlementNumber,
    net: settlement.netSettlement,
    loansClosed: loanIds.length,
  });

  return Settlement.findById(settlementId).populate(POPULATE);
};

export const holdSettlement = async (settlementId, { reason }, req) => {
  const settlement = await load(settlementId, req);
  await moveTo(settlement, SETTLEMENT_STATUS.ON_HOLD, req, {
    comment: reason,
    extra: { holdReason: reason },
  });

  return Settlement.findById(settlementId).populate(POPULATE);
};

export const releaseSettlement = async (settlementId, { toStatus }, req) => {
  const settlement = await load(settlementId, req);
  await moveTo(settlement, toStatus, req, { extra: { holdReason: null } });
  return Settlement.findById(settlementId).populate(POPULATE);
};

export const cancelSettlement = async (settlementId, { reason }, req) => {
  const settlement = await load(settlementId, req);
  await moveTo(settlement, SETTLEMENT_STATUS.CANCELLED, req, {
    comment: reason,
    extra: { cancelReason: reason },
  });

  return Settlement.findById(settlementId).populate(POPULATE);
};

/* -------------------------------------------------------------------------- */
/*                                    Reads                                   */
/* -------------------------------------------------------------------------- */

export const listSettlements = async (query, req) => {
  const { page, limit, skip } = buildPagination(query);
  const sort = buildSort(query, SORTABLE_FIELDS, { lastWorkingDate: -1 });

  const filter = { tenantId: req.user.tenantId ?? null };
  if (query.status) filter.status = query.status;
  if (query.trigger) filter.trigger = query.trigger;
  if (query.employeeId) filter.employeeId = query.employeeId;

  const range = dateRange(query.from, query.to);
  if (range) filter.lastWorkingDate = range;

  // A settlement exposes salary, severance and debts. The same scope that
  // guards payslips guards this.
  const scope = buildScopeFilter(req, {
    ownerField: '_id',
    managerField: 'reportingManagerId',
    departmentField: 'departmentId',
    resource: RESOURCES.PAYROLL,
  });

  if (scope._id !== undefined || scope.reportingManagerId !== undefined || scope.departmentId !== undefined) {
    const employees = await Employee.find({ ...scope, deletedAt: null }).select('_id').lean();
    filter.employeeId = { $in: employees.map((employee) => employee._id) };
  }

  const [items, total] = await Promise.all([
    Settlement.find(filter).sort(sort).skip(skip).limit(limit).populate(POPULATE).lean({ virtuals: true }),
    Settlement.countDocuments(filter),
  ]);

  return { items, total, page, limit };
};

export const getSettlement = async (settlementId, req) => {
  const settlement = await Settlement.findById(settlementId).populate(POPULATE);
  if (!settlement) throw ApiError.notFound('Settlement not found');
  assertTenant(settlement, req);

  const scope = buildScopeFilter(req, { ownerField: '_id', resource: RESOURCES.PAYROLL });
  if (
    scope._id !== undefined &&
    String(settlement.employeeId?._id ?? settlement.employeeId) !== String(scope._id)
  ) {
    throw ApiError.forbidden('You can only view your own settlement');
  }

  return settlement.toObject({ virtuals: true });
};

/* -------------------------------------------------------------------------- */
/*                                 Dashboard                                  */
/* -------------------------------------------------------------------------- */

/**
 * Exit-settlement dashboard.
 *
 * Ageing is the number that matters: a settlement sitting unpaid ninety days
 * after someone left is both a legal exposure and the most common source of
 * ex-employee escalation. Counts alone would hide that.
 */
export const dashboard = async (req) => {
  const tenantId = req.user.tenantId ?? null;

  const [byStatus, byTrigger, ageing, monthly, blocked] = await Promise.all([
    Settlement.aggregate([
      { $match: { tenantId } },
      { $group: { _id: '$status', count: { $sum: 1 }, value: { $sum: '$netSettlement' } } },
    ]),

    Settlement.aggregate([
      { $match: { tenantId } },
      { $group: { _id: '$trigger', count: { $sum: 1 } } },
    ]),

    Settlement.aggregate([
      {
        $match: {
          tenantId,
          status: {
            $in: [
              SETTLEMENT_STATUS.DRAFT,
              SETTLEMENT_STATUS.PENDING_HR,
              SETTLEMENT_STATUS.PENDING_FINANCE,
              SETTLEMENT_STATUS.APPROVED,
              SETTLEMENT_STATUS.ON_HOLD,
            ],
          },
        },
      },
      {
        $project: {
          netSettlement: 1,
          settlementNumber: 1,
          status: 1,
          ageDays: {
            $floor: { $divide: [{ $subtract: ['$$NOW', '$lastWorkingDate'] }, 86_400_000] },
          },
        },
      },
      {
        $bucket: {
          groupBy: '$ageDays',
          boundaries: AGEING_BOUNDARIES,
          default: '90+',
          output: { count: { $sum: 1 }, value: { $sum: '$netSettlement' } },
        },
      },
    ]),

    Settlement.aggregate([
      { $match: { tenantId, paidAt: { $ne: null } } },
      {
        $group: {
          _id: { year: { $year: '$paidAt' }, month: { $month: '$paidAt' } },
          count: { $sum: 1 },
          value: { $sum: '$netSettlement' },
        },
      },
      { $sort: { '_id.year': -1, '_id.month': -1 } },
      { $limit: 12 },
    ]),

    // Sitting in a queue with company property still out.
    Settlement.countDocuments({
      tenantId,
      pendingAssetCount: { $gt: 0 },
      status: { $in: [SETTLEMENT_STATUS.PENDING_HR, SETTLEMENT_STATUS.PENDING_FINANCE] },
    }),
  ]);

  const statusMap = Object.fromEntries(
    Object.values(SETTLEMENT_STATUS).map((status) => [status, { count: 0, value: 0 }]),
  );
  byStatus.forEach((row) => {
    statusMap[row._id] = { count: row.count, value: roundToCurrency(row.value) };
  });

  const pendingStatuses = [
    SETTLEMENT_STATUS.DRAFT,
    SETTLEMENT_STATUS.PENDING_HR,
    SETTLEMENT_STATUS.PENDING_FINANCE,
    SETTLEMENT_STATUS.APPROVED,
    SETTLEMENT_STATUS.ON_HOLD,
  ];

  return {
    byStatus: statusMap,
    totals: {
      open: pendingStatuses.reduce((sum, status) => sum + statusMap[status].count, 0),
      openValue: roundToCurrency(
        pendingStatuses.reduce((sum, status) => sum + statusMap[status].value, 0),
      ),
      paid: statusMap[SETTLEMENT_STATUS.PAID].count,
      paidValue: statusMap[SETTLEMENT_STATUS.PAID].value,
      awaitingHr: statusMap[SETTLEMENT_STATUS.PENDING_HR].count,
      awaitingFinance: statusMap[SETTLEMENT_STATUS.PENDING_FINANCE].count,
      blockedByAssets: blocked,
    },
    byTrigger: Object.fromEntries(byTrigger.map((row) => [row._id, row.count])),
    // Labels come from the same boundary list the $bucket stage uses, so the
    // two cannot drift apart.
    ageing: ageing.map((bucket) => ({
      bucket: AGEING_LABELS[bucket._id] ?? String(bucket._id),
      lowerBound: bucket._id,
      count: bucket.count,
      value: roundToCurrency(bucket.value),
    })),
    monthly: monthly
      .map((row) => ({
        year: row._id.year,
        month: row._id.month,
        count: row.count,
        value: roundToCurrency(row.value),
      }))
      .reverse(),
  };
};

export default {
  createSettlement,
  recalculateSettlement,
  submitSettlement,
  hrDecision,
  financeDecision,
  markSettlementPaid,
  holdSettlement,
  releaseSettlement,
  cancelSettlement,
  listSettlements,
  getSettlement,
  dashboard,
  SORTABLE_FIELDS,
};
