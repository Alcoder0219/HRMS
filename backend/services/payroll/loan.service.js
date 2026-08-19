import logger from '../../config/logger.js';
import ApiError from '../../utils/ApiError.js';
import { AUDIT_ACTIONS, LOAN_STATUS, RESOURCES } from '../../utils/constants.js';
import { buildPagination, buildSort } from '../../utils/queryBuilder.js';
import Loan from '../../models/payroll/loan.model.js';
import Employee from '../../models/employee/employee.model.js';
import payrollRepository from '../../repositories/payroll/payroll.repository.js';
import employeeRepository from '../../repositories/employee/employee.repository.js';
import { roundToCurrency } from '../../helpers/statutory.helper.js';
import { structureGross } from '../../models/payroll/salaryStructure.model.js';
import { recordAudit } from '../../helpers/audit.helper.js';
import { buildScopeFilter } from '../../helpers/permission.helper.js';

const ENTITY = 'Loan';

export const SORTABLE_FIELDS = ['createdAt', 'principal', 'outstanding', 'status', 'emi'];

/**
 * Loans and salary advances.
 *
 * One model serves both -- an advance is a short-tenure, interest-free loan,
 * and duplicating the schedule and recovery machinery for it would buy nothing.
 */

/**
 * Simple-interest EMI. Deliberately not reducing-balance: employee loans in
 * this context are almost always interest-free or flat-rate, and presenting a
 * reducing-balance figure would misstate what is actually deducted.
 */
export const calculateEmi = ({ principal, interestRate = 0, tenureMonths }) => {
  const total = Number(principal) * (1 + (Number(interestRate) || 0) / 100);
  const emi = Math.ceil(total / tenureMonths);

  return { totalPayable: roundToCurrency(total), emi };
};

/**
 * Materialises the repayment plan up front.
 *
 * The last instalment absorbs the rounding remainder, so the schedule always
 * sums exactly to the amount payable -- otherwise the final month either
 * over-recovers by a few rupees or leaves a residue that never closes.
 */
const buildSchedule = ({ totalPayable, emi, tenureMonths, startYear, startMonth }) => {
  const instalments = [];
  let remaining = totalPayable;

  for (let index = 0; index < tenureMonths; index += 1) {
    const monthOffset = startMonth - 1 + index;
    const dueYear = startYear + Math.floor(monthOffset / 12);
    const dueMonth = (monthOffset % 12) + 1;

    const amount = index === tenureMonths - 1 ? roundToCurrency(remaining) : Math.min(emi, remaining);
    remaining = roundToCurrency(remaining - amount);

    instalments.push({ sequence: index + 1, dueYear, dueMonth, amount, status: 'PENDING' });
  }

  return instalments;
};

const nextLoanNumber = async (tenantId) => {
  const latest = await Loan.findOne({ tenantId: tenantId ?? null, loanNumber: /^LN\d+$/ })
    .sort({ loanNumber: -1 })
    .select('loanNumber')
    .lean();

  const current = latest ? Number(latest.loanNumber.slice(2)) : 0;
  return `LN${String(current + 1).padStart(6, '0')}`;
};

export const createLoan = async (payload, req) => {
  const employee = await employeeRepository.findById(payload.employeeId, { populate: false });
  if (!employee) throw ApiError.notFound('Employee not found');

  const callerTenant = req.user.tenantId ?? null;
  if (callerTenant !== null && String(employee.tenantId ?? null) !== callerTenant) {
    throw ApiError.notFound('Employee not found');
  }

  const { totalPayable, emi } = calculateEmi(payload);

  // A structure is required so the EMI can be sanity-checked against pay --
  // and because a loan against an unpaid employee cannot be recovered.
  const structure = await payrollRepository.findStructureOn(employee._id, new Date());
  if (!structure) {
    throw ApiError.badRequest('This employee has no salary structure, so recovery cannot be scheduled');
  }

  // A guard rail, not a policy engine: an EMI above half of gross leaves
  // nothing to live on and will simply fail to recover month after month.
  const monthlyGross = structureGross(structure);
  if (emi > monthlyGross * 0.5) {
    throw ApiError.badRequest(
      `The EMI of ${emi} exceeds half of monthly gross (${roundToCurrency(monthlyGross)}). Extend the tenure or reduce the principal.`,
    );
  }

  const instalments = buildSchedule({
    totalPayable,
    emi,
    tenureMonths: payload.tenureMonths,
    startYear: payload.recoveryStartYear,
    startMonth: payload.recoveryStartMonth,
  });

  const loan = await payrollRepository.createLoan({
    ...payload,
    tenantId: employee.tenantId ?? null,
    employeeId: employee._id,
    loanNumber: await nextLoanNumber(employee.tenantId),
    totalPayable,
    emi,
    outstanding: totalPayable,
    instalments,
    status: LOAN_STATUS.PENDING,
    createdBy: req.user.id,
  });

  await recordAudit({
    req,
    entity: ENTITY,
    entityId: loan._id,
    entityLabel: `${loan.loanNumber} · ${employee.employeeCode}`,
    action: AUDIT_ACTIONS.CREATE,
    metadata: { principal: loan.principal, emi: loan.emi, tenureMonths: loan.tenureMonths },
  });

  logger.info('Loan created', { loanNumber: loan.loanNumber, principal: loan.principal });

  return loan;
};

export const decideLoan = async (loanId, { decision, reason }, req) => {
  const loan = await payrollRepository.findLoanById(loanId);
  if (!loan) throw ApiError.notFound('Loan not found');

  if (loan.status !== LOAN_STATUS.PENDING) {
    throw ApiError.badRequest(`This loan is already ${loan.status.toLowerCase()}`);
  }

  const approved = decision === 'APPROVED';

  const updated = await payrollRepository.updateLoan(loanId, {
    $set: {
      status: approved ? LOAN_STATUS.APPROVED : LOAN_STATUS.REJECTED,
      approvedBy: req.user.id,
      approvedAt: new Date(),
      rejectionReason: approved ? null : reason,
    },
  });

  await recordAudit({
    req,
    entity: ENTITY,
    entityId: loanId,
    action: AUDIT_ACTIONS.STATUS_CHANGE,
    changes: [{ field: 'status', from: LOAN_STATUS.PENDING, to: updated.status }],
    metadata: { reason },
  });

  return updated;
};

/**
 * Marks the money as paid out. Recovery only begins after this -- an approved
 * but undisbursed loan must never appear as a deduction.
 */
export const disburseLoan = async (loanId, { disbursedOn }, req) => {
  const loan = await payrollRepository.findLoanById(loanId);
  if (!loan) throw ApiError.notFound('Loan not found');

  if (loan.status !== LOAN_STATUS.APPROVED) {
    throw ApiError.badRequest('Only an approved loan can be disbursed');
  }

  const updated = await payrollRepository.updateLoan(loanId, {
    $set: {
      status: LOAN_STATUS.DISBURSED,
      disbursedOn: disbursedOn ? new Date(disbursedOn) : new Date(),
    },
  });

  await recordAudit({
    req,
    entity: ENTITY,
    entityId: loanId,
    action: AUDIT_ACTIONS.STATUS_CHANGE,
    changes: [{ field: 'status', from: LOAN_STATUS.APPROVED, to: LOAN_STATUS.DISBURSED }],
  });

  return updated;
};

/** Pauses or resumes recovery without closing the loan. */
export const setLoanHold = async (loanId, { hold, reason }, req) => {
  const loan = await payrollRepository.findLoanById(loanId);
  if (!loan) throw ApiError.notFound('Loan not found');

  const updated = await payrollRepository.updateLoan(loanId, {
    $set: { isOnHold: hold, holdReason: hold ? reason : null },
  });

  await recordAudit({
    req,
    entity: ENTITY,
    entityId: loanId,
    action: AUDIT_ACTIONS.UPDATE,
    changes: [{ field: 'isOnHold', from: String(loan.isOnHold), to: String(hold) }],
    metadata: { reason },
  });

  return updated;
};

/** Early settlement outside payroll -- a cash repayment, or a write-off. */
export const recordManualRepayment = async (loanId, { amount, note }, req) => {
  const loan = await payrollRepository.findLoanById(loanId);
  if (!loan) throw ApiError.notFound('Loan not found');

  if (amount > loan.outstanding) {
    throw ApiError.badRequest(`The repayment exceeds the outstanding balance of ${loan.outstanding}`);
  }

  const updated = await payrollRepository.updateLoan(loanId, {
    $inc: { outstanding: -amount, recoveredAmount: amount },
  });

  if (updated.outstanding <= 0) {
    await payrollRepository.updateLoan(loanId, {
      $set: { status: LOAN_STATUS.CLOSED, closedOn: new Date(), outstanding: 0 },
    });
  }

  await recordAudit({
    req,
    entity: ENTITY,
    entityId: loanId,
    action: AUDIT_ACTIONS.UPDATE,
    changes: [{ field: 'outstanding', from: String(loan.outstanding), to: String(updated.outstanding) }],
    metadata: { manualRepayment: amount, note },
  });

  return payrollRepository.findLoanById(loanId);
};

export const listLoans = async (query, req) => {
  const { page, limit, skip } = buildPagination(query);
  const sort = buildSort(query, SORTABLE_FIELDS, { createdAt: -1 });

  const filter = { tenantId: req.user.tenantId ?? null };
  if (query.status) filter.status = query.status;
  if (query.type) filter.type = query.type;
  if (query.employeeId) filter.employeeId = query.employeeId;

  // A loan reveals financial circumstances, so the same scope that guards
  // payslips guards this listing.
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

  const { items, total } = await payrollRepository.listLoans({ filter, sort, skip, limit });
  return { items, total, page, limit };
};

export const getLoan = async (loanId, req) => {
  const loan = await payrollRepository.findLoanById(loanId);
  if (!loan) throw ApiError.notFound('Loan not found');

  const callerTenant = req.user.tenantId ?? null;
  if (callerTenant !== null && String(loan.tenantId) !== callerTenant) {
    throw ApiError.notFound('Loan not found');
  }

  return loan.toObject({ virtuals: true });
};

export default {
  createLoan,
  decideLoan,
  disburseLoan,
  setLoanHold,
  recordManualRepayment,
  listLoans,
  getLoan,
  calculateEmi,
  SORTABLE_FIELDS,
};
