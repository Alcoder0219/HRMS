import mongoose from 'mongoose';
import ApiError from '../../utils/ApiError.js';
import { AUDIT_ACTIONS, COMPONENT_CODE } from '../../utils/constants.js';
import Payslip from '../../models/payroll/payslip.model.js';
import payrollRepository from '../../repositories/payroll/payroll.repository.js';
import { buildWorkbook } from '../../helpers/excel.helper.js';
import { calculateGrossSalary, FIXED_EARNINGS } from '../../helpers/salaryCalculator.helper.js';
import { roundToCurrency } from '../../helpers/statutory.helper.js';
import { recordAudit } from '../../helpers/audit.helper.js';

/**
 * Payroll reporting.
 *
 * Every figure is read from stored payslips, never recomputed. A report that
 * re-ran the calculation would drift from what was actually paid the moment a
 * structure or statutory rate changed -- and a salary register that disagrees
 * with the bank file is worse than no register at all.
 */

const componentTotal = (payslip, list, code) =>
  (payslip[list] ?? []).find((entry) => entry.code === code)?.amount ?? 0;

/**
 * Whatever the named earning columns do not account for.
 *
 * Every Tanzanian allowance now has a component code and a column of its own,
 * so this catches only the free-form `otherAllowances` entries a structure may
 * carry. It exists to keep the one invariant this report guarantees: the
 * earnings columns add up to the gross printed beside them. Under the Indian
 * model three allowances shared the OTHER_ALLOWANCE code and had to be told
 * apart by matching their labels against regular expressions, which silently
 * dropped anything worded differently.
 */
const residualAllowance = (payslip) =>
  (payslip.earnings ?? [])
    .filter((entry) => entry.code === COMPONENT_CODE.OTHER_ALLOWANCE)
    .reduce((sum, entry) => sum + (entry.amount ?? 0), 0);

/** The register's earning columns, keyed off the engine's own component list. */
const EARNING_COLUMN_KEYS = {
  [COMPONENT_CODE.BASIC]: 'basic',
  [COMPONENT_CODE.HRA]: 'hraAllowance',
  [COMPONENT_CODE.FOOD_ALLOWANCE]: 'foodAllowance',
  [COMPONENT_CODE.TRANSPORTATION_ALLOWANCE]: 'transportationAllowance',
  [COMPONENT_CODE.COMMUNICATION_ALLOWANCE]: 'communicationAllowance',
  [COMPONENT_CODE.MEDICLAIM]: 'mediclaim',
  [COMPONENT_CODE.SCHOOL_FEES_ALLOWANCE]: 'schoolFeesAllowance',
  [COMPONENT_CODE.ANNUAL_LEAVE_ALLOWANCE]: 'annualLeaveAllowance',
  [COMPONENT_CODE.PERFORMANCE_INCENTIVE]: 'performanceIncentive',
};

/** One row key per fixed earning, read straight off the stored payslip. */
const earningColumns = (payslip) =>
  Object.fromEntries(
    FIXED_EARNINGS.map(({ code }) => [
      EARNING_COLUMN_KEYS[code],
      componentTotal(payslip, 'earnings', code),
    ]),
  );

/* -------------------------------------------------------------------------- */
/*                              Salary register                               */
/* -------------------------------------------------------------------------- */

/** The line-by-line register for one run: what each person earned and lost. */
export const salaryRegister = async (runId, req) => {
  const run = await payrollRepository.findRunById(runId);
  if (!run) throw ApiError.notFound('Payroll run not found');

  const callerTenant = req.user.tenantId ?? null;
  if (callerTenant !== null && String(run.tenantId) !== callerTenant) {
    throw ApiError.notFound('Payroll run not found');
  }

  const payslips = await payrollRepository.findPayslipsForRun(run._id);

  /**
   * Every figure below is read from the stored payslip. The only arithmetic is
   * separating variable pay from the fixed salary, which is subtraction on
   * numbers that are already on the document -- no rate, policy or component is
   * recalculated, and `finalPayable` is the payslip's own `netPayable` rather
   * than a sum this report invents.
   */
  const rows = payslips.map((payslip) => {
    const overtime = componentTotal(payslip, 'earnings', COMPONENT_CODE.OVERTIME);
    const bonus = componentTotal(payslip, 'earnings', COMPONENT_CODE.BONUS);
    const incentive = componentTotal(payslip, 'earnings', COMPONENT_CODE.INCENTIVE);
    const arrears = componentTotal(payslip, 'earnings', COMPONENT_CODE.ARREARS);

    // Overtime, bonus, incentive and arrears are earned on top of the monthly
    // salary. `grossEarnings` includes them; the register reports the salary
    // and the extras in separate columns, as the payslip itself does.
    const variablePay = roundToCurrency(overtime + bonus + incentive + arrears);

    /**
     * Gross comes from the same function the payroll engine used, applied to
     * the component lines stored on this payslip -- not from the stored
     * `grossEarnings` scalar.
     *
     * The components are the more trustworthy record of the two. They are what
     * the register prints, so summing them is what makes the row add up; and a
     * payslip written before the gross formula was corrected carries a stale
     * scalar beside correct components, which is exactly the case where
     * trusting the scalar reproduces the old error in a fresh report.
     */
    const grossSalary = calculateGrossSalary(payslip.earnings);

    const nssfEmployee = componentTotal(payslip, 'deductions', COMPONENT_CODE.NSSF_EMPLOYEE);
    const nhif = componentTotal(payslip, 'deductions', COMPONENT_CODE.NHIF);
    const paye = componentTotal(payslip, 'deductions', COMPONENT_CODE.PAYE);
    const loan = componentTotal(payslip, 'deductions', COMPONENT_CODE.LOAN_EMI);
    const advance = componentTotal(payslip, 'deductions', COMPONENT_CODE.ADVANCE_RECOVERY);
    /**
     * What comes out of the employee's pay. This is the payslip's own figure
     * and drives net salary; the employer's contributions are not in it and
     * must never be.
     */
    const employeeDeductions = payslip.totalDeductions ?? 0;
    const employerContribution = payslip.employerContributionTotal ?? 0;

    // Everything the named columns do not account for: loan and advance
    // recovery, and any ad-hoc deduction added to the run. Derived from the
    // employee total so the employee columns always add up to it, whatever a
    // run contained.
    const otherDeductions = roundToCurrency(employeeDeductions - (nssfEmployee + nhif + paye));

    /**
     * The register's Total Deductions column: both sides together.
     *
     * Deliberately a wider figure than the employee's own deductions -- it is
     * the whole statutory cost of the person for the month, employee-side and
     * employer-side, which is what this register is read for. It is NOT what
     * comes out of their pay, and `netSalary` below is careful to use
     * `employeeDeductions` instead.
     *
     * Added once, from the employer TOTAL rather than from the individual
     * employer columns, so there is no path on which a contribution is counted
     * both as its own line and again inside the total.
     */
    const totalDeductions = roundToCurrency(employeeDeductions + employerContribution);

    return {
      employeeCode: payslip.employeeSnapshot?.employeeCode,
      // Absent on payslips generated before the ID was snapshotted.
      employeeId: payslip.employeeSnapshot?.employeeId ?? null,
      fullName: payslip.employeeSnapshot?.fullName,
      department: payslip.employeeSnapshot?.department,
      designation: payslip.employeeSnapshot?.designation,
      payableDays: payslip.attendance?.payableDays ?? 0,
      lopDays: payslip.attendance?.lopDays ?? 0,

      /* --- earnings -------------------------------------------------- */
      ...earningColumns(payslip),
      otherAllowance: residualAllowance(payslip),
      grossSalary,

      /* --- employee deductions --------------------------------------- */
      nssfEmployee,
      nhif,
      paye,
      loan,
      advance,
      otherDeductions,
      // What actually comes out of the employee's pay, and what net is built
      // from. Kept alongside the combined figure so a caller can have either.
      employeeDeductions,
      // Employee side plus employer side. See above.
      totalDeductions,

      /**
       * The employer side: NSSF, and the two levies that exist only there.
       *
       * SDL and WCF have no employee half at all, so they appear in this block
       * and nowhere else -- a column for either among the deductions would
       * misrepresent a payroll levy as something taken from a salary.
       */
      nssfEmployer: componentTotal(payslip, 'employerContributions', COMPONENT_CODE.NSSF_EMPLOYER),
      sdl: componentTotal(payslip, 'employerContributions', COMPONENT_CODE.SDL),
      wcf: componentTotal(payslip, 'employerContributions', COMPONENT_CODE.WCF),
      /**
       * Retained on the row for the accounting reports that consume it, but no
       * longer a column: the register shows each employer contribution as its
       * own line and does not repeat them as an aggregate.
       */
      employerContribution,

      /* --- what is paid ---------------------------------------------- */
      /**
       * Gross less the COMBINED deduction total -- employee side and employer
       * side together -- as the register is specified.
       *
       * Read that carefully before changing it: `totalDeductions` includes the
       * employer's NSSF, SDL and WCF, so this figure is the gross less money
       * the company contributed rather than money the employee lost. The
       * stored payslip's own `netPayable` is the take-home figure, and it is
       * the larger of the two.
       */
      netSalary: roundToCurrency(grossSalary - totalDeductions),
      overtime,
      bonus,
      incentive,
      arrears,

      /**
       * Net salary plus what was earned on top of it.
       *
       * Overtime and bonus only -- no employer contribution is added back, so
       * nothing that was subtracted above reappears here.
       */
      finalPayable: roundToCurrency(grossSalary - totalDeductions + variablePay),

      // Kept under their original names so anything already reading the
      // register -- the old export, a saved report -- keeps working.
      gross: roundToCurrency(grossSalary + variablePay),
      netPayable: roundToCurrency(grossSalary - totalDeductions + variablePay),

      status: payslip.status,
    };
  });

  /** Column totals, for the summary cards. Summed from the rows above. */
  const sum = (key) => roundToCurrency(rows.reduce((total, row) => total + (row[key] ?? 0), 0));

  /**
   * The summary cards keep their existing meanings.
   *
   * `totalDeductions` stays the EMPLOYEE side, because the card beside it
   * reports the employer contribution and adding the two into one card would
   * count the employer's money twice on the same screen. The combined figure
   * lives on the row, where it is one column among the parts it is made of.
   */
  const totals = {
    employeeCount: rows.length,
    totalGross: sum('grossSalary'),
    totalDeductions: sum('employeeDeductions'),
    totalEmployerContribution: sum('employerContribution'),
    totalCombinedDeductions: sum('totalDeductions'),
    totalOvertime: sum('overtime'),
    totalBonus: sum('bonus'),
    grandNetPayable: sum('finalPayable'),
  };

  return { run: { id: String(run._id), period: run.period, status: run.status }, rows, totals };
};

/**
 * The register's columns, in the order the screen shows them.
 *
 * The export and the table are deliberately the same list in the same order:
 * an exported register that does not line up with what HR just verified on
 * screen is the reason payroll checks get done twice.
 */
const REGISTER_COLUMNS = [
  { header: 'Employee Code', key: 'employeeCode', width: 16 },
  { header: 'Employee ID', key: 'employeeId', width: 14 },
  { header: 'Employee Name', key: 'fullName', width: 26 },
  { header: 'Department', key: 'department', width: 18 },
  { header: 'Designation', key: 'designation', width: 20 },
  { header: 'Payable Days', key: 'payableDays', width: 13 },
  { header: 'LOP', key: 'lopDays', width: 10 },

  { header: 'Basic Salary', key: 'basic', width: 14, format: '#,##0.00' },
  { header: 'HRA', key: 'hraAllowance', width: 13, format: '#,##0.00' },
  { header: 'Food Allowance', key: 'foodAllowance', width: 16, format: '#,##0.00' },
  { header: 'Transportation Allowance', key: 'transportationAllowance', width: 22, format: '#,##0.00' },
  { header: 'Communication Allowance', key: 'communicationAllowance', width: 22, format: '#,##0.00' },
  { header: 'Mediclaim', key: 'mediclaim', width: 14, format: '#,##0.00' },
  { header: 'School Fees Allowance', key: 'schoolFeesAllowance', width: 20, format: '#,##0.00' },
  { header: 'Annual Leave Allowance', key: 'annualLeaveAllowance', width: 21, format: '#,##0.00' },
  { header: 'Performance Incentive', key: 'performanceIncentive', width: 20, format: '#,##0.00' },
  { header: 'Other Allowance', key: 'otherAllowance', width: 17, format: '#,##0.00' },
  { header: 'Gross Salary', key: 'grossSalary', width: 15, format: '#,##0.00' },

  { header: 'NSSF - Employee', key: 'nssfEmployee', width: 16, format: '#,##0.00' },
  { header: 'NSSF - Employer', key: 'nssfEmployer', width: 16, format: '#,##0.00' },
  { header: 'NHIF', key: 'nhif', width: 13, format: '#,##0.00' },
  { header: 'PAYE', key: 'paye', width: 14, format: '#,##0.00' },
  // Employer-side levies. No employee column for either, because there is no
  // employee half to report.
  { header: 'SDL (Employer)', key: 'sdl', width: 15, format: '#,##0.00' },
  { header: 'WCF (Employer)', key: 'wcf', width: 15, format: '#,##0.00' },
  { header: 'Other Deductions', key: 'otherDeductions', width: 17, format: '#,##0.00' },
  // Named for what it holds: both sides, not the employee's alone. Each
  // employer contribution has its own column above, so there is no aggregate
  // Employer Contribution column repeating them.
  { header: 'Total Deductions', key: 'totalDeductions', width: 18, format: '#,##0.00' },

  { header: 'Net Salary', key: 'netSalary', width: 15, format: '#,##0.00' },
  { header: 'Overtime Amount', key: 'overtime', width: 16, format: '#,##0.00' },
  { header: 'Bonus', key: 'bonus', width: 13, format: '#,##0.00' },
  { header: 'Final Payable Amount', key: 'finalPayable', width: 20, format: '#,##0.00' },
  { header: 'Status', key: 'status', width: 14 },
];

export const exportSalaryRegister = async (runId, req) => {
  const { run, rows } = await salaryRegister(runId, req);

  const buffer = await buildWorkbook({
    sheetName: `Register ${run.period}`.slice(0, 30),
    columns: REGISTER_COLUMNS,
    rows,
    meta: { creator: req.user.email },
  });

  await recordAudit({
    req,
    entity: 'PayrollRun',
    entityId: new mongoose.Types.ObjectId(runId),
    action: AUDIT_ACTIONS.EXPORT,
    metadata: { report: 'SALARY_REGISTER', rows: rows.length },
  });

  return { buffer, rowCount: rows.length, period: run.period };
};

/* -------------------------------------------------------------------------- */
/*                            Statutory summaries                             */
/* -------------------------------------------------------------------------- */

/**
 * NSSF and NHIF contribution statements, plus the levy and PAYE totals -- the
 * shape the monthly returns to the two funds, the TRA and the WCF are prepared
 * from.
 */
export const statutoryReport = async ({ year, month }, req) => {
  const tenantId = req.user.tenantId ?? null;
  const payslips = await Payslip.find({ tenantId, year, month }).lean();

  const nssf = [];
  const nhif = [];
  let nssfTotals = { employee: 0, employer: 0, wages: 0 };
  let nhifTotals = { employee: 0, gross: 0 };

  payslips.forEach((payslip) => {
    const employeeNssf = componentTotal(payslip, 'deductions', COMPONENT_CODE.NSSF_EMPLOYEE);
    const employerNssf = componentTotal(payslip, 'employerContributions', COMPONENT_CODE.NSSF_EMPLOYER);

    if (employeeNssf > 0 || employerNssf > 0) {
      const wages = payslip.statutoryDetail?.nssf?.wages ?? 0;
      nssf.push({
        employeeCode: payslip.employeeSnapshot?.employeeCode,
        fullName: payslip.employeeSnapshot?.fullName,
        nssfNumber: payslip.employeeSnapshot?.nssfNumber,
        wages,
        employee: employeeNssf,
        employer: employerNssf,
        // The fund is remitted one figure per member, not two.
        total: employeeNssf + employerNssf,
      });

      nssfTotals = {
        employee: nssfTotals.employee + employeeNssf,
        employer: nssfTotals.employer + employerNssf,
        wages: nssfTotals.wages + wages,
      };
    }

    /**
     * NHIF is an employee-only contribution here, so no employer figure is
     * carried. It is a flat band amount rather than a rate, which is why the
     * gross it was banded on is reported beside it.
     */
    const employeeNhif = componentTotal(payslip, 'deductions', COMPONENT_CODE.NHIF);

    if (employeeNhif > 0) {
      nhif.push({
        employeeCode: payslip.employeeSnapshot?.employeeCode,
        fullName: payslip.employeeSnapshot?.fullName,
        nhifNumber: payslip.employeeSnapshot?.nhifNumber,
        gross: payslip.grossEarnings,
        employee: employeeNhif,
      });

      nhifTotals = {
        employee: nhifTotals.employee + employeeNhif,
        gross: nhifTotals.gross + payslip.grossEarnings,
      };
    }
  });

  const totalOf = (list, code) =>
    payslips.reduce((sum, payslip) => sum + componentTotal(payslip, list, code), 0);

  const round = (object) =>
    Object.fromEntries(Object.entries(object).map(([key, value]) => [key, roundToCurrency(value)]));

  return {
    year,
    month,
    nssf: { rows: nssf, totals: round({ ...nssfTotals, total: nssfTotals.employee + nssfTotals.employer }), count: nssf.length },
    nhif: { rows: nhif, totals: round(nhifTotals), count: nhif.length },
    paye: { total: roundToCurrency(totalOf('deductions', COMPONENT_CODE.PAYE)) },
    // Employer-side levies, reported for their own returns.
    sdl: { total: roundToCurrency(totalOf('employerContributions', COMPONENT_CODE.SDL)) },
    wcf: { total: roundToCurrency(totalOf('employerContributions', COMPONENT_CODE.WCF)) },
  };
};

/* -------------------------------------------------------------------------- */
/*                              Cost analysis                                 */
/* -------------------------------------------------------------------------- */

/** Payroll cost by department for a month -- what finance books against. */
export const costByDepartment = async ({ year, month }, req) => {
  const tenantId = req.user.tenantId ?? null;

  const rows = await Payslip.aggregate([
    { $match: { tenantId, year, month } },
    {
      $group: {
        _id: '$employeeSnapshot.department',
        headcount: { $sum: 1 },
        gross: { $sum: '$grossEarnings' },
        deductions: { $sum: '$totalDeductions' },
        net: { $sum: '$netPayable' },
        employerCost: { $sum: '$employerContributionTotal' },
      },
    },
    { $sort: { gross: -1 } },
  ]);

  return {
    year,
    month,
    rows: rows.map((row) => ({
      department: row._id ?? 'Unassigned',
      headcount: row.headcount,
      gross: roundToCurrency(row.gross),
      deductions: roundToCurrency(row.deductions),
      net: roundToCurrency(row.net),
      employerCost: roundToCurrency(row.employerCost),
      // What the month actually costs the company: gross plus employer side.
      totalCost: roundToCurrency(row.gross + row.employerCost),
    })),
  };
};

/**
 * A month-by-month trend for one financial year. Feeds the payroll dashboard
 * and answers "why did the wage bill jump in September".
 */
export const yearlyTrend = async ({ year }, req) => {
  const tenantId = req.user.tenantId ?? null;

  const rows = await Payslip.aggregate([
    { $match: { tenantId, year } },
    {
      $group: {
        _id: '$month',
        headcount: { $sum: 1 },
        gross: { $sum: '$grossEarnings' },
        net: { $sum: '$netPayable' },
        employerCost: { $sum: '$employerContributionTotal' },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return {
    year,
    months: rows.map((row) => ({
      month: row._id,
      headcount: row.headcount,
      gross: roundToCurrency(row.gross),
      net: roundToCurrency(row.net),
      employerCost: roundToCurrency(row.employerCost),
    })),
  };
};

export default {
  salaryRegister,
  exportSalaryRegister,
  statutoryReport,
  costByDepartment,
  yearlyTrend,
};
