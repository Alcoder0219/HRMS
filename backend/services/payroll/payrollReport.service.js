import mongoose from 'mongoose';
import ApiError from '../../utils/ApiError.js';
import { AUDIT_ACTIONS, COMPONENT_CODE } from '../../utils/constants.js';
import Payslip from '../../models/payroll/payslip.model.js';
import payrollRepository from '../../repositories/payroll/payroll.repository.js';
import { buildWorkbook } from '../../helpers/excel.helper.js';
import { calculateGrossSalary } from '../../helpers/salaryCalculator.helper.js';
import { roundToRupee } from '../../helpers/statutory.helper.js';
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
 * Conveyance, medical and other allowance share one component code.
 *
 * The payroll structure has four named earning columns and a list for
 * everything else, so all three arrive as OTHER_ALLOWANCE and are told apart
 * only by their label. Matching on the label is what lets the register show
 * them in their own columns; `componentTotal` would return whichever happened
 * to be first and silently drop the other two.
 */
const allowanceByLabel = (payslip, pattern) =>
  (payslip.earnings ?? [])
    .filter((entry) => entry.code === COMPONENT_CODE.OTHER_ALLOWANCE && pattern.test(entry.label ?? ''))
    .reduce((sum, entry) => sum + (entry.amount ?? 0), 0);

const CONVEYANCE = /conveyance/i;
const MEDICAL = /medical/i;

/**
 * Whatever is left in the allowance list once conveyance and medical are out.
 *
 * Dearness allowance is folded in here rather than dropped. It is a fixed
 * earning and so is part of gross, but the register has no column of its own
 * for it -- leaving it out of every column while gross still counted it would
 * break the one invariant this report guarantees, that the earnings columns
 * add up to the gross printed beside them. It is nil in every current
 * structure; if it is ever used in earnest it deserves its own column.
 */
const residualAllowance = (payslip) =>
  (payslip.earnings ?? [])
    .filter(
      (entry) =>
        entry.code === COMPONENT_CODE.DA ||
        (entry.code === COMPONENT_CODE.OTHER_ALLOWANCE &&
          !CONVEYANCE.test(entry.label ?? '') &&
          !MEDICAL.test(entry.label ?? '')),
    )
    .reduce((sum, entry) => sum + (entry.amount ?? 0), 0);

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
    const variablePay = roundToRupee(overtime + bonus + incentive + arrears);

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

    const pf = componentTotal(payslip, 'deductions', COMPONENT_CODE.PF);
    const esi = componentTotal(payslip, 'deductions', COMPONENT_CODE.ESI);
    const lwf = componentTotal(payslip, 'deductions', COMPONENT_CODE.LWF);
    const pt = componentTotal(payslip, 'deductions', COMPONENT_CODE.PT);
    const tds = componentTotal(payslip, 'deductions', COMPONENT_CODE.TDS);
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
    const otherDeductions = roundToRupee(employeeDeductions - (pf + esi + lwf + pt + tds));

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
    const totalDeductions = roundToRupee(employeeDeductions + employerContribution);

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
      basic: componentTotal(payslip, 'earnings', COMPONENT_CODE.BASIC),
      hra: componentTotal(payslip, 'earnings', COMPONENT_CODE.HRA),
      da: componentTotal(payslip, 'earnings', COMPONENT_CODE.DA),
      conveyanceAllowance: allowanceByLabel(payslip, CONVEYANCE),
      medicalAllowance: allowanceByLabel(payslip, MEDICAL),
      specialAllowance: componentTotal(payslip, 'earnings', COMPONENT_CODE.SPECIAL_ALLOWANCE),
      otherAllowance: residualAllowance(payslip),
      grossSalary,

      /* --- employee deductions --------------------------------------- */
      pf,
      esi,
      lwf,
      pt,
      tds,
      loan,
      advance,
      otherDeductions,
      // What actually comes out of the employee's pay, and what net is built
      // from. Kept alongside the combined figure so a caller can have either.
      employeeDeductions,
      // Employee side plus employer side. See above.
      totalDeductions,

      /**
       * The employer side. No ESI: the company makes no ESI contribution, so
       * there is no figure to report and no column for one.
       */
      employerPf: componentTotal(payslip, 'employerContributions', COMPONENT_CODE.EMPLOYER_PF),
      employerEps: componentTotal(payslip, 'employerContributions', COMPONENT_CODE.EMPLOYER_EPS),
      employerLwf: componentTotal(payslip, 'employerContributions', COMPONENT_CODE.EMPLOYER_LWF),
      /**
       * Retained on the row for the accounting reports that consume it, but no
       * longer a column: the register shows the employer's PF and LWF as their
       * own lines and does not repeat them as an aggregate.
       */
      employerContribution,

      /* --- what is paid ---------------------------------------------- */
      /**
       * Gross less the COMBINED deduction total -- employee side and employer
       * side together -- as the register is now specified.
       *
       * Read that carefully before changing it back: `totalDeductions`
       * includes the employer's own PF and LWF, so this figure is the gross
       * less money the company contributed rather than money the employee
       * lost. It is 892 rupees below the employee's own arithmetic for
       * Akansh, and the stored payslip still carries that other figure. See
       * the note above `totalDeductions`.
       */
      netSalary: roundToRupee(grossSalary - totalDeductions),
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
      finalPayable: roundToRupee(grossSalary - totalDeductions + variablePay),

      // Kept under their original names so anything already reading the
      // register -- the old export, a saved report -- keeps working.
      gross: roundToRupee(grossSalary + variablePay),
      netPayable: roundToRupee(grossSalary - totalDeductions + variablePay),

      status: payslip.status,
    };
  });

  /** Column totals, for the summary cards. Summed from the rows above. */
  const sum = (key) => roundToRupee(rows.reduce((total, row) => total + (row[key] ?? 0), 0));

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
  { header: 'HRA', key: 'hra', width: 13, format: '#,##0.00' },
  { header: 'Conveyance Allowance', key: 'conveyanceAllowance', width: 20, format: '#,##0.00' },
  { header: 'Medical Allowance', key: 'medicalAllowance', width: 18, format: '#,##0.00' },
  { header: 'Special Allowance', key: 'specialAllowance', width: 18, format: '#,##0.00' },
  { header: 'Other Allowance', key: 'otherAllowance', width: 17, format: '#,##0.00' },
  { header: 'Gross Salary', key: 'grossSalary', width: 15, format: '#,##0.00' },

  { header: 'Employee PF', key: 'pf', width: 14, format: '#,##0.00' },
  { header: 'Employer PF', key: 'employerPf', width: 14, format: '#,##0.00' },
  // No Employer ESI column: there is no employer ESI contribution.
  { header: 'Employee ESI', key: 'esi', width: 14, format: '#,##0.00' },
  { header: 'Employee LWF', key: 'lwf', width: 14, format: '#,##0.00' },
  { header: 'Employer LWF', key: 'employerLwf', width: 14, format: '#,##0.00' },
  { header: 'Professional Tax', key: 'pt', width: 16, format: '#,##0.00' },
  { header: 'TDS', key: 'tds', width: 13, format: '#,##0.00' },
  { header: 'Other Deductions', key: 'otherDeductions', width: 17, format: '#,##0.00' },
  // Named for what it now holds: both sides, not the employee's alone. The
  // employer's PF and LWF have their own columns above, so there is no
  // aggregate Employer Contribution column repeating them.
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
 * PF and ESI contribution statements -- the shape the monthly ECR and ESI
 * returns are prepared from.
 */
export const statutoryReport = async ({ year, month }, req) => {
  const tenantId = req.user.tenantId ?? null;
  const payslips = await Payslip.find({ tenantId, year, month }).lean();

  const pf = [];
  const esi = [];
  let pfTotals = { employee: 0, employer: 0, pension: 0, wages: 0 };
  let esiTotals = { employee: 0, employer: 0, gross: 0 };

  payslips.forEach((payslip) => {
    const employeePf = componentTotal(payslip, 'deductions', COMPONENT_CODE.PF);
    const employerPf = componentTotal(payslip, 'employerContributions', COMPONENT_CODE.EMPLOYER_PF);
    const pension = componentTotal(payslip, 'employerContributions', COMPONENT_CODE.EMPLOYER_EPS);

    if (employeePf > 0 || employerPf > 0) {
      const wages = payslip.statutoryDetail?.pf?.wages ?? 0;
      pf.push({
        employeeCode: payslip.employeeSnapshot?.employeeCode,
        fullName: payslip.employeeSnapshot?.fullName,
        uan: payslip.employeeSnapshot?.uan,
        pfNumber: payslip.employeeSnapshot?.pfNumber,
        wages,
        employee: employeePf,
        employer: employerPf,
        pension,
      });

      pfTotals = {
        employee: pfTotals.employee + employeePf,
        employer: pfTotals.employer + employerPf,
        pension: pfTotals.pension + pension,
        wages: pfTotals.wages + wages,
      };
    }

    /**
     * The employer contributes nothing to ESI here, so the employer figure is
     * a constant zero rather than a lookup. The key is kept so the report's
     * shape -- and anything already reading it -- is unchanged.
     */
    const employeeEsi = componentTotal(payslip, 'deductions', COMPONENT_CODE.ESI);

    if (employeeEsi > 0) {
      esi.push({
        employeeCode: payslip.employeeSnapshot?.employeeCode,
        fullName: payslip.employeeSnapshot?.fullName,
        esiNumber: payslip.employeeSnapshot?.esiNumber,
        gross: payslip.grossEarnings,
        employee: employeeEsi,
        employer: 0,
      });

      esiTotals = {
        employee: esiTotals.employee + employeeEsi,
        employer: 0,
        gross: esiTotals.gross + payslip.grossEarnings,
      };
    }
  });

  const ptTotal = payslips.reduce(
    (sum, payslip) => sum + componentTotal(payslip, 'deductions', COMPONENT_CODE.PT),
    0,
  );
  const tdsTotal = payslips.reduce(
    (sum, payslip) => sum + componentTotal(payslip, 'deductions', COMPONENT_CODE.TDS),
    0,
  );

  const round = (object) =>
    Object.fromEntries(Object.entries(object).map(([key, value]) => [key, roundToRupee(value)]));

  return {
    year,
    month,
    pf: { rows: pf, totals: round(pfTotals), count: pf.length },
    esi: { rows: esi, totals: round(esiTotals), count: esi.length },
    professionalTax: { total: roundToRupee(ptTotal) },
    tds: { total: roundToRupee(tdsTotal) },
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
      gross: roundToRupee(row.gross),
      deductions: roundToRupee(row.deductions),
      net: roundToRupee(row.net),
      employerCost: roundToRupee(row.employerCost),
      // What the month actually costs the company: gross plus employer side.
      totalCost: roundToRupee(row.gross + row.employerCost),
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
      gross: roundToRupee(row.gross),
      net: roundToRupee(row.net),
      employerCost: roundToRupee(row.employerCost),
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
