import mongoose from 'mongoose';

import Employee from '../../models/employee/employee.model.js';
import Attendance from '../../models/attendance/attendance.model.js';
import LeaveRequest from '../../models/leave/leaveRequest.model.js';
import LeaveType from '../../models/leave/leaveType.model.js';
import Payslip from '../../models/payroll/payslip.model.js';
import PayrollRun from '../../models/payroll/payrollRun.model.js';
import Loan from '../../models/payroll/loan.model.js';
import Settlement from '../../models/payroll/settlement.model.js';
import Asset from '../../models/employee/asset.model.js';
import JobOpening from '../../models/recruitment/jobOpening.model.js';
import Candidate from '../../models/recruitment/candidate.model.js';
import Offer from '../../models/recruitment/offer.model.js';
import Department from '../../models/organization/department.model.js';
import Unit from '../../models/organization/unit.model.js';

import ApiError from '../../utils/ApiError.js';
import { buildScopeFilter, scopeFor } from '../../helpers/permission.helper.js';
import {
  RESOURCES,
  SCOPES,
  EMPLOYEE_STATUS,
  ATTENDANCE_STATUS,
  LEAVE_STATUS,
  LOAN_STATUS,
  LOAN_TYPES,
  SETTLEMENT_STATUS,
  SETTLEMENT_TRIGGER,
  ASSET_STATUS,
  ASSET_CATEGORY,
  CANDIDATE_STAGE,
  CANDIDATE_STAGE_ORDER,
  JOB_STATUS,
  OFFER_STATUS,
} from '../../utils/constants.js';

/**
 * Cross-module reporting.
 *
 * Every report answers the same four questions in the same shape -- what are
 * the headline numbers, what does the distribution look like, what are the
 * underlying rows, and what could I have filtered by -- so one screen renders
 * all of them and a ninth report needs no frontend work at all.
 *
 * Nothing here writes. The reports read the modules' own collections rather
 * than a reporting table, which costs a little query time and buys the
 * guarantee that a report can never disagree with the screen it came from.
 */

const tenantOf = (req) => req.user?.tenantId ?? null;

const oid = (value) => {
  if (!value) return null;
  return mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(String(value)) : null;
};

const round = (value, places = 2) => {
  const factor = 10 ** places;
  return Math.round((Number(value) || 0) * factor) / factor;
};

const percent = (part, whole) => (whole ? round((part / whole) * 100, 1) : 0);

const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/* -------------------------------------------------------------------------- */
/*                              Envelope builders                             */
/* -------------------------------------------------------------------------- */

const card = (label, value, options = {}) => ({
  label,
  value,
  format: options.format ?? 'number',
  caption: options.caption ?? null,
  color: options.color ?? 'default',
});

const chart = (key, title, type, series, options = {}) => ({
  key,
  title,
  type,
  valueFormat: options.valueFormat ?? 'number',
  caption: options.caption ?? null,
  series: (series ?? []).map((entry) => ({
    label: entry.label,
    value: round(entry.value ?? 0, 2),
    color: entry.color ?? null,
  })),
});

/**
 * Turns `{KEY: count}` into chart series in the order the enum declares.
 *
 * Enum order rather than count order on purpose: a status donut that reorders
 * itself as the numbers move is unreadable across two consecutive months.
 */
const seriesFromEnum = (enumObject, counts, labeller = null) =>
  Object.values(enumObject)
    .map((key) => ({ label: labeller ? labeller(key) : key, value: counts[key] ?? 0 }))
    .filter((entry) => entry.value > 0);

const countBy = (rows, key) =>
  rows.reduce((accumulator, row) => {
    const value = row[key] ?? 'UNKNOWN';
    accumulator[value] = (accumulator[value] ?? 0) + 1;
    return accumulator;
  }, {});

const sumBy = (rows, groupKey, valueKey) =>
  rows.reduce((accumulator, row) => {
    const value = row[groupKey] ?? 'UNKNOWN';
    accumulator[value] = (accumulator[value] ?? 0) + (Number(row[valueKey]) || 0);
    return accumulator;
  }, {});

/** Top N by value, with the tail folded into "Other" so a bar chart stays readable. */
const topN = (entries, limit = 8) => {
  const sorted = [...entries].sort((a, b) => b.value - a.value);
  if (sorted.length <= limit) return sorted;

  const head = sorted.slice(0, limit);
  const tail = sorted.slice(limit).reduce((total, entry) => total + entry.value, 0);
  return tail > 0 ? [...head, { label: 'Other', value: tail }] : head;
};

/* -------------------------------------------------------------------------- */
/*                            Shared lookup helpers                           */
/* -------------------------------------------------------------------------- */

const nameMap = async (Model, tenantId) => {
  const rows = await Model.find({ tenantId }).select('name').lean();
  return new Map(rows.map((row) => [String(row._id), row.name]));
};

/**
 * Employees matching the caller's reach and the requested filters, as a lookup
 * the other reports resolve against.
 *
 * Every report filters by department or unit, but only Employee carries those
 * fields -- attendance, leave, loans and settlements all reference the person.
 * Resolving once here keeps that join in a single place, and means a report is
 * never accidentally scoped by an employee filter it forgot to apply.
 *
 * The caller's scope is applied FIRST and cannot be widened by a query
 * parameter. A head of department holds `report:read`, and without this a
 * request for the payroll report would hand them every salary in the company.
 * Because every employee-derived report resolves through here, the restriction
 * cannot be forgotten by one of them.
 */
const employeeScope = async (query, { tenantId, req }) => {
  const reach = buildScopeFilter(req, {
    ownerField: '_id',
    managerField: 'reportingManagerId',
    departmentField: 'departmentId',
    resource: RESOURCES.REPORT,
  });
  delete reach.tenantId;

  const filter = { tenantId, deletedAt: null };

  if (query.departmentId) filter.departmentId = oid(query.departmentId);
  if (query.unitId) filter.unitId = oid(query.unitId);
  if (query.designationId) filter.designationId = oid(query.designationId);
  if (query.employeeId) filter._id = oid(query.employeeId);

  // Reach is applied as an additional condition rather than merged in, so a
  // query parameter naming another department cannot overwrite it. Both must
  // hold; asking for a department outside your reach returns nothing, which is
  // the correct answer rather than a quietly substituted one.
  const restricted = Object.keys(reach).length > 0;
  if (restricted) filter.$and = [reach];

  const employees = await Employee.find(filter)
    .select('employeeCode employeeId firstName lastName departmentId designationId unitId status joiningDate ctc salaryStructure.ctc lastWorkingDate')
    .lean();

  const byId = new Map(
    employees.map((employee) => [
      String(employee._id),
      {
        ...employee,
        fullName: `${employee.firstName ?? ''} ${employee.lastName ?? ''}`.trim(),
      },
    ]),
  );

  return {
    employees: [...byId.values()],
    ids: employees.map((employee) => employee._id),
    byId,
    /**
     * Whether the other collections must be restricted to these ids.
     *
     * True when the caller asked for a slice OR when their own reach is
     * narrower than the tenant. Without the second half, a head of department
     * would load only their own people here and then query every payslip in
     * the company anyway.
     */
    narrowed:
      restricted || Boolean(query.departmentId || query.unitId || query.designationId || query.employeeId),
  };
};

const employeeIdFilter = (scope) => (scope.narrowed ? { $in: scope.ids } : undefined);

const applyEmployeeScope = (filter, scope, field = 'employeeId') => {
  const constraint = employeeIdFilter(scope);
  if (constraint) filter[field] = constraint;
  return filter;
};

const dateRange = (query, { fromKey = 'from', toKey = 'to' } = {}) => {
  const range = {};
  if (query[fromKey]) range.$gte = new Date(`${query[fromKey]}T00:00:00.000Z`);
  if (query[toKey]) range.$lte = new Date(`${query[toKey]}T23:59:59.999Z`);
  return Object.keys(range).length ? range : null;
};

const enumOptions = (enumObject) => Object.values(enumObject).map((value) => ({ value, label: value }));

/* -------------------------------------------------------------------------- */
/*                                  Employees                                 */
/* -------------------------------------------------------------------------- */

const employeeReport = async (query, ctx) => {
  const { tenantId } = ctx;
  const scope = await employeeScope(query, ctx);
  let employees = scope.employees;

  if (query.status) employees = employees.filter((employee) => employee.status === query.status);

  const joinedRange = dateRange(query, { fromKey: 'joinedFrom', toKey: 'joinedTo' });
  if (joinedRange) {
    employees = employees.filter((employee) => {
      const joined = employee.joiningDate ? new Date(employee.joiningDate) : null;
      if (!joined) return false;
      if (joinedRange.$gte && joined < joinedRange.$gte) return false;
      if (joinedRange.$lte && joined > joinedRange.$lte) return false;
      return true;
    });
  }

  const [departments, units] = await Promise.all([nameMap(Department, tenantId), nameMap(Unit, tenantId)]);

  const decorated = employees.map((employee) => ({
    _id: employee._id,
    employeeCode: employee.employeeCode,
    employeeId: employee.employeeId,
    fullName: employee.fullName,
    department: departments.get(String(employee.departmentId)) ?? 'â€”',
    unit: units.get(String(employee.unitId)) ?? 'â€”',
    status: employee.status,
    joiningDate: employee.joiningDate,
    tenureYears: employee.joiningDate
      ? round((Date.now() - new Date(employee.joiningDate).getTime()) / (365.25 * 24 * 3600 * 1000), 1)
      : 0,
    ctc: employee.salaryStructure?.ctc ?? employee.ctc ?? 0,
  }));

  const statusCounts = countBy(decorated, 'status');
  const active = statusCounts[EMPLOYEE_STATUS.ACTIVE] ?? 0;
  const exits =
    (statusCounts[EMPLOYEE_STATUS.RESIGNED] ?? 0) +
    (statusCounts[EMPLOYEE_STATUS.TERMINATED] ?? 0) +
    (statusCounts[EMPLOYEE_STATUS.RETIRED] ?? 0);

  const avgTenure = decorated.length
    ? round(decorated.reduce((total, row) => total + row.tenureYears, 0) / decorated.length, 1)
    : 0;

  // Joiners over the trailing twelve months, oldest first, so the line reads
  // left to right the way a calendar does.
  const now = new Date();
  const joinerBuckets = [];
  for (let offset = 11; offset >= 0; offset -= 1) {
    const point = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    joinerBuckets.push({
      label: `${MONTH_LABELS[point.getMonth()]} ${String(point.getFullYear()).slice(2)}`,
      year: point.getFullYear(),
      month: point.getMonth(),
      value: 0,
    });
  }

  decorated.forEach((row) => {
    if (!row.joiningDate) return;
    const joined = new Date(row.joiningDate);
    const bucket = joinerBuckets.find(
      (entry) => entry.year === joined.getFullYear() && entry.month === joined.getMonth(),
    );
    if (bucket) bucket.value += 1;
  });

  return {
    summary: [
      card('Headcount', decorated.length),
      card('Active', active, { caption: `${percent(active, decorated.length)}% of headcount`, color: 'success' }),
      card('On probation', statusCounts[EMPLOYEE_STATUS.PROBATION] ?? 0, { color: 'info' }),
      card('Serving notice', statusCounts[EMPLOYEE_STATUS.NOTICE_PERIOD] ?? 0, { color: 'warning' }),
      card('Exited', exits, { color: 'error' }),
      card('Average tenure', avgTenure, { format: 'years' }),
    ],
    charts: [
      chart('status', 'Headcount by status', 'donut', seriesFromEnum(EMPLOYEE_STATUS, statusCounts)),
      chart(
        'department',
        'Headcount by department',
        'bar',
        topN(Object.entries(countBy(decorated, 'department')).map(([label, value]) => ({ label, value }))),
      ),
      chart(
        'unit',
        'Headcount by unit',
        'bar',
        topN(Object.entries(countBy(decorated, 'unit')).map(([label, value]) => ({ label, value }))),
      ),
      chart('joiners', 'Joiners (last 12 months)', 'line', joinerBuckets),
    ],
    rows: decorated,
  };
};

/* -------------------------------------------------------------------------- */
/*                                 Attendance                                 */
/* -------------------------------------------------------------------------- */

const attendanceReport = async (query, ctx) => {
  const { tenantId } = ctx;
  const scope = await employeeScope(query, ctx);

  const year = Number(query.year) || new Date().getFullYear();
  const month = Number(query.month) || new Date().getMonth() + 1;

  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

  const filter = applyEmployeeScope({ tenantId, date: { $gte: start, $lte: end } }, scope);
  if (query.status) filter.status = query.status;

  const records = await Attendance.find(filter)
    .select('employeeId date status lateMinutes earlyGoingMinutes overtimeMinutes workedMinutes')
    .lean();

  const statusCounts = countBy(records, 'status');

  // Per employee, because "who was absent nine times" is the question the
  // register cannot answer and this report exists for.
  const perEmployee = new Map();
  records.forEach((record) => {
    const key = String(record.employeeId);
    if (!perEmployee.has(key)) {
      const employee = scope.byId.get(key);
      perEmployee.set(key, {
        // The row's identity moved to `_id` so that `employeeId` can mean the
        // same thing here as in every other report: the employee's own ID, not
        // the database reference. The viewer already keys rows on `_id` first.
        _id: key,
        employeeCode: employee?.employeeCode ?? 'â€”',
        employeeId: employee?.employeeId ?? null,
        fullName: employee?.fullName ?? 'Unknown',
        present: 0,
        absent: 0,
        halfDay: 0,
        onLeave: 0,
        lateCount: 0,
        lateMinutes: 0,
        earlyGoingCount: 0,
        overtimeHours: 0,
        workedHours: 0,
      });
    }

    const row = perEmployee.get(key);
    if (record.status === ATTENDANCE_STATUS.PRESENT) row.present += 1;
    if (record.status === ATTENDANCE_STATUS.ABSENT) row.absent += 1;
    if (record.status === ATTENDANCE_STATUS.HALF_DAY) row.halfDay += 1;
    if (record.status === ATTENDANCE_STATUS.ON_LEAVE) row.onLeave += 1;
    if (record.lateMinutes > 0) {
      row.lateCount += 1;
      row.lateMinutes += record.lateMinutes;
    }
    if (record.earlyGoingMinutes > 0) row.earlyGoingCount += 1;
    row.overtimeHours += (record.overtimeMinutes ?? 0) / 60;
    row.workedHours += (record.workedMinutes ?? 0) / 60;
  });

  const rows = [...perEmployee.values()].map((row) => {
    const payable = row.present + row.halfDay * 0.5;
    const considered = row.present + row.absent + row.halfDay;
    return {
      ...row,
      overtimeHours: round(row.overtimeHours, 1),
      workedHours: round(row.workedHours, 1),
      payableDays: round(payable, 1),
      attendancePercent: percent(payable, considered),
    };
  });

  // Present headcount per calendar day drives the trend line.
  const daily = new Map();
  records.forEach((record) => {
    if (record.status !== ATTENDANCE_STATUS.PRESENT && record.status !== ATTENDANCE_STATUS.HALF_DAY) return;
    const day = new Date(record.date).getUTCDate();
    daily.set(day, (daily.get(day) ?? 0) + 1);
  });

  const trend = [];
  for (let day = 1; day <= end.getUTCDate(); day += 1) {
    trend.push({ label: String(day), value: daily.get(day) ?? 0 });
  }

  const totalOvertime = round(rows.reduce((total, row) => total + row.overtimeHours, 0), 1);
  const averageAttendance = rows.length
    ? round(rows.reduce((total, row) => total + row.attendancePercent, 0) / rows.length, 1)
    : 0;

  return {
    summary: [
      card('Employees', rows.length, { caption: `${MONTH_LABELS[month - 1]} ${year}` }),
      card('Present days', statusCounts[ATTENDANCE_STATUS.PRESENT] ?? 0, { color: 'success' }),
      card('Absent days', statusCounts[ATTENDANCE_STATUS.ABSENT] ?? 0, { color: 'error' }),
      card('Half days', statusCounts[ATTENDANCE_STATUS.HALF_DAY] ?? 0, { color: 'warning' }),
      card('Overtime', totalOvertime, { format: 'hours' }),
      card('Average attendance', averageAttendance, { format: 'percent', color: 'info' }),
    ],
    charts: [
      chart('mix', 'Day status mix', 'donut', seriesFromEnum(ATTENDANCE_STATUS, statusCounts)),
      chart(
        'late',
        'Most late arrivals',
        'bar',
        topN(rows.filter((row) => row.lateCount > 0).map((row) => ({ label: row.fullName, value: row.lateCount }))),
      ),
      chart('daily', 'Present headcount by day', 'line', trend, { caption: 'Present and half days' }),
      chart(
        'overtime',
        'Overtime hours by employee',
        'bar',
        topN(rows.filter((row) => row.overtimeHours > 0).map((row) => ({ label: row.fullName, value: row.overtimeHours }))),
        { valueFormat: 'hours' },
      ),
    ],
    rows,
  };
};

/* -------------------------------------------------------------------------- */
/*                                    Leave                                   */
/* -------------------------------------------------------------------------- */

const leaveModuleReport = async (query, ctx) => {
  const { tenantId } = ctx;
  const scope = await employeeScope(query, ctx);
  const year = Number(query.year) || new Date().getFullYear();

  const filter = applyEmployeeScope({ tenantId, year }, scope);
  if (query.status) filter.status = query.status;
  if (query.leaveTypeId) filter.leaveTypeId = oid(query.leaveTypeId);

  const [requests, types, departments] = await Promise.all([
    LeaveRequest.find(filter).select('employeeId leaveTypeId from to days status year requestNumber reason').lean(),
    LeaveType.find({ tenantId }).select('name code').lean(),
    nameMap(Department, tenantId),
  ]);

  const typeById = new Map(types.map((type) => [String(type._id), type]));

  const rows = requests.map((request) => {
    const employee = scope.byId.get(String(request.employeeId));
    return {
      _id: request._id,
      requestNumber: request.requestNumber,
      employeeCode: employee?.employeeCode ?? 'â€”',
      employeeId: employee?.employeeId ?? null,
      fullName: employee?.fullName ?? 'Unknown',
      department: departments.get(String(employee?.departmentId)) ?? 'â€”',
      leaveType: typeById.get(String(request.leaveTypeId))?.name ?? 'â€”',
      from: request.from,
      to: request.to,
      days: request.days,
      status: request.status,
      reason: request.reason,
    };
  });

  const statusCounts = countBy(rows, 'status');
  const approved = rows.filter((row) => row.status === LEAVE_STATUS.APPROVED);
  const daysTaken = round(approved.reduce((total, row) => total + row.days, 0), 1);

  // Approved days by month of the start date -- a leave spanning a month
  // boundary lands where it began, which is how the register reads it.
  const monthly = MONTH_LABELS.map((label) => ({ label, value: 0 }));
  approved.forEach((row) => {
    const index = new Date(row.from).getUTCMonth();
    monthly[index].value = round(monthly[index].value + row.days, 1);
  });

  return {
    summary: [
      card('Requests', rows.length, { caption: String(year) }),
      card('Approved', statusCounts[LEAVE_STATUS.APPROVED] ?? 0, { color: 'success' }),
      card('Pending', statusCounts[LEAVE_STATUS.PENDING] ?? 0, { color: 'warning' }),
      card('Rejected', statusCounts[LEAVE_STATUS.REJECTED] ?? 0, { color: 'error' }),
      card('Days taken', daysTaken, { format: 'days' }),
      card('Approval rate', percent(statusCounts[LEAVE_STATUS.APPROVED] ?? 0, rows.length), { format: 'percent' }),
    ],
    charts: [
      chart('status', 'Requests by status', 'donut', seriesFromEnum(LEAVE_STATUS, statusCounts)),
      chart(
        'type',
        'Approved days by leave type',
        'bar',
        topN(Object.entries(sumBy(approved, 'leaveType', 'days')).map(([label, value]) => ({ label, value: round(value, 1) }))),
        { valueFormat: 'days' },
      ),
      chart(
        'department',
        'Approved days by department',
        'bar',
        topN(Object.entries(sumBy(approved, 'department', 'days')).map(([label, value]) => ({ label, value: round(value, 1) }))),
        { valueFormat: 'days' },
      ),
      chart('monthly', 'Approved days by month', 'line', monthly, { valueFormat: 'days' }),
    ],
    rows,
  };
};

/* -------------------------------------------------------------------------- */
/*                                   Payroll                                  */
/* -------------------------------------------------------------------------- */

const payrollReport = async (query, ctx) => {
  const { tenantId } = ctx;
  const scope = await employeeScope(query, ctx);
  const year = Number(query.year) || new Date().getFullYear();

  const filter = applyEmployeeScope({ tenantId, year }, scope);
  if (query.month) filter.month = Number(query.month);
  if (query.payrollRunId) filter.payrollRunId = oid(query.payrollRunId);

  const [payslips, departments, runs] = await Promise.all([
    Payslip.find(filter)
      .select('employeeId year month period grossEarnings totalDeductions netPayable employerContributionTotal statutoryDetail status')
      .lean(),
    nameMap(Department, tenantId),
    PayrollRun.find({ tenantId, year }).select('year month period status totalNet').lean(),
  ]);

  const rows = payslips.map((payslip) => {
    const employee = scope.byId.get(String(payslip.employeeId));
    return {
      _id: payslip._id,
      employeeCode: employee?.employeeCode ?? 'â€”',
      employeeId: employee?.employeeId ?? null,
      fullName: employee?.fullName ?? 'Unknown',
      department: departments.get(String(employee?.departmentId)) ?? 'â€”',
      period: payslip.period,
      gross: round(payslip.grossEarnings),
      deductions: round(payslip.totalDeductions),
      net: round(payslip.netPayable),
      employerCost: round((payslip.grossEarnings ?? 0) + (payslip.employerContributionTotal ?? 0)),
      pf: round(payslip.statutoryDetail?.pf?.employee ?? 0),
      esi: round(payslip.statutoryDetail?.esi?.employee ?? 0),
      status: payslip.status,
    };
  });

  const totalGross = round(rows.reduce((total, row) => total + row.gross, 0));
  const totalNet = round(rows.reduce((total, row) => total + row.net, 0));
  const totalDeductions = round(rows.reduce((total, row) => total + row.deductions, 0));
  const totalCost = round(rows.reduce((total, row) => total + row.employerCost, 0));
  const paidHeads = new Set(rows.map((row) => row.employeeCode)).size;

  const monthly = MONTH_LABELS.map((label) => ({ label, value: 0 }));
  payslips.forEach((payslip) => {
    const index = (payslip.month ?? 1) - 1;
    if (monthly[index]) monthly[index].value = round(monthly[index].value + (payslip.netPayable ?? 0));
  });

  return {
    summary: [
      card('Employees paid', paidHeads, { caption: query.month ? `${MONTH_LABELS[query.month - 1]} ${year}` : String(year) }),
      card('Gross', totalGross, { format: 'currency' }),
      card('Deductions', totalDeductions, { format: 'currency', color: 'warning' }),
      card('Net paid', totalNet, { format: 'currency', color: 'success' }),
      card('Employer cost', totalCost, { format: 'currency', caption: 'Gross plus contributions' }),
      card('Average net', paidHeads ? round(totalNet / paidHeads) : 0, { format: 'currency' }),
    ],
    charts: [
      chart(
        'department',
        'Cost by department',
        'bar',
        topN(Object.entries(sumBy(rows, 'department', 'employerCost')).map(([label, value]) => ({ label, value: round(value) }))),
        { valueFormat: 'currency' },
      ),
      chart('trend', 'Net payout by month', 'line', monthly, { valueFormat: 'currency' }),
      chart(
        'split',
        'Gross split',
        'donut',
        [
          { label: 'Net paid', value: totalNet },
          { label: 'Deductions', value: totalDeductions },
        ],
        { valueFormat: 'currency' },
      ),
      chart(
        'statutory',
        'Statutory contributions',
        'bar',
        [
          { label: 'PF (employee)', value: round(rows.reduce((total, row) => total + row.pf, 0)) },
          { label: 'ESI (employee)', value: round(rows.reduce((total, row) => total + row.esi, 0)) },
        ].filter((entry) => entry.value > 0),
        { valueFormat: 'currency' },
      ),
    ],
    rows,
    breakdowns: [
      {
        key: 'runs',
        title: `Payroll runs in ${year}`,
        columns: [
          { key: 'period', label: 'Period' },
          { key: 'status', label: 'Status' },
          { key: 'totalNet', label: 'Net', align: 'right', format: 'currency' },
        ],
        rows: runs
          .sort((a, b) => a.month - b.month)
          .map((run) => ({ period: run.period, status: run.status, totalNet: round(run.totalNet) })),
      },
    ],
  };
};

/* -------------------------------------------------------------------------- */
/*                                 Recruitment                                */
/* -------------------------------------------------------------------------- */

const recruitmentReport = async (query, ctx) => {
  const { tenantId, req } = ctx;
  const filter = { tenantId };
  const applied = dateRange(query);
  if (applied) filter.appliedAt = applied;
  if (query.jobOpeningId) filter.jobOpeningId = oid(query.jobOpeningId);

  /**
   * Recruitment is the one report with no employee to scope through: a
   * candidate is not on the payroll. The requisition is the next best anchor.
   *
   * A head of department sees the openings raised for their department; a line
   * manager sees the ones they are hiring for. Anything narrower has no
   * meaningful slice, and rather than inventing one the report stays empty --
   * an honest nothing beats a plausible wrong number.
   */
  const jobFilter = { tenantId };
  const reach = scopeFor(req?.user?.role, RESOURCES.REPORT);

  if (reach === SCOPES.DEPARTMENT) {
    jobFilter.departmentId = req?.user?.departmentId ?? null;
  } else if (reach === SCOPES.TEAM || reach === SCOPES.SELF) {
    jobFilter.hiringManagerId = req?.user?.employeeId ?? req?.user?.id ?? null;
  }

  const jobs = await JobOpening.find(jobFilter).select('title code status vacancies filled departmentId').lean();

  const visibleJobIds = jobs.map((job) => job._id);
  const jobScoped = reach !== SCOPES.GLOBAL && reach !== SCOPES.TENANT;
  if (jobScoped) {
    // Intersect rather than overwrite, so an explicit jobOpeningId outside the
    // caller's reach returns nothing instead of that opening's pipeline.
    filter.jobOpeningId = query.jobOpeningId
      ? { $in: visibleJobIds.filter((id) => String(id) === String(query.jobOpeningId)) }
      : { $in: visibleJobIds };
  }

  const candidates = await Candidate.find(filter)
    .select('firstName lastName email stage source jobOpeningId appliedAt stageHistory')
    .lean();

  // Offers follow the candidates, so the "awaiting reply" card cannot count
  // offers made to people this caller may not see.
  const offerFilter = { tenantId };
  if (jobScoped) offerFilter.candidateId = { $in: candidates.map((candidate) => candidate._id) };

  const offers = await Offer.find(offerFilter).select('status candidateId joiningDate').lean();

  const jobById = new Map(jobs.map((job) => [String(job._id), job]));

  const rows = candidates.map((candidate) => {
    const job = jobById.get(String(candidate.jobOpeningId));
    return {
      _id: candidate._id,
      fullName: `${candidate.firstName ?? ''} ${candidate.lastName ?? ''}`.trim(),
      email: candidate.email,
      opening: job?.title ?? 'â€”',
      openingCode: job?.code ?? 'â€”',
      source: candidate.source ?? 'UNKNOWN',
      stage: candidate.stage,
      appliedOn: candidate.appliedAt,
    };
  });

  const stageCounts = countBy(rows, 'stage');

  /**
   * How far a candidate actually got.
   *
   * Current stage alone is not enough: REJECTED and WITHDRAWN are not points on
   * the funnel, so someone rejected after two interviews would vanish from it
   * entirely and the drop-off the report exists to show would read as zero.
   * The stage history carries the real high-water mark.
   *
   * Floored at APPLIED because a candidate record existing means they applied,
   * even if the history was never written -- an imported or legacy row must
   * still be counted at the top of the funnel rather than dropped.
   */
  const reachedIndex = (candidate) => {
    const seen = (candidate.stageHistory ?? [])
      .map((entry) => CANDIDATE_STAGE_ORDER.indexOf(entry.stage))
      .filter((index) => index >= 0);

    return Math.max(0, CANDIDATE_STAGE_ORDER.indexOf(candidate.stage), ...seen);
  };

  const reached = candidates.map(reachedIndex);

  const funnel = CANDIDATE_STAGE_ORDER.map((stage, index) => ({
    label: stage,
    value: reached.filter((furthest) => furthest >= index).length,
  }));

  const hired = stageCounts[CANDIDATE_STAGE.HIRED] ?? 0;
  const openJobs = jobs.filter((job) => job.status === JOB_STATUS.OPEN).length;
  const pendingOffers = offers.filter((offer) => offer.status === OFFER_STATUS.SENT).length;
  const vacancies = jobs.reduce((total, job) => total + (job.vacancies ?? 0), 0);
  const filled = jobs.reduce((total, job) => total + (job.filled ?? 0), 0);

  return {
    summary: [
      card('Candidates', rows.length),
      card('Hired', hired, { color: 'success', caption: `${percent(hired, rows.length)}% of applicants` }),
      card('Open roles', openJobs, { color: 'info' }),
      card('Offers awaiting reply', pendingOffers, { color: 'warning' }),
      card('Vacancies', vacancies),
      card('Seats filled', filled, { caption: `${percent(filled, vacancies)}% of vacancies` }),
    ],
    charts: [
      chart('funnel', 'Hiring funnel', 'bar', funnel, { caption: 'Candidates who reached at least this stage' }),
      chart('stage', 'Candidates by current stage', 'donut', seriesFromEnum(CANDIDATE_STAGE, stageCounts)),
      chart(
        'source',
        'Applications by source',
        'bar',
        topN(Object.entries(countBy(rows, 'source')).map(([label, value]) => ({ label, value }))),
      ),
      chart(
        'opening',
        'Applications by opening',
        'bar',
        topN(Object.entries(countBy(rows, 'opening')).map(([label, value]) => ({ label, value }))),
      ),
    ],
    rows,
  };
};

/* -------------------------------------------------------------------------- */
/*                                   Assets                                   */
/* -------------------------------------------------------------------------- */

const assetReport = async (query, ctx) => {
  const { tenantId } = ctx;
  const scope = await employeeScope(query, ctx);

  const filter = { tenantId };
  if (query.category) filter.category = query.category;
  if (query.status) filter.status = query.status;
  applyEmployeeScope(filter, scope, 'currentHolderId');

  const [assets, departments] = await Promise.all([
    Asset.find(filter)
      .select('assetCode name category status condition purchaseDate purchaseCost recoveryValue currentHolderId assignments')
      .lean(),
    nameMap(Department, tenantId),
  ]);

  const rows = assets.map((asset) => {
    const holder = asset.currentHolderId ? scope.byId.get(String(asset.currentHolderId)) : null;
    // `currentAssignment` is a virtual, and `.lean()` does not produce virtuals
    // without the lean-virtuals plugin this project does not use.
    const open = (asset.assignments ?? []).find((entry) => !entry.returnedOn) ?? null;

    return {
      _id: asset._id,
      assetCode: asset.assetCode,
      name: asset.name,
      category: asset.category,
      status: asset.status,
      condition: asset.condition,
      holder: holder?.fullName ?? 'â€”',
      holderCode: holder?.employeeCode ?? 'â€”',
      department: departments.get(String(holder?.departmentId)) ?? 'â€”',
      assignedOn: open?.assignedOn ?? null,
      purchaseCost: round(asset.purchaseCost),
      recoveryValue: round(asset.recoveryValue),
      assignmentCount: (asset.assignments ?? []).length,
    };
  });

  const statusCounts = countBy(rows, 'status');
  const assigned = statusCounts[ASSET_STATUS.ASSIGNED] ?? 0;
  const atRisk = (statusCounts[ASSET_STATUS.LOST] ?? 0) + (statusCounts[ASSET_STATUS.DAMAGED] ?? 0);
  const bookValue = round(rows.reduce((total, row) => total + row.purchaseCost, 0));

  // What the company would have to charge for if every issued item vanished.
  // Recovery value rather than purchase cost, because that is what settlement
  // actually deducts.
  const exposure = round(
    rows.filter((row) => row.status === ASSET_STATUS.ASSIGNED).reduce((total, row) => total + row.recoveryValue, 0),
  );

  return {
    summary: [
      card('Assets', rows.length),
      card('Issued', assigned, { color: 'info', caption: `${percent(assigned, rows.length)}% of register` }),
      card('Available', statusCounts[ASSET_STATUS.AVAILABLE] ?? 0, { color: 'success' }),
      card('Lost or damaged', atRisk, { color: 'error' }),
      card('Purchase value', bookValue, { format: 'currency' }),
      card('Recovery exposure', exposure, { format: 'currency', caption: 'Issued items, at recovery value' }),
    ],
    charts: [
      chart('status', 'Assets by status', 'donut', seriesFromEnum(ASSET_STATUS, statusCounts)),
      chart('category', 'Assets by category', 'bar', topN(
        Object.entries(countBy(rows, 'category')).map(([label, value]) => ({ label, value })),
      )),
      chart(
        'value',
        'Purchase value by category',
        'bar',
        topN(Object.entries(sumBy(rows, 'category', 'purchaseCost')).map(([label, value]) => ({ label, value: round(value) }))),
        { valueFormat: 'currency' },
      ),
      chart(
        'holding',
        'Items held by department',
        'bar',
        topN(
          Object.entries(countBy(rows.filter((row) => row.status === ASSET_STATUS.ASSIGNED), 'department')).map(
            ([label, value]) => ({ label, value }),
          ),
        ),
      ),
    ],
    rows,
  };
};

/* -------------------------------------------------------------------------- */
/*                                    Loans                                   */
/* -------------------------------------------------------------------------- */

const loanReport = async (query, ctx) => {
  const { tenantId } = ctx;
  const scope = await employeeScope(query, ctx);

  const filter = applyEmployeeScope({ tenantId }, scope);
  if (query.status) filter.status = query.status;
  if (query.type) filter.type = query.type;

  const [loans, departments] = await Promise.all([
    Loan.find(filter)
      .select('loanNumber employeeId type principal totalPayable emi tenureMonths outstanding recoveredAmount status isOnHold disbursedOn closedOn instalments')
      .lean(),
    nameMap(Department, tenantId),
  ]);

  const rows = loans.map((loan) => {
    const employee = scope.byId.get(String(loan.employeeId));
    const paid = (loan.instalments ?? []).filter((instalment) => instalment.status === 'PAID').length;

    return {
      _id: loan._id,
      loanNumber: loan.loanNumber,
      employeeCode: employee?.employeeCode ?? 'â€”',
      employeeId: employee?.employeeId ?? null,
      fullName: employee?.fullName ?? 'Unknown',
      department: departments.get(String(employee?.departmentId)) ?? 'â€”',
      type: loan.type,
      principal: round(loan.principal),
      totalPayable: round(loan.totalPayable),
      emi: round(loan.emi),
      tenureMonths: loan.tenureMonths,
      instalmentsPaid: paid,
      recoveredAmount: round(loan.recoveredAmount),
      outstanding: round(loan.outstanding),
      recoveredPercent: percent(loan.recoveredAmount, loan.totalPayable),
      status: loan.isOnHold ? 'ON_HOLD' : loan.status,
      disbursedOn: loan.disbursedOn,
    };
  });

  const statusCounts = countBy(rows, 'status');
  const live = rows.filter((row) => row.status === LOAN_STATUS.ACTIVE || row.status === LOAN_STATUS.DISBURSED);
  const disbursed = round(rows.reduce((total, row) => total + row.principal, 0));
  const recovered = round(rows.reduce((total, row) => total + row.recoveredAmount, 0));
  const outstanding = round(rows.reduce((total, row) => total + row.outstanding, 0));

  // Monthly EMI load counts live loans only -- a closed loan still carries an
  // EMI figure, and including it would overstate next month's recovery.
  const emiLoad = round(live.reduce((total, row) => total + row.emi, 0));

  return {
    summary: [
      card('Loans', rows.length),
      card('Live', live.length, { color: 'info' }),
      card('Disbursed', disbursed, { format: 'currency' }),
      card('Recovered', recovered, { format: 'currency', color: 'success', caption: `${percent(recovered, disbursed)}% of principal` }),
      card('Outstanding', outstanding, { format: 'currency', color: 'warning' }),
      card('Monthly EMI load', emiLoad, { format: 'currency', caption: 'Live loans only' }),
    ],
    charts: [
      chart('status', 'Loans by status', 'donut', seriesFromEnum(LOAN_STATUS, statusCounts)),
      chart(
        'type',
        'Outstanding by loan type',
        'bar',
        topN(Object.entries(sumBy(rows, 'type', 'outstanding')).map(([label, value]) => ({ label, value: round(value) }))),
        { valueFormat: 'currency' },
      ),
      chart(
        'recovery',
        'Recovered against outstanding',
        'donut',
        [
          { label: 'Recovered', value: recovered },
          { label: 'Outstanding', value: outstanding },
        ].filter((entry) => entry.value > 0),
        { valueFormat: 'currency' },
      ),
      chart(
        'department',
        'Outstanding by department',
        'bar',
        topN(Object.entries(sumBy(rows, 'department', 'outstanding')).map(([label, value]) => ({ label, value: round(value) }))),
        { valueFormat: 'currency' },
      ),
    ],
    rows,
  };
};

/* -------------------------------------------------------------------------- */
/*                                 Settlements                                */
/* -------------------------------------------------------------------------- */

const settlementReport = async (query, ctx) => {
  const { tenantId } = ctx;
  const scope = await employeeScope(query, ctx);

  const filter = applyEmployeeScope({ tenantId }, scope);
  if (query.status) filter.status = query.status;
  if (query.trigger) filter.trigger = query.trigger;

  const exited = dateRange(query);
  if (exited) filter.lastWorkingDate = exited;

  const [settlements, departments] = await Promise.all([
    Settlement.find(filter)
      .select('settlementNumber employeeId trigger lastWorkingDate joiningDate totalEarnings totalDeductions netSettlement payableTo recoverableAmount pendingAssetCount status createdAt paidAt service')
      .lean(),
    nameMap(Department, tenantId),
  ]);

  const rows = settlements.map((settlement) => {
    const employee = scope.byId.get(String(settlement.employeeId));
    const settledDays =
      settlement.paidAt && settlement.lastWorkingDate
        ? Math.max(
            0,
            Math.round(
              (new Date(settlement.paidAt).getTime() - new Date(settlement.lastWorkingDate).getTime()) /
                (24 * 3600 * 1000),
            ),
          )
        : null;

    return {
      _id: settlement._id,
      settlementNumber: settlement.settlementNumber,
      employeeCode: employee?.employeeCode ?? 'â€”',
      employeeId: employee?.employeeId ?? null,
      fullName: employee?.fullName ?? 'Unknown',
      department: departments.get(String(employee?.departmentId)) ?? 'â€”',
      trigger: settlement.trigger,
      lastWorkingDate: settlement.lastWorkingDate,
      serviceYears: round(settlement.service?.years ?? 0, 1),
      totalEarnings: round(settlement.totalEarnings),
      totalDeductions: round(settlement.totalDeductions),
      netSettlement: round(settlement.netSettlement),
      payableTo: settlement.payableTo,
      recoverableAmount: round(settlement.recoverableAmount),
      pendingAssetCount: settlement.pendingAssetCount ?? 0,
      status: settlement.status,
      settledInDays: settledDays,
    };
  });

  const statusCounts = countBy(rows, 'status');
  const pending =
    (statusCounts[SETTLEMENT_STATUS.PENDING_HR] ?? 0) +
    (statusCounts[SETTLEMENT_STATUS.PENDING_FINANCE] ?? 0) +
    (statusCounts[SETTLEMENT_STATUS.DRAFT] ?? 0);

  const netPayable = round(
    rows.filter((row) => row.payableTo === 'EMPLOYEE').reduce((total, row) => total + row.netSettlement, 0),
  );
  const recoverable = round(rows.reduce((total, row) => total + row.recoverableAmount, 0));

  const settled = rows.filter((row) => row.settledInDays !== null);
  const averageDays = settled.length
    ? Math.round(settled.reduce((total, row) => total + row.settledInDays, 0) / settled.length)
    : 0;

  const monthly = MONTH_LABELS.map((label) => ({ label, value: 0 }));
  rows.forEach((row) => {
    if (!row.lastWorkingDate) return;
    const index = new Date(row.lastWorkingDate).getUTCMonth();
    monthly[index].value = round(monthly[index].value + row.netSettlement);
  });

  return {
    summary: [
      card('Settlements', rows.length),
      card('Awaiting approval', pending, { color: 'warning' }),
      card('Paid', statusCounts[SETTLEMENT_STATUS.PAID] ?? 0, { color: 'success' }),
      card('Net payable', netPayable, { format: 'currency' }),
      card('Recoverable', recoverable, { format: 'currency', color: 'error', caption: 'Owed back to the company' }),
      card('Average time to settle', averageDays, { format: 'days', caption: 'Last working day to payment' }),
    ],
    charts: [
      chart('status', 'Settlements by status', 'donut', seriesFromEnum(SETTLEMENT_STATUS, statusCounts)),
      chart('trigger', 'Exits by reason', 'bar', seriesFromEnum(SETTLEMENT_TRIGGER, countBy(rows, 'trigger'))),
      chart('monthly', 'Net settlement by exit month', 'line', monthly, { valueFormat: 'currency' }),
      chart(
        'department',
        'Exits by department',
        'bar',
        topN(Object.entries(countBy(rows, 'department')).map(([label, value]) => ({ label, value }))),
      ),
    ],
    rows,
  };
};

/* -------------------------------------------------------------------------- */
/*                                  Registry                                  */
/* -------------------------------------------------------------------------- */

const filterField = (key, label, type, options = null, extra = {}) => ({
  key,
  label,
  type,
  options,
  ...extra,
});

const ORG_FILTERS = [
  filterField('departmentId', 'Department', 'department'),
  filterField('unitId', 'Unit', 'unit'),
];

/**
 * One descriptor per report. `columns` drives the table, the Excel sheet and
 * the PDF alike, so the three can never drift apart -- a column added here
 * appears in all three without touching the exporters.
 */
export const REPORTS = {
  employees: {
    label: 'Employee Report',
    description: 'Headcount, distribution and tenure across the organisation',
    icon: 'people',
    filters: [
      ...ORG_FILTERS,
      filterField('status', 'Status', 'select', enumOptions(EMPLOYEE_STATUS)),
      filterField('joinedFrom', 'Joined from', 'date'),
      filterField('joinedTo', 'Joined to', 'date'),
    ],
    columns: [
      { key: 'employeeCode', label: 'Code', width: 70 },
      { key: 'employeeId', label: 'Employee ID', width: 90 },
      { key: 'fullName', label: 'Name', width: 140 },
      { key: 'department', label: 'Department', width: 110 },
      { key: 'unit', label: 'Unit', width: 90 },
      { key: 'status', label: 'Status', width: 90, format: 'status' },
      { key: 'joiningDate', label: 'Joined', width: 80, format: 'date' },
      { key: 'tenureYears', label: 'Tenure', width: 60, align: 'right', format: 'years' },
      { key: 'ctc', label: 'CTC', width: 90, align: 'right', format: 'currency' },
    ],
    build: employeeReport,
  },

  attendance: {
    label: 'Attendance Report',
    description: 'Monthly presence, lateness, half days and overtime per employee',
    icon: 'attendance',
    filters: [
      ...ORG_FILTERS,
      filterField('year', 'Year', 'year'),
      filterField('month', 'Month', 'month'),
      filterField('status', 'Day status', 'select', enumOptions(ATTENDANCE_STATUS)),
    ],
    columns: [
      { key: 'employeeCode', label: 'Code', width: 70 },
      { key: 'employeeId', label: 'Employee ID', width: 90 },
      { key: 'fullName', label: 'Employee', width: 140 },
      { key: 'present', label: 'Present', width: 60, align: 'right' },
      { key: 'absent', label: 'Absent', width: 60, align: 'right' },
      { key: 'halfDay', label: 'Half day', width: 60, align: 'right' },
      { key: 'onLeave', label: 'Leave', width: 55, align: 'right' },
      { key: 'lateCount', label: 'Late', width: 50, align: 'right' },
      { key: 'earlyGoingCount', label: 'Early out', width: 65, align: 'right' },
      { key: 'overtimeHours', label: 'OT hrs', width: 60, align: 'right', format: 'hours' },
      { key: 'payableDays', label: 'Payable', width: 65, align: 'right', format: 'days' },
      { key: 'attendancePercent', label: 'Attendance', width: 75, align: 'right', format: 'percent' },
    ],
    build: attendanceReport,
  },

  leave: {
    label: 'Leave Report',
    description: 'Requests, approvals and days consumed by type and department',
    icon: 'leave',
    filters: [
      ...ORG_FILTERS,
      filterField('year', 'Year', 'year'),
      filterField('leaveTypeId', 'Leave type', 'leaveType'),
      filterField('status', 'Status', 'select', enumOptions(LEAVE_STATUS)),
    ],
    columns: [
      { key: 'requestNumber', label: 'Request', width: 80 },
      { key: 'employeeCode', label: 'Code', width: 65 },
      { key: 'employeeId', label: 'Employee ID', width: 85 },
      { key: 'fullName', label: 'Employee', width: 130 },
      { key: 'department', label: 'Department', width: 100 },
      { key: 'leaveType', label: 'Type', width: 100 },
      { key: 'from', label: 'From', width: 75, format: 'date' },
      { key: 'to', label: 'To', width: 75, format: 'date' },
      { key: 'days', label: 'Days', width: 50, align: 'right', format: 'days' },
      { key: 'status', label: 'Status', width: 80, format: 'status' },
    ],
    build: leaveModuleReport,
  },

  payroll: {
    label: 'Payroll Report',
    description: 'Gross, deductions, net and employer cost across payroll runs',
    icon: 'payroll',
    filters: [
      ...ORG_FILTERS,
      filterField('year', 'Year', 'year'),
      filterField('month', 'Month', 'month'),
    ],
    columns: [
      { key: 'employeeCode', label: 'Code', width: 65 },
      { key: 'employeeId', label: 'Employee ID', width: 85 },
      { key: 'fullName', label: 'Employee', width: 130 },
      { key: 'department', label: 'Department', width: 100 },
      { key: 'period', label: 'Period', width: 75 },
      { key: 'gross', label: 'Gross', width: 85, align: 'right', format: 'currency' },
      { key: 'deductions', label: 'Deductions', width: 85, align: 'right', format: 'currency' },
      { key: 'net', label: 'Net', width: 85, align: 'right', format: 'currency' },
      { key: 'employerCost', label: 'Cost to company', width: 95, align: 'right', format: 'currency' },
    ],
    build: payrollReport,
  },

  recruitment: {
    label: 'Recruitment Report',
    description: 'Funnel, sources and openings from application to hire',
    icon: 'recruitment',
    filters: [
      filterField('from', 'Applied from', 'date'),
      filterField('to', 'Applied to', 'date'),
      filterField('jobOpeningId', 'Opening', 'jobOpening'),
    ],
    columns: [
      { key: 'fullName', label: 'Candidate', width: 130 },
      { key: 'email', label: 'Email', width: 150 },
      { key: 'openingCode', label: 'Code', width: 70 },
      { key: 'opening', label: 'Opening', width: 130 },
      { key: 'source', label: 'Source', width: 90 },
      { key: 'stage', label: 'Stage', width: 85, format: 'status' },
      { key: 'appliedOn', label: 'Applied', width: 80, format: 'date' },
    ],
    build: recruitmentReport,
  },

  assets: {
    label: 'Asset Report',
    description: 'Register, custody and recovery exposure across company assets',
    icon: 'assets',
    filters: [
      ...ORG_FILTERS,
      filterField('category', 'Category', 'select', enumOptions(ASSET_CATEGORY)),
      filterField('status', 'Status', 'select', enumOptions(ASSET_STATUS)),
    ],
    columns: [
      { key: 'assetCode', label: 'Code', width: 70 },
      { key: 'name', label: 'Asset', width: 130 },
      { key: 'category', label: 'Category', width: 85, format: 'status' },
      { key: 'status', label: 'Status', width: 80, format: 'status' },
      { key: 'holderCode', label: 'Holder code', width: 75 },
      { key: 'holder', label: 'Held by', width: 120 },
      { key: 'department', label: 'Department', width: 100 },
      { key: 'assignedOn', label: 'Issued', width: 75, format: 'date' },
      { key: 'purchaseCost', label: 'Cost', width: 80, align: 'right', format: 'currency' },
      { key: 'recoveryValue', label: 'Recovery', width: 80, align: 'right', format: 'currency' },
    ],
    build: assetReport,
  },

  loans: {
    label: 'Loan Report',
    description: 'Disbursement, recovery progress and outstanding balances',
    icon: 'loans',
    filters: [
      ...ORG_FILTERS,
      filterField('status', 'Status', 'select', enumOptions(LOAN_STATUS)),
      filterField('type', 'Loan type', 'select', enumOptions(LOAN_TYPES)),
    ],
    columns: [
      { key: 'loanNumber', label: 'Loan', width: 80 },
      { key: 'employeeCode', label: 'Code', width: 65 },
      { key: 'employeeId', label: 'Employee ID', width: 85 },
      { key: 'fullName', label: 'Employee', width: 125 },
      { key: 'department', label: 'Department', width: 95 },
      { key: 'type', label: 'Type', width: 90, format: 'status' },
      { key: 'principal', label: 'Principal', width: 80, align: 'right', format: 'currency' },
      { key: 'emi', label: 'EMI', width: 70, align: 'right', format: 'currency' },
      { key: 'instalmentsPaid', label: 'Paid', width: 45, align: 'right' },
      { key: 'recoveredAmount', label: 'Recovered', width: 85, align: 'right', format: 'currency' },
      { key: 'outstanding', label: 'Outstanding', width: 85, align: 'right', format: 'currency' },
      { key: 'status', label: 'Status', width: 80, format: 'status' },
    ],
    build: loanReport,
  },

  settlements: {
    label: 'Settlement Report',
    description: 'Full and final settlements, recoveries and time to close',
    icon: 'settlements',
    filters: [
      ...ORG_FILTERS,
      filterField('status', 'Status', 'select', enumOptions(SETTLEMENT_STATUS)),
      filterField('trigger', 'Exit reason', 'select', enumOptions(SETTLEMENT_TRIGGER)),
      filterField('from', 'Last working day from', 'date'),
      filterField('to', 'Last working day to', 'date'),
    ],
    columns: [
      { key: 'settlementNumber', label: 'Number', width: 80 },
      { key: 'employeeCode', label: 'Code', width: 65 },
      { key: 'employeeId', label: 'Employee ID', width: 85 },
      { key: 'fullName', label: 'Employee', width: 125 },
      { key: 'department', label: 'Department', width: 95 },
      { key: 'trigger', label: 'Reason', width: 95, format: 'status' },
      { key: 'lastWorkingDate', label: 'Last day', width: 75, format: 'date' },
      { key: 'serviceYears', label: 'Service', width: 60, align: 'right', format: 'years' },
      { key: 'totalEarnings', label: 'Earnings', width: 85, align: 'right', format: 'currency' },
      { key: 'totalDeductions', label: 'Deductions', width: 85, align: 'right', format: 'currency' },
      { key: 'netSettlement', label: 'Net', width: 85, align: 'right', format: 'currency' },
      { key: 'status', label: 'Status', width: 85, format: 'status' },
    ],
    build: settlementReport,
  },
};

export const REPORT_SLUGS = Object.keys(REPORTS);

const descriptorOf = (slug) => {
  const descriptor = REPORTS[slug];
  if (!descriptor) throw ApiError.notFound(`No report named "${slug}"`);
  return descriptor;
};

/** The catalog the hub screen renders, without running a single aggregation. */
export const getCatalog = () =>
  REPORT_SLUGS.map((slug) => ({
    slug,
    label: REPORTS[slug].label,
    description: REPORTS[slug].description,
    icon: REPORTS[slug].icon,
    filters: REPORTS[slug].filters,
    columns: REPORTS[slug].columns,
  }));

/**
 * Runs a report and returns the full envelope.
 *
 * Rows are paginated after the aggregation rather than inside it: the summary
 * cards and charts describe the whole filtered set, and slicing first would
 * make them describe whichever twenty-five rows happened to be on screen.
 */
export const runReport = async (slug, query, req) => {
  const descriptor = descriptorOf(slug);

  const result = await descriptor.build(query ?? {}, { tenantId: tenantOf(req), req });

  const page = Math.max(1, Number(query?.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(query?.limit) || 25));

  const sortBy = query?.sortBy;
  let rows = result.rows ?? [];

  if (sortBy && descriptor.columns.some((column) => column.key === sortBy)) {
    const direction = query?.sortOrder === 'asc' ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      const left = a[sortBy];
      const right = b[sortBy];
      if (left === right) return 0;
      if (left === null || left === undefined) return 1;
      if (right === null || right === undefined) return -1;
      return (left > right ? 1 : -1) * direction;
    });
  }

  const total = rows.length;

  return {
    slug,
    label: descriptor.label,
    description: descriptor.description,
    generatedAt: new Date(),
    filters: descriptor.filters,
    filtersApplied: query ?? {},
    summary: result.summary,
    charts: (result.charts ?? []).filter((entry) => entry.series.length > 0),
    columns: descriptor.columns,
    breakdowns: result.breakdowns ?? [],
    rows: rows.slice((page - 1) * limit, page * limit),
    meta: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
  };
};

/** Every matching row, unpaginated. Only the exporters use this. */
export const runReportForExport = async (slug, query, req) => {
  const descriptor = descriptorOf(slug);
  const result = await descriptor.build(query ?? {}, { tenantId: tenantOf(req), req });

  return {
    label: descriptor.label,
    columns: descriptor.columns,
    summary: result.summary,
    rows: result.rows ?? [],
  };
};

export default { REPORTS, REPORT_SLUGS, getCatalog, runReport, runReportForExport };
