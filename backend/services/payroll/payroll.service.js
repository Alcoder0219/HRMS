import logger from '../../config/logger.js';
import ApiError from '../../utils/ApiError.js';
import {
  ACTIVE_EMPLOYEE_STATUSES,
  AUDIT_ACTIONS,
  CURRENCY,
  PAYROLL_STATUS,
  PAYROLL_STATUS_TRANSITIONS,
  PAYSLIP_STATUS,
  EDITABLE_PAYROLL_STATUSES,
  RESOURCES,
  ROLES,
} from '../../utils/constants.js';
import { buildPagination, buildSort } from '../../utils/queryBuilder.js';

import Employee from '../../models/employee/employee.model.js';
import Attendance from '../../models/attendance/attendance.model.js';
import payrollRepository from '../../repositories/payroll/payroll.repository.js';
import { calculatePayslip } from '../../helpers/salaryCalculator.helper.js';
import { deriveOvertimeRate, deriveSalaryTotals } from '../../models/employee/employee.model.js';
import { structureGross } from '../../models/payroll/salaryStructure.model.js';
import { DEFAULT_STATUTORY, roundToCurrency } from '../../helpers/statutory.helper.js';
import { buildBankTransferFile } from '../../helpers/bankFile.helper.js';
import { buildPayslipPdf } from '../../helpers/pdf.helper.js';
import { recordAudit } from '../../helpers/audit.helper.js';
import { buildScopeFilter } from '../../helpers/permission.helper.js';

const ENTITY = 'PayrollRun';

export const RUN_SORTABLE_FIELDS = ['year', 'month', 'status', 'totalNet', 'createdAt'];
/**
 * What the payslip list may be ordered by. Read by the query validator as well
 * as by the sort builder, so anything the screen offers must appear here or the
 * request is rejected before it runs.
 *
 * `period` and `status` are the two columns the payslip table marks sortable
 * and this list did not know about. `period` is the screen's DEFAULT sort, so
 * every request it made -- including the first, with no filters set -- failed
 * validation and the page could not load at all. Both are real fields on the
 * payslip; `status` is covered by the (tenant, year, month, status) index.
 */
export const PAYSLIP_SORTABLE_FIELDS = ['period', 'netPayable', 'grossEarnings', 'month', 'status', 'createdAt'];

// `en-TZ` is absent from some Node ICU builds; `en-GB` produces the same
// "August 2026" and is present everywhere.
const periodLabel = (year, month) =>
  new Date(year, month - 1).toLocaleString([CURRENCY.LOCALE, 'en-GB'], { month: 'long', year: 'numeric' });

const daysInMonth = (year, month) => new Date(year, month, 0).getDate();

/**
 * Tax-year start preceding a given month, for the YTD block on the payslip.
 *
 * Tanzania's tax year is the calendar year, so this normally resolves to
 * January -- but it stays configurable because a tenant may report on its own
 * financial year.
 */
const financialYearStart = (year, month, startMonth = 1) =>
  month >= startMonth ? { year, month: startMonth } : { year: year - 1, month: startMonth };

const maskAccount = (value) =>
  !value ? null : `${'*'.repeat(Math.max(0, String(value).length - 4))}${String(value).slice(-4)}`;

/* -------------------------------------------------------------------------- */
/*                              Attendance input                              */
/* -------------------------------------------------------------------------- */

/**
 * Payable days per employee for the month, from the attendance module.
 *
 * Computed in one aggregation, and it is the only input that decides whether a
 * salary is prorated:
 *
 *   payable = present + weekly off + holiday + paid leave + half days x 0.5
 *
 * Every status is counted here rather than inferred later, and the breakdown
 * is carried through so the payroll log can show exactly which days made up
 * the total. An employee with no attendance rows has no payable days, so an
 * unprocessed month produces a visible zero instead of a silent full payment.
 */
const loadAttendance = async (employeeIds, year, month) => {
  const from = new Date(year, month - 1, 1);
  const to = new Date(year, month, 0, 23, 59, 59, 999);

  const rows = await Attendance.aggregate([
    { $match: { employeeId: { $in: employeeIds }, date: { $gte: from, $lte: to } } },
    {
      $group: {
        _id: '$employeeId',
        recordedDays: { $sum: 1 },
        present: {
          $sum: {
            $cond: [{ $in: ['$status', ['PRESENT', 'ON_DUTY', 'WORK_FROM_HOME']] }, 1, 0],
          },
        },
        halfDay: { $sum: { $cond: [{ $eq: ['$status', 'HALF_DAY'] }, 1, 0] } },
        // Counted apart so the payroll log can name them; all three are
        // payable, and all three are days nobody was expected to work.
        weeklyOff: { $sum: { $cond: [{ $eq: ['$status', 'WEEKLY_OFF'] }, 1, 0] } },
        holiday: { $sum: { $cond: [{ $eq: ['$status', 'HOLIDAY'] }, 1, 0] } },
        paidLeave: { $sum: { $cond: [{ $eq: ['$status', 'ON_LEAVE'] }, 1, 0] } },
        absent: { $sum: { $cond: [{ $eq: ['$status', 'ABSENT'] }, 1, 0] } },
        missingPunch: { $sum: { $cond: [{ $eq: ['$status', 'MISSING_PUNCH'] }, 1, 0] } },
        overtimeMinutes: { $sum: '$overtimeMinutes' },
      },
    },
  ]);

  return new Map(
    rows.map((row) => [
      String(row._id),
      {
        recordedDays: row.recordedDays,
        presentDays: row.present,
        weeklyOffDays: row.weeklyOff,
        holidayDays: row.holiday,
        paidLeaveDays: row.paidLeave,
        halfDays: row.halfDay,
        absentDays: row.absent,
        missingPunchDays: row.missingPunch,

        /**
         * A half day is worth half. A missing punch is NOT an absence -- the
         * person was at work and only the punch data is incomplete -- so it
         * stays payable; docking pay for a device failure would be a payroll
         * error, not a policy.
         */
        payableDays:
          row.present + row.weeklyOff + row.holiday + row.paidLeave + row.halfDay * 0.5 + row.missingPunch,

        // Reported on the payslip. Not used to prorate: absent days reduce pay
        // by being absent from the payable total, and subtracting them again
        // would dock the same day twice.
        lopDays: row.absent + row.halfDay * 0.5,
        overtimeMinutes: row.overtimeMinutes ?? 0,
      },
    ]),
  );
};

/* -------------------------------------------------------------------------- */
/*                                 Processing                                 */
/* -------------------------------------------------------------------------- */

const assertEditable = (run) => {
  if (!EDITABLE_PAYROLL_STATUSES.includes(run.status)) {
    throw ApiError.badRequest(
      `This payroll run is ${run.status.toLowerCase().replace(/_/g, ' ')} and can no longer be changed`,
    );
  }
};

/**
 * Prices every eligible employee for a month.
 *
 * Idempotent: re-running replaces the payslips for the period rather than
 * appending, so a correction is "fix the input, process again" instead of a
 * manual cleanup. Loan recovery is applied only when the run is approved --
 * see `approveRun` -- so repeated processing cannot write a balance down twice.
 */
export const processRun = async (
  { year, month, employeeIds = null, variablePay = null, remarks = null },
  req,
) => {
  const tenantId = req.user.tenantId ?? null;

  /**
   * One-off pay for this run, keyed by employee.
   *
   * The calculator has always accepted bonus, incentive and arrears; nothing
   * ever supplied them, so `variable` was a hardcoded empty object and those
   * components could never appear on a payslip. This is where they enter.
   */
  const variableByEmployee = new Map(
    (variablePay ?? []).map((entry) => [String(entry.employeeId), entry]),
  );
  const settings = (await payrollRepository.findSettings(tenantId)) ?? DEFAULT_STATUTORY;
  const totalDays = daysInMonth(year, month);

  const existing = await payrollRepository.findRun(tenantId, year, month);
  if (existing) assertEditable(existing);

  /* --- population -------------------------------------------------------- */
  const employeeFilter = {
    tenantId,
    deletedAt: null,
    status: { $in: ACTIVE_EMPLOYEE_STATUSES },
    ...(employeeIds?.length ? { _id: { $in: employeeIds } } : {}),
  };

  const employees = await Employee.find(employeeFilter)
    .populate([
      { path: 'departmentId', select: 'name code' },
      { path: 'designationId', select: 'name code' },
    ])
    .lean();

  if (!employees.length) throw ApiError.badRequest('No eligible employees found for this period');

  const ids = employees.map((employee) => employee._id);
  const periodStart = new Date(year, month - 1, 1);

  const [structures, attendanceMap, loans] = await Promise.all([
    payrollRepository.findStructuresOn(ids, new Date(year, month, 0)),
    loadAttendance(ids, year, month),
    payrollRepository.findRecoverableLoans(ids),
  ]);

  const loansByEmployee = new Map();
  loans.forEach((loan) => {
    const key = String(loan.employeeId);
    if (!loansByEmployee.has(key)) loansByEmployee.set(key, []);
    loansByEmployee.get(key).push(loan);
  });

  /* --- run shell --------------------------------------------------------- */
  const run = await payrollRepository.upsertRun(tenantId, year, month, {
    period: periodLabel(year, month),
    totalDaysInMonth: totalDays,
    payableDaysBasis: settings.payableDaysBasis ?? 'CALENDAR',
    status: PAYROLL_STATUS.PROCESSING,
    processedAt: new Date(),
    processedBy: req.user.id,
    remarks,
    createdBy: existing?.createdBy ?? req.user.id,
  });

  // Wholesale replacement, so an employee who has since become ineligible does
  // not leave a stale payslip behind on the register.
  await payrollRepository.deletePayslipsForRun(run._id);

  /**
   * The month's full gross, before any loss of pay.
   *
   * The overtime rate divides gross by the month's hours, so it has to be the
   * unprorated figure -- pricing an hour off a salary already reduced for
   * absence would dock the same absence twice. Summed from the structure's own
   * components, through the same helper the structure's `grossMonthly` virtual
   * uses, so the two cannot disagree.
   */
  const monthlyGrossOf = structureGross;

  /* --- price each employee ---------------------------------------------- */
  const fyStart = financialYearStart(year, month, settings.financialYearStartMonth ?? 1);

  const exclusions = [];
  const totals = {
    employeeCount: 0,
    totalGross: 0,
    totalDeductions: 0,
    totalNet: 0,
    totalEmployerContribution: 0,
    totalNssfEmployee: 0,
    totalNssfEmployer: 0,
    totalNhif: 0,
    totalSdl: 0,
    totalWcf: 0,
    totalPaye: 0,
    totalLoanRecovery: 0,
  };

  for (const employee of employees) {
    const structure = structures.get(String(employee._id));

    if (!structure) {
      // Reported, never silently skipped -- a missing payslip is a person who
      // does not get paid.
      exclusions.push({
        employeeId: employee._id,
        employeeCode: employee.employeeCode,
        reason: 'No salary structure in force for this period',
      });
      continue;
    }

    /**
     * No attendance for the month means no payable days.
     *
     * This used to default to a full month, which is why a month with seven
     * days of data still paid thirty-one days' salary: the run either found
     * partial data and prorated it, or found none and paid in full. Payroll
     * cannot assume days that have not happened yet, so an empty month is
     * worth nothing until its attendance is processed.
     */
    const attendance = attendanceMap.get(String(employee._id)) ?? {
      payableDays: 0,
      lopDays: 0,
      presentDays: 0,
      weeklyOffDays: 0,
      holidayDays: 0,
      paidLeaveDays: 0,
      halfDays: 0,
      absentDays: 0,
      missingPunchDays: 0,
      overtimeMinutes: 0,
      recordedDays: 0,
    };

    const ytd = await payrollRepository.yearToDate(employee._id, fyStart, year, month);

    const result = calculatePayslip({
      structure,
      attendance: { ...attendance, totalDays },

      /**
       * The Employee Master's salary structure, which decides the fixed
       * figures. Gross, the statutory employee deductions and the employer
       * contribution all come from here rather than being re-derived, so the
       * payroll register shows what the employee record shows.
       */
      salarySnapshot: employee.salaryStructure
        ? {
            ...(employee.salaryStructure.toObject?.() ?? employee.salaryStructure),
            ...deriveSalaryTotals(employee.salaryStructure),
          }
        : null,
      variable: variableByEmployee.get(String(employee._id)) ?? {},
      loans: (loansByEmployee.get(String(employee._id)) ?? []).map((loan) => ({
        loanId: loan._id,
        emi: loan.emi,
        outstanding: loan.outstanding,
      })),
      statutory: settings,

      /**
       * Statutory enrolment comes from the Employee Master, read fresh for
       * this run, and from nowhere else.
       *
       * It must not be read off the projected payroll structure, whose flags
       * default to true and which the Employee Master sync never writes: every
       * employee would look enrolled in everything, and someone held outside
       * NSSF in their own record would still have it deducted.
       *
       * Compared with `=== true` deliberately. A missing flag on an older
       * record must read as disabled, not as enabled -- deducting from
       * somebody because a field was absent is the failure that matters here,
       * and `!employee.statutory?.nssfApplicable` would invert exactly that.
       */
      flags: {
        nssfApplicable: employee.statutory?.nssfApplicable === true,
        nhifApplicable: employee.statutory?.nhifApplicable === true,
        payeApplicable: employee.statutory?.payeApplicable === true,
      },
      overtimeMultiplier: structure.overtimeMultiplier ?? settings.overtimeMultiplier ?? 2,
      payeOverride: structure.payeOverride,
      /**
       * The employee's own overtime rules decide eligibility and the rate.
       *
       * The rate is re-derived for the month being paid rather than read off
       * the employee record. The hourly figure divides by the month's own
       * length, so a value stored when the employee was last edited belongs to
       * whatever month that was -- paying August at a February rate is a 10%
       * error, and nobody would see where it came from. The payslip formula is
       * untouched; only the rate handed to it is now correct for the period.
       */
      overtimeConfig: employee.overtime
        ? {
            ...(employee.overtime.toObject?.() ?? employee.overtime),
            ...deriveOvertimeRate(employee.overtime, monthlyGrossOf(structure), {
              year,
              month,
              companyMultiplier: settings.overtimeMultiplier ?? 2,
            }),
          }
        : null,
    });

    /**
     * One line per employee, showing every input that decided the figure.
     *
     * Payroll disputes are always "why is this number different from last
     * month", and answering that from stored payslips alone means guessing at
     * what the attendance looked like at the time. `reason` states it plainly
     * rather than leaving it to be inferred from the day counts.
     */
    logger.info('Payroll: employee priced', {
      month: `${year}-${String(month).padStart(2, '0')}`,
      employeeCode: employee.employeeCode,
      totalCalendarDays: totalDays,
      present: attendance.presentDays ?? 0,
      weeklyOff: attendance.weeklyOffDays ?? 0,
      holiday: attendance.holidayDays ?? 0,
      paidLeave: attendance.paidLeaveDays ?? 0,
      halfDay: attendance.halfDays ?? 0,
      absent: attendance.absentDays ?? 0,
      missingPunch: attendance.missingPunchDays ?? 0,
      lopDays: attendance.lopDays ?? 0,
      payableDays: attendance.payableDays ?? 0,
      grossFromSalaryStructure: result.salaryStructureGross ?? null,
      proratedGross: result.grossEarnings,
      employeeDeductions: result.totalDeductions,
      netSalary: result.netPayable,
      prorated: result.prorated,
      reason: result.prorated
        ? `${attendance.payableDays ?? 0} payable day(s) of ${totalDays}` +
          `${(attendance.absentDays ?? 0) > 0 ? `, ${attendance.absentDays} absent` : ''}` +
          `${(attendance.recordedDays ?? 0) < totalDays ? `, attendance recorded for only ${attendance.recordedDays ?? 0} day(s)` : ''}`
        : 'full month payable, salary structure used unchanged',
    });

    await payrollRepository.upsertPayslip(run._id, employee._id, {
      tenantId,
      payrollRunId: run._id,
      employeeId: employee._id,
      year,
      month,
      period: run.period,
      employeeSnapshot: {
        employeeCode: employee.employeeCode,
        employeeId: employee.employeeId ?? null,
        fullName: [employee.firstName, employee.middleName, employee.lastName].filter(Boolean).join(' '),
        designation: employee.designationId?.name ?? null,
        department: employee.departmentId?.name ?? null,
        joiningDate: employee.joiningDate,
        tinNumber: employee.statutory?.tinNumber ?? null,
        nssfNumber: employee.statutory?.nssfNumber ?? null,
        nhifNumber: employee.statutory?.nhifNumber ?? null,
        bankName: employee.bankDetails?.bankName ?? null,
        accountNumberMasked: maskAccount(employee.bankDetails?.accountNumber),
        swiftCode: employee.bankDetails?.swiftCode ?? null,
      },
      structureId: structure._id,
      structureSnapshot: {
        basic: structure.basic,
        hraAllowance: structure.hraAllowance,
        foodAllowance: structure.foodAllowance,
        transportationAllowance: structure.transportationAllowance,
        communicationAllowance: structure.communicationAllowance,
        mediclaim: structure.mediclaim,
        schoolFeesAllowance: structure.schoolFeesAllowance,
        annualLeaveAllowance: structure.annualLeaveAllowance,
        performanceIncentive: structure.performanceIncentive,
        otherAllowances: structure.otherAllowances,
        annualCtc: structure.annualCtc,
        effectiveFrom: structure.effectiveFrom,
      },
      attendance: {
        totalDays,
        payableDays: result.payableDays,
        lopDays: result.lopDays,
        presentDays: attendance.presentDays,
        overtimeMinutes: attendance.overtimeMinutes,
      },
      earnings: result.earnings,
      deductions: result.deductions,
      employerContributions: result.employerContributions,
      grossEarnings: result.grossEarnings,
      totalDeductions: result.totalDeductions,
      employerContributionTotal: result.employerContributionTotal,
      netPayable: result.netPayable,
      unrecovered: result.unrecovered,
      statutoryDetail: result.statutoryDetail,
      recoveries: result.recoveries,
      ytd: {
        gross: roundToCurrency(ytd.gross + result.grossEarnings),
        deductions: roundToCurrency(ytd.deductions + result.totalDeductions),
        net: roundToCurrency(ytd.net + result.netPayable),
        nssf: roundToCurrency(ytd.nssf + (result.statutoryDetail.nssf.employee ?? 0)),
        paye: roundToCurrency(ytd.paye + (result.statutoryDetail.paye.monthly ?? 0)),
      },
      status: PAYSLIP_STATUS.DRAFT,
      generatedBy: req.user.id,
    });

    totals.employeeCount += 1;
    totals.totalGross += result.grossEarnings;
    totals.totalDeductions += result.totalDeductions;
    totals.totalNet += result.netPayable;
    totals.totalEmployerContribution += result.employerContributionTotal;
    totals.totalNssfEmployee += result.statutoryDetail.nssf.employee ?? 0;
    totals.totalNssfEmployer += result.statutoryDetail.nssf.employer ?? 0;
    totals.totalNhif += result.statutoryDetail.nhif ?? 0;
    totals.totalSdl += result.statutoryDetail.sdl ?? 0;
    totals.totalWcf += result.statutoryDetail.wcf ?? 0;
    totals.totalPaye += result.statutoryDetail.paye.monthly ?? 0;
    totals.totalLoanRecovery += (result.recoveries.loans ?? []).reduce((sum, entry) => sum + entry.amount, 0);
  }

  const updated = await payrollRepository.updateRun(run._id, {
    $set: {
      ...Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, roundToCurrency(value)])),
      exclusions,
    },
  });

  await recordAudit({
    req,
    entity: ENTITY,
    entityId: run._id,
    entityLabel: run.period,
    action: AUDIT_ACTIONS.CREATE,
    metadata: {
      processed: totals.employeeCount,
      excluded: exclusions.length,
      totalNet: roundToCurrency(totals.totalNet),
    },
  });

  logger.info('Payroll processed', {
    period: run.period,
    employees: totals.employeeCount,
    excluded: exclusions.length,
    net: roundToCurrency(totals.totalNet),
  });

  return updated;
};

/* -------------------------------------------------------------------------- */
/*                                  Workflow                                  */
/* -------------------------------------------------------------------------- */

const transition = async (runId, next, req, extra = {}) => {
  const run = await payrollRepository.findRunById(runId);
  if (!run) throw ApiError.notFound('Payroll run not found');

  const callerTenant = req.user.tenantId ?? null;
  if (callerTenant !== null && String(run.tenantId) !== callerTenant) {
    throw ApiError.notFound('Payroll run not found');
  }

  const allowed = PAYROLL_STATUS_TRANSITIONS[run.status] ?? [];
  if (!allowed.includes(next)) {
    throw ApiError.badRequest(`A ${run.status} payroll run cannot move to ${next}`, {
      from: run.status,
      allowed,
    });
  }

  return { run, updated: await payrollRepository.updateRun(runId, { $set: { status: next, ...extra } }) };
};

export const submitRun = async (runId, req) => {
  const { updated } = await transition(runId, PAYROLL_STATUS.PENDING_APPROVAL, req, {
    submittedAt: new Date(),
    submittedBy: req.user.id,
  });

  await recordAudit({
    req,
    entity: ENTITY,
    entityId: runId,
    action: AUDIT_ACTIONS.STATUS_CHANGE,
    changes: [{ field: 'status', from: PAYROLL_STATUS.PROCESSING, to: PAYROLL_STATUS.PENDING_APPROVAL }],
  });

  return updated;
};

/**
 * Approval is where the ledger actually moves.
 *
 * Loan balances are written down here, not during processing, because
 * processing is idempotent and repeatable -- applying recoveries there would
 * decrement a loan on every reprocess. Approval happens once.
 */
export const approveRun = async (runId, req) => {
  const run = await payrollRepository.findRunById(runId);
  if (!run) throw ApiError.notFound('Payroll run not found');

  const callerTenant = req.user.tenantId ?? null;
  if (callerTenant !== null && String(run.tenantId) !== callerTenant) {
    throw ApiError.notFound('Payroll run not found');
  }

  const allowed = PAYROLL_STATUS_TRANSITIONS[run.status] ?? [];
  if (!allowed.includes(PAYROLL_STATUS.APPROVED)) {
    throw ApiError.badRequest(`A ${run.status} payroll run cannot be approved`, {
      from: run.status,
      allowed,
    });
  }

  /**
   * Maker-checker, verified before anything is written -- with the platform
   * operator exempt.
   *
   * Whoever prepared the register does not get to approve it, which is the
   * ordinary control over salary data and still applies to PAYROLL and
   * COMPANY_ADMIN. Checking before the write avoids a window where the run is
   * briefly APPROVED and has to be rolled back.
   *
   * SUPER_ADMIN is exempt because the permission matrix already declares that
   * role unrestricted -- `{ '*': ['*'] }`, "Unrestricted across every tenant"
   * -- and this check contradicted it. On an installation where the Super
   * Admin is the only holder of `payroll:approve`, it also had no way out: the
   * same person necessarily prepares and approves, so a run that reached
   * PENDING_APPROVAL could never leave it and payroll could not be released at
   * all. The exemption is by role, not by "the check is inconvenient".
   *
   * Everyone else is unchanged, and nobody without `payroll:approve` reaches
   * this line -- the route requires that grant before the service is called.
   */
  const selfApproving = Boolean(run.processedBy) && String(run.processedBy) === String(req.user.id);

  if (selfApproving && req.user.role !== ROLES.SUPER_ADMIN) {
    throw ApiError.forbidden('You prepared this payroll run and cannot approve it');
  }

  const previousStatus = run.status;
  await payrollRepository.updateRun(runId, {
    $set: { status: PAYROLL_STATUS.APPROVED, approvedAt: new Date(), approvedBy: req.user.id },
  });

  const payslips = await payrollRepository.findPayslipsForRun(run._id, {
    status: { $ne: PAYSLIP_STATUS.ON_HOLD },
  });

  let recovered = 0;
  for (const payslip of payslips) {
    for (const entry of payslip.recoveries?.loans ?? []) {
      await payrollRepository.recordLoanRecovery(entry.loanId, entry.amount, {
        year: run.year,
        month: run.month,
        payslipId: payslip._id,
      });
      recovered += entry.amount;
    }
  }

  await payrollRepository.closeSettledLoans();
  await payrollRepository.publishPayslips(run._id);

  await recordAudit({
    req,
    entity: ENTITY,
    entityId: runId,
    entityLabel: run.period,
    action: AUDIT_ACTIONS.STATUS_CHANGE,
    changes: [{ field: 'status', from: previousStatus, to: PAYROLL_STATUS.APPROVED }],
    metadata: {
      payslips: payslips.length,
      loanRecovered: roundToCurrency(recovered),
      // An approval that skipped maker-checker is exactly what an auditor asks
      // about, so it is recorded rather than left to be inferred from two ids.
      selfApproved: selfApproving,
    },
  });

  logger.info('Payroll approved', { period: run.period, payslips: payslips.length });

  return payrollRepository.findRunById(runId);
};

export const markPaid = async (runId, { paymentReference }, req) => {
  const { updated } = await transition(runId, PAYROLL_STATUS.PAID, req, {
    paidAt: new Date(),
    paidBy: req.user.id,
    paymentReference: paymentReference ?? null,
  });

  await recordAudit({
    req,
    entity: ENTITY,
    entityId: runId,
    action: AUDIT_ACTIONS.STATUS_CHANGE,
    changes: [{ field: 'status', from: PAYROLL_STATUS.APPROVED, to: PAYROLL_STATUS.PAID }],
    metadata: { paymentReference },
  });

  return updated;
};

export const cancelRun = async (runId, { reason }, req) => {
  const { updated } = await transition(runId, PAYROLL_STATUS.CANCELLED, req, {
    cancelledAt: new Date(),
    cancelReason: reason,
  });

  await recordAudit({
    req,
    entity: ENTITY,
    entityId: runId,
    action: AUDIT_ACTIONS.STATUS_CHANGE,
    metadata: { reason },
  });

  return updated;
};

/* -------------------------------------------------------------------------- */
/*                                   Reads                                    */
/* -------------------------------------------------------------------------- */

export const listRuns = async (query, req) => {
  const { page, limit, skip } = buildPagination(query);
  const sort = buildSort(query, RUN_SORTABLE_FIELDS, { year: -1, month: -1 });

  const filter = { tenantId: req.user.tenantId ?? null };
  if (query.status) filter.status = query.status;
  if (query.year) filter.year = query.year;

  const { items, total } = await payrollRepository.listRuns({ filter, sort, skip, limit });
  return { items, total, page, limit };
};

export const getRun = async (runId, req) => {
  const run = await payrollRepository.findRunById(runId);
  if (!run) throw ApiError.notFound('Payroll run not found');

  const callerTenant = req.user.tenantId ?? null;
  if (callerTenant !== null && String(run.tenantId) !== callerTenant) {
    throw ApiError.notFound('Payroll run not found');
  }

  return run.toObject({ virtuals: true });
};

/**
 * Payslip listing, scope-aware.
 *
 * An employee sees only their own; a manager their team's; payroll the tenant.
 * Salary is the most sensitive data in the system, so the scope is applied
 * before any client filter rather than alongside it.
 */
export const listPayslips = async (query, req) => {
  const { page, limit, skip } = buildPagination(query);

  /**
   * `period` is stored as "July 2026", so ordering by that string would read
   * April, August, December -- alphabetical, not chronological. The column
   * means the pay period, and the pay period IS (year, month), which is also
   * this list's existing default order. Sorting by it therefore resolves to
   * the same pair rather than to the label that displays it.
   */
  const direction = query.sortOrder === 'asc' ? 1 : -1;
  const sort =
    query.sortBy === 'period'
      ? { year: direction, month: direction }
      : buildSort(query, PAYSLIP_SORTABLE_FIELDS, { year: -1, month: -1 });

  const filter = { tenantId: req.user.tenantId ?? null };
  if (query.payrollRunId) filter.payrollRunId = query.payrollRunId;
  if (query.year) filter.year = query.year;
  if (query.month) filter.month = query.month;
  if (query.status) filter.status = query.status;

  const scope = buildScopeFilter(req, {
    ownerField: '_id',
    managerField: 'reportingManagerId',
    departmentField: 'departmentId',
    resource: RESOURCES.PAYROLL,
  });

  if (scope._id !== undefined || scope.reportingManagerId !== undefined || scope.departmentId !== undefined) {
    const employees = await Employee.find({ ...scope, deletedAt: null }).select('_id').lean();
    filter.employeeId = { $in: employees.map((employee) => employee._id) };
  } else if (query.employeeId) {
    filter.employeeId = query.employeeId;
  }

  const { items, total } = await payrollRepository.listPayslips({ filter, sort, skip, limit });
  return { items, total, page, limit };
};

export const getPayslip = async (payslipId, req) => {
  const payslip = await payrollRepository.findPayslipById(payslipId);
  if (!payslip) throw ApiError.notFound('Payslip not found');

  const callerTenant = req.user.tenantId ?? null;
  if (callerTenant !== null && String(payslip.tenantId) !== callerTenant) {
    throw ApiError.notFound('Payslip not found');
  }

  // An employee may read only their own slip, whatever else their role allows.
  const scope = buildScopeFilter(req, { ownerField: '_id', resource: RESOURCES.PAYROLL });
  if (scope._id !== undefined && String(payslip.employeeId?._id ?? payslip.employeeId) !== String(scope._id)) {
    throw ApiError.forbidden('You can only view your own payslip');
  }

  return payslip;
};

export const holdPayslip = async (payslipId, { hold, reason }, req) => {
  const payslip = await getPayslip(payslipId, req);
  const run = await payrollRepository.findRunById(payslip.payrollRunId);

  if (run && !EDITABLE_PAYROLL_STATUSES.includes(run.status)) {
    throw ApiError.badRequest('This payroll run is closed and payslips can no longer be held');
  }

  const updated = await payrollRepository.updatePayslip(payslipId, {
    $set: {
      status: hold ? PAYSLIP_STATUS.ON_HOLD : PAYSLIP_STATUS.DRAFT,
      holdReason: hold ? reason : null,
    },
  });

  await recordAudit({
    req,
    entity: 'Payslip',
    entityId: payslipId,
    action: AUDIT_ACTIONS.STATUS_CHANGE,
    metadata: { hold, reason },
  });

  return updated;
};

/* -------------------------------------------------------------------------- */
/*                              Outputs                                       */
/* -------------------------------------------------------------------------- */

export const generatePayslipPdf = async (payslipId, req) => {
  const payslip = await getPayslip(payslipId, req);
  const settings = await payrollRepository.findSettings(req.user.tenantId ?? null);

  const buffer = await buildPayslipPdf(payslip.toObject ? payslip.toObject() : payslip, {
    name: settings?.bank?.companyName ?? 'HRMS',
    currency: settings?.currency ?? CURRENCY.CODE,
  });

  return {
    buffer,
    filename: `payslip-${payslip.employeeSnapshot?.employeeCode ?? 'employee'}-${payslip.year}-${String(
      payslip.month,
    ).padStart(2, '0')}.pdf`,
  };
};

/**
 * Bank transfer file for an approved run.
 *
 * Account numbers are read from the live employee record, not the payslip
 * snapshot -- the snapshot stores them masked, and a bank file needs the real
 * value. Held payslips are excluded by the query, not by the file builder.
 */
export const generateBankFile = async (runId, { format = null } = {}, req) => {
  const run = await getRun(runId, req);

  if (![PAYROLL_STATUS.APPROVED, PAYROLL_STATUS.PAID].includes(run.status)) {
    throw ApiError.badRequest('A bank transfer file can only be generated from an approved run');
  }

  const payslips = await payrollRepository.findPayslipsForRun(run._id, {
    status: { $ne: PAYSLIP_STATUS.ON_HOLD },
  });

  const employees = await Employee.find({ _id: { $in: payslips.map((slip) => slip.employeeId) } })
    .select('employeeCode firstName lastName bankDetails')
    .lean();

  const bankByEmployee = new Map(employees.map((employee) => [String(employee._id), employee]));

  const entries = payslips.map((payslip) => {
    const employee = bankByEmployee.get(String(payslip.employeeId));
    return {
      employeeCode: payslip.employeeSnapshot?.employeeCode,
      fullName: payslip.employeeSnapshot?.fullName,
      bankName: employee?.bankDetails?.bankName ?? null,
      accountNumber: employee?.bankDetails?.accountNumber ?? null,
      swiftCode: employee?.bankDetails?.swiftCode ?? null,
      branchCode: employee?.bankDetails?.branchCode ?? null,
      netPayable: payslip.netPayable,
    };
  });

  const settings = (await payrollRepository.findSettings(req.user.tenantId ?? null)) ?? {};
  const file = buildBankTransferFile({ entries, settings, period: run.period, format });

  await recordAudit({
    req,
    entity: ENTITY,
    entityId: run._id,
    entityLabel: run.period,
    action: AUDIT_ACTIONS.EXPORT,
    metadata: {
      output: 'BANK_FILE',
      format: file.format,
      included: file.included,
      skipped: file.skipped.length,
      totalAmount: file.totalAmount,
    },
  });

  logger.info('Bank transfer file generated', {
    period: run.period,
    included: file.included,
    skipped: file.skipped.length,
  });

  return file;
};

export default {
  processRun,
  submitRun,
  approveRun,
  markPaid,
  cancelRun,
  listRuns,
  getRun,
  listPayslips,
  getPayslip,
  holdPayslip,
  generatePayslipPdf,
  generateBankFile,
  RUN_SORTABLE_FIELDS,
  PAYSLIP_SORTABLE_FIELDS,
};
