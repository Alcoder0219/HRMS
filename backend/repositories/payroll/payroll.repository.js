import SalaryStructure from '../../models/payroll/salaryStructure.model.js';
import PayrollRun from '../../models/payroll/payrollRun.model.js';
import Payslip from '../../models/payroll/payslip.model.js';
import Loan from '../../models/payroll/loan.model.js';
import PayrollSettings from '../../models/payroll/payrollSettings.model.js';
import { LOAN_STATUS, PAYSLIP_STATUS } from '../../utils/constants.js';

/* -------------------------------------------------------------------------- */
/*                             Salary structures                              */
/* -------------------------------------------------------------------------- */

/**
 * The structure in force on a date.
 *
 * Latest `effectiveFrom` not after the date. Reading the "current" row instead
 * would re-price historical runs the moment someone gets a raise.
 */
export const findStructureOn = (employeeId, date) =>
  SalaryStructure.findOne({
    employeeId,
    isActive: true,
    effectiveFrom: { $lte: date },
  })
    .sort({ effectiveFrom: -1 })
    .lean();

/** Bulk variant for a payroll run -- one query instead of one per employee. */
export const findStructuresOn = async (employeeIds, date) => {
  const rows = await SalaryStructure.find({
    employeeId: { $in: employeeIds },
    isActive: true,
    effectiveFrom: { $lte: date },
  })
    .sort({ employeeId: 1, effectiveFrom: -1 })
    .lean();

  // Sorted descending by date, so the first row seen per employee is the one
  // in force.
  const byEmployee = new Map();
  rows.forEach((row) => {
    const key = String(row.employeeId);
    if (!byEmployee.has(key)) byEmployee.set(key, row);
  });

  return byEmployee;
};

export const findStructureHistory = (employeeId) =>
  SalaryStructure.find({ employeeId }).sort({ effectiveFrom: -1 }).lean();

export const createStructure = (payload) => SalaryStructure.create(payload);

/**
 * Closes the open-ended revision that precedes a new one, so exactly one
 * structure is in force at any instant.
 */
export const closePreviousStructure = (employeeId, effectiveFrom) =>
  SalaryStructure.updateMany(
    { employeeId, effectiveTo: null, effectiveFrom: { $lt: effectiveFrom } },
    { $set: { effectiveTo: new Date(effectiveFrom.getTime() - 1) } },
  );

export const findStructureById = (id) => SalaryStructure.findById(id);

/* -------------------------------------------------------------------------- */
/*                                    Runs                                    */
/* -------------------------------------------------------------------------- */

export const findRun = (tenantId, year, month) =>
  PayrollRun.findOne({ tenantId: tenantId ?? null, year, month });

export const findRunById = (id) => PayrollRun.findById(id);

export const upsertRun = (tenantId, year, month, payload) =>
  PayrollRun.findOneAndUpdate(
    { tenantId: tenantId ?? null, year, month },
    { $set: payload, $setOnInsert: { tenantId: tenantId ?? null, year, month } },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
  );

export const updateRun = (id, update) =>
  PayrollRun.findByIdAndUpdate(id, update, { new: true, runValidators: true });

export const listRuns = async ({ filter, sort, skip, limit }) => {
  const [items, total] = await Promise.all([
    PayrollRun.find(filter).sort(sort).skip(skip).limit(limit).lean({ virtuals: true }),
    PayrollRun.countDocuments(filter),
  ]);

  return { items, total };
};

/* -------------------------------------------------------------------------- */
/*                                  Payslips                                  */
/* -------------------------------------------------------------------------- */

export const upsertPayslip = (payrollRunId, employeeId, payload) =>
  Payslip.findOneAndUpdate(
    { payrollRunId, employeeId },
    { $set: payload },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
  );

export const findPayslipById = (id) =>
  Payslip.findById(id).populate({ path: 'employeeId', select: 'employeeCode employeeId firstName lastName bankDetails' });

export const findPayslipsForRun = (payrollRunId, extra = {}) =>
  Payslip.find({ payrollRunId, ...extra }).sort({ 'employeeSnapshot.employeeCode': 1 }).lean();

export const listPayslips = async ({ filter, sort, skip, limit }) => {
  const [items, total] = await Promise.all([
    Payslip.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    Payslip.countDocuments(filter),
  ]);

  return { items, total };
};

export const updatePayslip = (id, update) =>
  Payslip.findByIdAndUpdate(id, update, { new: true, runValidators: true });

export const publishPayslips = (payrollRunId) =>
  Payslip.updateMany(
    { payrollRunId, status: { $ne: PAYSLIP_STATUS.ON_HOLD } },
    { $set: { status: PAYSLIP_STATUS.PUBLISHED, publishedAt: new Date() } },
  );

export const deletePayslipsForRun = (payrollRunId) => Payslip.deleteMany({ payrollRunId });

/**
 * Year-to-date figures up to (not including) the given month.
 *
 * Feeds the TDS projection and the payslip's YTD block. Excluding the current
 * month is deliberate -- it is the month being computed.
 */
export const yearToDate = async (employeeId, financialYearStart, year, month) => {
  /**
   * Months are compared as a single ordinal (`year * 12 + month`) so a
   * financial year that straddles a calendar boundary -- April to March -- is
   * one range test rather than a compound year/month condition that is easy to
   * get subtly wrong at the boundary.
   */
  const ordinal = { $add: [{ $multiply: ['$year', 12] }, '$month'] };
  const fromOrdinal = financialYearStart.year * 12 + financialYearStart.month;
  const toOrdinal = year * 12 + month; // exclusive: this is the month being priced

  const withinFinancialYear = {
    employeeId,
    $expr: { $and: [{ $gte: [ordinal, fromOrdinal] }, { $lt: [ordinal, toOrdinal] }] },
  };

  const rows = await Payslip.aggregate([
    { $match: withinFinancialYear },
    {
      $group: {
        _id: null,
        gross: { $sum: '$grossEarnings' },
        deductions: { $sum: '$totalDeductions' },
        net: { $sum: '$netPayable' },
        months: { $sum: 1 },
      },
    },
  ]);

  const totals = rows[0] ?? { gross: 0, deductions: 0, net: 0, months: 0 };

  // PF and TDS are components, so they are summed from the arrays rather than
  // stored as top-level fields.
  const componentTotals = await Payslip.aggregate([
    { $match: withinFinancialYear },
    { $unwind: '$deductions' },
    { $group: { _id: '$deductions.code', total: { $sum: '$deductions.amount' } } },
  ]);

  const byCode = Object.fromEntries(componentTotals.map((row) => [row._id, row.total]));

  return {
    gross: totals.gross ?? 0,
    deductions: totals.deductions ?? 0,
    net: totals.net ?? 0,
    months: totals.months ?? 0,
    pf: byCode.PF ?? 0,
    tds: byCode.TDS ?? 0,
  };
};

/* -------------------------------------------------------------------------- */
/*                                   Loans                                    */
/* -------------------------------------------------------------------------- */

export const findRecoverableLoans = (employeeIds) =>
  Loan.find({
    employeeId: { $in: employeeIds },
    status: { $in: [LOAN_STATUS.DISBURSED, LOAN_STATUS.ACTIVE] },
    isOnHold: false,
    outstanding: { $gt: 0 },
  }).lean();

export const findLoanById = (id) => Loan.findById(id);

export const createLoan = (payload) => Loan.create(payload);

export const updateLoan = (id, update) =>
  Loan.findByIdAndUpdate(id, update, { new: true, runValidators: true });

export const listLoans = async ({ filter, sort, skip, limit }) => {
  const [items, total] = await Promise.all([
    Loan.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate({ path: 'employeeId', select: 'employeeCode employeeId firstName lastName' })
      .lean({ virtuals: true }),
    Loan.countDocuments(filter),
  ]);

  return { items, total };
};

/**
 * Applies one month's recovery atomically.
 *
 * `$inc` rather than read-modify-write: two concurrent runs against the same
 * loan must not both read the same opening balance and each write it down by
 * one EMI.
 */
export const recordLoanRecovery = (loanId, amount, { year, month, payslipId }) =>
  Loan.findOneAndUpdate(
    { _id: loanId, outstanding: { $gte: 0 } },
    {
      $inc: { outstanding: -amount, recoveredAmount: amount },
      $set: {
        status: LOAN_STATUS.ACTIVE,
        'instalments.$[target].paidAmount': amount,
        'instalments.$[target].paidOn': new Date(),
        'instalments.$[target].payslipId': payslipId,
        'instalments.$[target].status': 'PAID',
      },
    },
    {
      new: true,
      arrayFilters: [{ 'target.dueYear': year, 'target.dueMonth': month }],
    },
  );

export const closeSettledLoans = () =>
  Loan.updateMany(
    { outstanding: { $lte: 0 }, status: { $in: [LOAN_STATUS.DISBURSED, LOAN_STATUS.ACTIVE] } },
    { $set: { status: LOAN_STATUS.CLOSED, closedOn: new Date(), outstanding: 0 } },
  );

/* -------------------------------------------------------------------------- */
/*                                  Settings                                  */
/* -------------------------------------------------------------------------- */

export const findSettings = (tenantId) => PayrollSettings.findOne({ tenantId: tenantId ?? null }).lean();

/**
 * Flattens nested objects into dot-notation paths.
 *
 * `$set: { pf: { wageCeiling: 21000 } }` REPLACES the whole `pf` sub-document,
 * silently discarding every sibling field -- including `pf.enabled`, which
 * would switch provident fund off for the entire organisation on what looked
 * like a one-field edit. Flattening to `{ 'pf.wageCeiling': 21000 }` changes
 * only the leaf that was sent.
 *
 * Arrays are treated as leaves: a slab table is replaced as a unit, because
 * merging it index by index would leave stale slabs behind when the new table
 * is shorter.
 */
export const flattenForUpdate = (payload, prefix = '') => {
  const flat = {};

  for (const [key, value] of Object.entries(payload ?? {})) {
    const path = prefix ? `${prefix}.${key}` : key;

    if (value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      Object.assign(flat, flattenForUpdate(value, path));
    } else {
      flat[path] = value;
    }
  }

  return flat;
};

export const upsertSettings = (tenantId, payload) =>
  PayrollSettings.findOneAndUpdate(
    { tenantId: tenantId ?? null },
    { $set: flattenForUpdate(payload), $setOnInsert: { tenantId: tenantId ?? null } },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
  );

export default {
  findStructureOn,
  findStructuresOn,
  findStructureHistory,
  findStructureById,
  createStructure,
  closePreviousStructure,
  findRun,
  findRunById,
  upsertRun,
  updateRun,
  listRuns,
  upsertPayslip,
  findPayslipById,
  findPayslipsForRun,
  listPayslips,
  updatePayslip,
  publishPayslips,
  deletePayslipsForRun,
  yearToDate,
  findRecoverableLoans,
  findLoanById,
  createLoan,
  updateLoan,
  listLoans,
  recordLoanRecovery,
  closeSettledLoans,
  findSettings,
  upsertSettings,
  flattenForUpdate,
};
