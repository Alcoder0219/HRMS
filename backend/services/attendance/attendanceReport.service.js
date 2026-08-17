import mongoose from 'mongoose';
import { AUDIT_ACTIONS, ATTENDANCE_STATUS, RESOURCES } from '../../utils/constants.js';
import attendanceRepository from '../../repositories/attendance/attendance.repository.js';
import Employee from '../../models/employee/employee.model.js';
import { startOfDay } from '../../helpers/attendanceRules.helper.js';
import { dutyMinutesFor } from '../../helpers/manualAttendance.helper.js';
import { weeklyOffDaysByEmployee } from './weeklyOff.service.js';
import { buildWorkbook } from '../../helpers/excel.helper.js';
import { buildTablePdf } from '../../helpers/pdf.helper.js';
import { recordAudit } from '../../helpers/audit.helper.js';
import { buildScopeFilter } from '../../helpers/permission.helper.js';

/**
 * Monthly attendance reporting.
 *
 * Every report here honours the caller's RBAC scope. A report that ignored it
 * would be the simplest possible bypass -- a manager exporting the whole
 * organisation's attendance from a screen that only shows them their team.
 */

/** Single-letter codes for the monthly matrix, where a cell is ~14px wide. */
const STATUS_CODE = {
  [ATTENDANCE_STATUS.PRESENT]: 'P',
  [ATTENDANCE_STATUS.HALF_DAY]: 'H',
  [ATTENDANCE_STATUS.ABSENT]: 'A',
  [ATTENDANCE_STATUS.ON_LEAVE]: 'L',
  [ATTENDANCE_STATUS.HOLIDAY]: 'HO',
  [ATTENDANCE_STATUS.WEEKLY_OFF]: 'WO',
  [ATTENDANCE_STATUS.MISSING_PUNCH]: 'MP',
  [ATTENDANCE_STATUS.ON_DUTY]: 'OD',
  [ATTENDANCE_STATUS.WORK_FROM_HOME]: 'WFH',
};

const monthWindow = (year, month) => ({
  from: startOfDay(new Date(year, month - 1, 1)),
  to: startOfDay(new Date(year, month, 0)),
  daysInMonth: new Date(year, month, 0).getDate(),
});

/** Employees this caller may see, already narrowed by scope and filters. */
const scopedEmployees = async (req, filters = {}) => {
  const scope = buildScopeFilter(req, {
    ownerField: '_id',
    managerField: 'reportingManagerId',
    departmentField: 'departmentId',
    resource: RESOURCES.EMPLOYEE,
  });

  const filter = { ...scope, deletedAt: null };
  if (filters.departmentId) filter.departmentId = new mongoose.Types.ObjectId(String(filters.departmentId));
  if (filters.unitId) filter.unitId = new mongoose.Types.ObjectId(String(filters.unitId));
  if (filters.employeeId) filter._id = new mongoose.Types.ObjectId(String(filters.employeeId));

  return Employee.find(filter)
    // `employeeId` and `unitId` added for the import-era reports, which key on
    // the uploaded identifier and group by site.
    // `shiftId` and `overtimeEligible` added for the monthly overtime column:
    // the row shows the shift it was measured against, and distinguishes "no
    // overtime worked" from "not on an overtime contract".
    // `tenantId` and the shift's `weeklyOffs` are here for the weekly-off
    // overtime rule: the register reports it and the edit dialog previews it,
    // and both need to know which weekday this employee actually rests on.
    .select(
      'employeeCode employeeId firstName lastName tenantId departmentId designationId unitId shiftId overtimeEligible standardDutyMinutes',
    )
    .populate([
      { path: 'departmentId', select: 'name code' },
      { path: 'designationId', select: 'name code' },
      { path: 'unitId', select: 'name code' },
      { path: 'shiftId', select: 'name code startTime endTime weeklyOffs' },
    ])
    .sort({ employeeCode: 1 })
    .lean();
};

/* -------------------------------------------------------------------------- */
/*                             Monthly register                               */
/* -------------------------------------------------------------------------- */

/**
 * The employees × days matrix.
 *
 * One query for the whole month rather than one per employee: at 500 people
 * that is the difference between 1 round trip and 500.
 */
export const monthlyRegister = async ({ year, month, departmentId, employeeId }, req) => {
  const { from, to, daysInMonth } = monthWindow(year, month);
  const employees = await scopedEmployees(req, { departmentId, employeeId });

  if (!employees.length) {
    return { year, month, daysInMonth, employees: [], holidays: [] };
  }

  const employeeIds = employees.map((employee) => employee._id);

  /**
   * Each employee's rest days, resolved in a handful of queries for the whole
   * page.
   *
   * Reported so the edit dialog can show the corrected overtime for a weekly
   * off as the administrator types, instead of only after the save. The stored
   * figure it displays afterwards comes from the server, from the same rule.
   */
  const weeklyOffDays = await weeklyOffDaysByEmployee(employees, {
    tenantId: req.user.tenantId ?? null,
  });

  const [records, holidays] = await Promise.all([
    attendanceRepository.findRawForRange({
      employeeId: { $in: employeeIds },
      date: { $gte: from, $lte: to },
    }),
    attendanceRepository.findHolidays(req.user.tenantId ?? null, from, to),
  ]);

  const byEmployee = new Map();
  records.forEach((record) => {
    const key = String(record.employeeId);
    if (!byEmployee.has(key)) byEmployee.set(key, new Map());
    byEmployee.get(key).set(new Date(record.date).getDate(), record);
  });

  const rows = employees.map((employee) => {
    const dayMap = byEmployee.get(String(employee._id)) ?? new Map();
    const days = [];
    const totals = {
      present: 0,
      halfDay: 0,
      absent: 0,
      onLeave: 0,
      holiday: 0,
      weeklyOff: 0,
      missingPunch: 0,
      lateCount: 0,
      workedMinutes: 0,
      overtimeMinutes: 0,
      payableDays: 0,
    };

    for (let dayNumber = 1; dayNumber <= daysInMonth; dayNumber += 1) {
      const record = dayMap.get(dayNumber);

      days.push({
        day: dayNumber,
        status: record?.status ?? null,
        code: record ? (STATUS_CODE[record.status] ?? '-') : '-',
        workedMinutes: record?.workedMinutes ?? 0,
        lateMinutes: record?.lateMinutes ?? 0,
        overtimeMinutes: record?.overtimeMinutes ?? 0,
        isRegularized: record?.isRegularized ?? false,
      });

      if (!record) continue;

      totals.workedMinutes += record.workedMinutes ?? 0;
      totals.overtimeMinutes += record.overtimeMinutes ?? 0;
      if (record.lateMinutes > 0) totals.lateCount += 1;

      switch (record.status) {
        case ATTENDANCE_STATUS.PRESENT:
        case ATTENDANCE_STATUS.ON_DUTY:
        case ATTENDANCE_STATUS.WORK_FROM_HOME:
          totals.present += 1;
          totals.payableDays += 1;
          break;
        case ATTENDANCE_STATUS.HALF_DAY:
          totals.halfDay += 1;
          totals.payableDays += 0.5;
          break;
        case ATTENDANCE_STATUS.ABSENT:
          totals.absent += 1;
          break;
        case ATTENDANCE_STATUS.ON_LEAVE:
          totals.onLeave += 1;
          totals.payableDays += 1;
          break;
        case ATTENDANCE_STATUS.HOLIDAY:
          totals.holiday += 1;
          totals.payableDays += 1;
          break;
        case ATTENDANCE_STATUS.WEEKLY_OFF:
          totals.weeklyOff += 1;
          totals.payableDays += 1;
          break;
        case ATTENDANCE_STATUS.MISSING_PUNCH:
          totals.missingPunch += 1;
          break;
        default:
          break;
      }
    }

    return {
      employee: {
        id: String(employee._id),
        employeeCode: employee.employeeCode,
        employeeId: employee.employeeId ?? null,
        fullName: `${employee.firstName} ${employee.lastName}`,
        department: employee.departmentId?.name ?? null,
        designation: employee.designationId?.name ?? null,

        // Added so the overtime column can distinguish "worked no overtime"
        // from "not on an overtime contract", and so the register can be
        // filtered by shift without a second request.
        shiftId: employee.shiftId ? String(employee.shiftId._id ?? employee.shiftId) : null,
        shiftName: employee.shiftId?.name ?? null,
        overtimeEligible: Boolean(employee.overtimeEligible),
        standardDutyMinutes: dutyMinutesFor(employee),

        // 0 = Sunday. Whatever this employee's shift or policy says, not an
        // assumption that everybody rests on a Sunday.
        weeklyOffDays: weeklyOffDays.get(String(employee._id)) ?? [],
      },
      days,
      totals,
    };
  });

  return {
    year,
    month,
    daysInMonth,
    legend: STATUS_CODE,
    holidays: holidays.map((holiday) => ({
      day: new Date(holiday.date).getDate(),
      name: holiday.name,
    })),
    employees: rows,
  };
};

/* -------------------------------------------------------------------------- */
/*                              Summary reports                               */
/* -------------------------------------------------------------------------- */

/** Per-employee monthly totals, aggregated in the database. */
/**
 * Monthly attendance, one row per employee.
 *
 * The overtime figures are reported in BOTH minutes and hours. Hours were
 * already here and are kept for anything reading them, but a decimal hour
 * cannot express 01:15 without rounding it to 1.3 -- the screen renders
 * hours:minutes, so it needs the raw minutes.
 *
 * `hasOvertime`, `minOvertimeMinutes` and `shiftId` filter the assembled rows
 * rather than the aggregate. The set is one row per employee in scope, so
 * filtering in memory is cheaper than a second round trip and keeps the
 * totals consistent with what is shown.
 */
export const monthlySummary = async (
  { year, month, departmentId, shiftId, hasOvertime, minOvertimeMinutes },
  req,
) => {
  const { from, to } = monthWindow(year, month);
  const employees = await scopedEmployees(req, { departmentId });
  const employeeIds = employees.map((employee) => employee._id);

  const aggregate = await attendanceRepository.monthlyAggregate({
    employeeId: { $in: employeeIds },
    date: { $gte: from, $lte: to },
  });

  const byEmployee = new Map(aggregate.map((row) => [String(row._id), row]));

  const rows = employees.map((employee) => {
    const totals = byEmployee.get(String(employee._id)) ?? {};

    return {
      // `employeeId` now carries the employee's own ID, as it does in every
      // other report; the database reference moved to `_id`.
      _id: String(employee._id),
      employeeCode: employee.employeeCode,
      employeeId: employee.employeeId ?? null,
      fullName: `${employee.firstName} ${employee.lastName}`,
      department: employee.departmentId?.name ?? null,
      present: totals.present ?? 0,
      halfDay: totals.halfDay ?? 0,
      absent: totals.absent ?? 0,
      onLeave: totals.onLeave ?? 0,
      holiday: totals.holiday ?? 0,
      weeklyOff: totals.weeklyOff ?? 0,
      missingPunch: totals.missingPunch ?? 0,
      lateCount: totals.lateCount ?? 0,
      earlyGoingCount: totals.earlyGoingCount ?? 0,
      totalLateMinutes: totals.totalLateMinutes ?? 0,
      workedHours: Number(((totals.totalWorkedMinutes ?? 0) / 60).toFixed(1)),
      overtimeHours: Number(((totals.totalOvertimeMinutes ?? 0) / 60).toFixed(1)),

      // Exact minutes, so the screen can render hours:minutes without the
      // rounding a decimal hour forces.
      workedMinutes: totals.totalWorkedMinutes ?? 0,
      overtimeMinutes: totals.totalOvertimeMinutes ?? 0,

      // Pre-formatted for the exports, which have no view layer of their own.
      overtimeFormatted: toHoursMinutes(totals.totalOvertimeMinutes ?? 0),
      workedFormatted: toHoursMinutes(totals.totalWorkedMinutes ?? 0),

      // Carried so the row can explain a zero: no overtime worked, or none
      // creditable because the employee is not on an overtime contract.
      overtimeEligible: Boolean(employee.overtimeEligible),
      standardDutyMinutes: dutyMinutesFor(employee),
      shiftId: employee.shiftId ? String(employee.shiftId._id ?? employee.shiftId) : null,
      shiftName: employee.shiftId?.name ?? null,

      compOffEarnedDays: totals.compOffEarnedDays ?? 0,
      payableDays: (totals.present ?? 0) + (totals.halfDay ?? 0) * 0.5 + (totals.onLeave ?? 0) + (totals.holiday ?? 0) + (totals.weeklyOff ?? 0),
    };
  });

  const filtered = rows.filter((row) => {
    if (shiftId && row.shiftId !== String(shiftId)) return false;
    if (hasOvertime === true && row.overtimeMinutes <= 0) return false;
    if (hasOvertime === false && row.overtimeMinutes > 0) return false;
    if (minOvertimeMinutes > 0 && row.overtimeMinutes < minOvertimeMinutes) return false;
    return true;
  });

  return { year, month, rows: filtered };
};

/**
 * Days needing attention: missing punches, anomalies, and unresolved absences.
 * This is the queue HR works through before closing a month.
 */
export const exceptionReport = async ({ from, to, departmentId }, req) => {
  const employees = await scopedEmployees(req, { departmentId });
  const employeeIds = employees.map((employee) => employee._id);

  const records = await attendanceRepository.findForRange({
    employeeId: { $in: employeeIds },
    date: { $gte: startOfDay(from), $lte: startOfDay(to) },
    $or: [
      { status: ATTENDANCE_STATUS.MISSING_PUNCH },
      { anomalies: { $ne: [] } },
      { status: ATTENDANCE_STATUS.ABSENT, isRegularized: false },
    ],
  });

  return {
    total: records.length,
    items: records.map((record) => ({
      id: String(record._id),
      date: record.date,
      employeeCode: record.employeeId?.employeeCode ?? null,
      fullName: record.employeeId
        ? `${record.employeeId.firstName} ${record.employeeId.lastName}`
        : null,
      status: record.status,
      checkInAt: record.checkInAt,
      checkOutAt: record.checkOutAt,
      anomalies: record.anomalies,
      isRegularized: record.isRegularized,
    })),
  };
};

/**
 * Overtime by month for one year, for the dashboard's trend chart.
 *
 * A pure roll-up of the overtime already stored on each attendance day -- the
 * same `overtimeMinutes` the monthly register, the summary export and payroll
 * read. Nothing is recalculated here: there is one overtime rule in this system
 * and it runs when a day is written, not when a chart is drawn.
 *
 * It exists because the alternative was twelve monthly-summary requests to
 * render one line, which is a dashboard that takes a second to load and twelve
 * aggregations to answer a question one can.
 *
 * Months with no attendance are omitted rather than reported as zero: "nobody
 * worked overtime in March" and "March has not happened yet" are different
 * answers, and the caller can tell them apart from the months it gets back.
 */
export const overtimeTrend = async ({ year }, req) => {
  const employees = await scopedEmployees(req);
  if (!employees.length) return { year, months: [] };

  const from = startOfDay(new Date(year, 0, 1));
  const to = startOfDay(new Date(year, 11, 31));

  const days = await attendanceRepository.overtimeByDay({
    employeeId: { $in: employees.map((employee) => employee._id) },
    date: { $gte: from, $lte: to },
  });

  /**
   * Folded into months here rather than in the aggregation, because the month a
   * stored date belongs to is a local-time question and `$month` answers it in
   * UTC -- which puts every 1st of the month in the month before it for any
   * timezone ahead of Greenwich.
   */
  const buckets = new Map();

  days.forEach((day) => {
    const month = new Date(day._id).getMonth() + 1;
    if (!buckets.has(month)) buckets.set(month, { overtimeMinutes: 0, employees: new Set() });

    const bucket = buckets.get(month);
    bucket.overtimeMinutes += day.overtimeMinutes ?? 0;
    (day.employees ?? []).forEach((employeeId) => bucket.employees.add(String(employeeId)));
  });

  return {
    year,
    months: [...buckets.entries()]
      .map(([month, bucket]) => ({
        month,
        overtimeMinutes: bucket.overtimeMinutes,
        // How many people contributed, so "180 hours" can be read as thin or wide.
        employees: bucket.employees.size,
      }))
      .sort((a, b) => a.month - b.month),
  };
};

/* -------------------------------------------------------------------------- */
/*                                   Export                                   */
/* -------------------------------------------------------------------------- */

/**
 * Minutes as hours:minutes, zero-padded.
 *
 * Overtime is read as a duration, and 1.3 hours is not a duration anyone
 * recognises -- 01:18 is. Negative input is clamped rather than rendered as
 * "-1:-15", which is what a stray sign would otherwise produce.
 */
export const toHoursMinutes = (minutes) => {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(total / 60);
  return `${String(hours).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

const SUMMARY_COLUMNS = [
  { header: 'Employee Code', key: 'employeeCode', width: 16 },
  { header: 'Employee ID', key: 'employeeId', width: 14 },
  { header: 'Name', key: 'fullName', width: 26 },
  { header: 'Department', key: 'department', width: 20 },
  { header: 'Present', key: 'present', width: 10 },
  { header: 'Half Day', key: 'halfDay', width: 10 },
  { header: 'Absent', key: 'absent', width: 10 },
  { header: 'On Leave', key: 'onLeave', width: 10 },
  { header: 'Holiday', key: 'holiday', width: 10 },
  { header: 'Weekly Off', key: 'weeklyOff', width: 12 },
  { header: 'Missing Punch', key: 'missingPunch', width: 14 },
  { header: 'Late Count', key: 'lateCount', width: 12 },
  { header: 'Late Minutes', key: 'totalLateMinutes', width: 14 },
  { header: 'Worked Hours', key: 'workedHours', width: 14, format: '#,##0.0' },
  { header: 'Overtime Hours', key: 'overtimeHours', width: 15, format: '#,##0.0' },
  // The same overtime as hours:minutes. The decimal column is kept because a
  // spreadsheet can do arithmetic on it; this one is what a person reads.
  { header: 'Overtime (HH:MM)', key: 'overtimeFormatted', width: 17 },
  { header: 'Comp Off Earned', key: 'compOffEarnedDays', width: 16 },
  { header: 'Payable Days', key: 'payableDays', width: 14, format: '#,##0.0' },
];

export const exportMonthlySummary = async (query, req) => {
  // The whole query is forwarded, so an export reflects the filters that were
  // on screen rather than silently exporting everybody.
  const { rows } = await monthlySummary(query, req);
  const { year, month } = query;

  const buffer = await buildWorkbook({
    sheetName: `Attendance ${year}-${String(month).padStart(2, '0')}`,
    columns: SUMMARY_COLUMNS,
    rows,
    meta: { creator: req.user.email },
  });

  await recordAudit({
    req,
    entity: 'Attendance',
    entityId: new mongoose.Types.ObjectId(),
    action: AUDIT_ACTIONS.EXPORT,
    metadata: { report: 'MONTHLY_SUMMARY', year, month, rows: rows.length },
  });

  return { buffer, rowCount: rows.length };
};

/* -------------------------------------------------------------------------- */
/*                            Focused day reports                             */
/* -------------------------------------------------------------------------- */

/**
 * One aggregation serves the late-coming, early-going, overtime and absent
 * reports, because they differ only in the predicate and the column of
 * interest. Writing four near-identical pipelines would be four places to fix
 * the next time scope handling changes.
 */
const DAY_REPORTS = {
  LATE: { match: { lateMinutes: { $gt: 0 } }, metric: '$lateMinutes', label: 'Late minutes' },
  EARLY: { match: { earlyGoingMinutes: { $gt: 0 } }, metric: '$earlyGoingMinutes', label: 'Early minutes' },
  OVERTIME: { match: { overtimeMinutes: { $gt: 0 } }, metric: '$overtimeMinutes', label: 'Overtime minutes' },
  ABSENT: { match: { status: ATTENDANCE_STATUS.ABSENT }, metric: null, label: 'Absent days' },
  /**
   * Half days are a graded outcome rather than a minutes overrun, so like
   * ABSENT they count occurrences with no metric to total.
   *
   * The other four were reportable from the start and this was not, which left
   * the one question nobody could answer per-employee: who keeps ending up on
   * half a day, and how often.
   */
  HALF_DAY: { match: { status: ATTENDANCE_STATUS.HALF_DAY }, metric: null, label: 'Half days' },
};

export const dayReport = async ({ type, from, to, departmentId, unitId }, req) => {
  const definition = DAY_REPORTS[type];
  if (!definition) throw new Error(`Unknown report type: ${type}`);

  const employees = await scopedEmployees(req, { departmentId, unitId });
  const byId = new Map(employees.map((employee) => [String(employee._id), employee]));

  const records = await attendanceRepository.findRawForRange({
    employeeId: { $in: employees.map((employee) => employee._id) },
    date: { $gte: startOfDay(from), $lte: startOfDay(to) },
    ...definition.match,
  });

  const rows = records.map((record) => {
    const employee = byId.get(String(record.employeeId));
    return {
      date: record.date,
      employeeCode: employee?.employeeCode ?? null,
      employeeId: employee?.employeeId ?? null,
      fullName: employee ? `${employee.firstName} ${employee.lastName}` : null,
      department: employee?.departmentId?.name ?? null,
      status: record.status,
      checkInAt: record.checkInAt,
      checkOutAt: record.checkOutAt,
      lateMinutes: record.lateMinutes,
      earlyGoingMinutes: record.earlyGoingMinutes,
      overtimeMinutes: record.overtimeMinutes,
      workedMinutes: record.workedMinutes,
    };
  });

  // Per-employee roll-up alongside the detail, since both questions -- "who"
  // and "how often" -- are always asked of these reports together.
  const byEmployee = new Map();
  rows.forEach((row) => {
    const key = row.employeeCode ?? 'unknown';
    if (!byEmployee.has(key)) {
      byEmployee.set(key, {
        employeeCode: row.employeeCode,
        employeeId: row.employeeId,
        fullName: row.fullName,
        department: row.department,
        occurrences: 0,
        totalMinutes: 0,
      });
    }
    const entry = byEmployee.get(key);
    entry.occurrences += 1;
    entry.totalMinutes +=
      type === 'LATE' ? row.lateMinutes : type === 'EARLY' ? row.earlyGoingMinutes : type === 'OVERTIME' ? row.overtimeMinutes : 0;
  });

  return {
    type,
    label: definition.label,
    from,
    to,
    total: rows.length,
    rows: rows.slice(0, 5000),
    summary: [...byEmployee.values()].sort((a, b) => b.occurrences - a.occurrences),
  };
};

/**
 * Headcount and attendance rolled up by department or unit.
 *
 * `groupBy` decides which; the pipeline is otherwise identical, and the
 * employee scope is applied first so a manager sees only their own team's
 * contribution.
 */
export const groupedReport = async ({ year, month, groupBy = 'department' }, req) => {
  const { from, to } = monthWindow(year, month);
  const employees = await scopedEmployees(req);

  const groupOf = (employee) =>
    groupBy === 'unit'
      ? (employee.unitId?.name ?? 'Unassigned')
      : (employee.departmentId?.name ?? 'Unassigned');

  const byEmployee = new Map(employees.map((employee) => [String(employee._id), employee]));

  const records = await attendanceRepository.findRawForRange({
    employeeId: { $in: employees.map((employee) => employee._id) },
    date: { $gte: from, $lte: to },
  });

  const groups = new Map();
  employees.forEach((employee) => {
    const key = groupOf(employee);
    if (!groups.has(key)) {
      groups.set(key, {
        group: key, headcount: 0, present: 0, absent: 0, halfDay: 0,
        weeklyOff: 0, holiday: 0, lateCount: 0, workedMinutes: 0, overtimeMinutes: 0,
      });
    }
    groups.get(key).headcount += 1;
  });

  records.forEach((record) => {
    const employee = byEmployee.get(String(record.employeeId));
    if (!employee) return;

    const entry = groups.get(groupOf(employee));
    if (!entry) return;

    if (record.lateMinutes > 0) entry.lateCount += 1;
    entry.workedMinutes += record.workedMinutes ?? 0;
    entry.overtimeMinutes += record.overtimeMinutes ?? 0;

    switch (record.status) {
      case ATTENDANCE_STATUS.PRESENT: entry.present += 1; break;
      case ATTENDANCE_STATUS.ABSENT: entry.absent += 1; break;
      case ATTENDANCE_STATUS.HALF_DAY: entry.halfDay += 1; break;
      case ATTENDANCE_STATUS.WEEKLY_OFF: entry.weeklyOff += 1; break;
      case ATTENDANCE_STATUS.HOLIDAY: entry.holiday += 1; break;
      default: break;
    }
  });

  return {
    year,
    month,
    groupBy,
    rows: [...groups.values()]
      .map((entry) => ({
        ...entry,
        workedHours: Number((entry.workedMinutes / 60).toFixed(1)),
        overtimeHours: Number((entry.overtimeMinutes / 60).toFixed(1)),
        // The figure managers actually read: present as a share of days that
        // were expected to be worked.
        attendancePercent:
          entry.present + entry.absent + entry.halfDay > 0
            ? Number(
                (((entry.present + entry.halfDay * 0.5) / (entry.present + entry.absent + entry.halfDay)) * 100).toFixed(1),
              )
            : 0,
      }))
      .sort((a, b) => b.headcount - a.headcount),
  };
};

/* -------------------------------------------------------------------------- */
/*                                  Exports                                   */
/* -------------------------------------------------------------------------- */

const DAY_REPORT_COLUMNS = [
  { header: 'Date', key: 'date', width: 14 },
  { header: 'Employee Code', key: 'employeeCode', width: 16 },
  { header: 'Employee ID', key: 'employeeId', width: 16 },
  { header: 'Name', key: 'fullName', width: 26 },
  { header: 'Department', key: 'department', width: 20 },
  { header: 'Status', key: 'status', width: 16 },
  { header: 'Late Minutes', key: 'lateMinutes', width: 14 },
  { header: 'Early Minutes', key: 'earlyGoingMinutes', width: 14 },
  { header: 'Overtime Minutes', key: 'overtimeMinutes', width: 17 },
  { header: 'Worked Minutes', key: 'workedMinutes', width: 16 },
];

export const exportDayReport = async (params, req) => {
  const report = await dayReport(params, req);

  const buffer = await buildWorkbook({
    sheetName: `${params.type} report`.slice(0, 30),
    columns: DAY_REPORT_COLUMNS,
    rows: report.rows.map((row) => ({ ...row, date: new Date(row.date).toISOString().slice(0, 10) })),
    meta: { creator: req.user.email },
  });

  await recordAudit({
    req,
    entity: 'Attendance',
    entityId: new mongoose.Types.ObjectId(),
    action: AUDIT_ACTIONS.EXPORT,
    metadata: { report: params.type, rows: report.rows.length },
  });

  return { buffer, rowCount: report.rows.length };
};

/** Monthly summary as a PDF, for circulation rather than analysis. */
export const exportMonthlySummaryPdf = async (query, req) => {
  const { rows } = await monthlySummary(query, req);
  const { year, month } = query;

  const buffer = await buildTablePdf({
    title: 'Monthly Attendance Summary',
    subtitle: new Date(year, month - 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' }),
    columns: [
      { header: 'Code', key: 'employeeCode', width: 58 },
      { header: 'Emp ID', key: 'employeeId', width: 58 },
      { header: 'Name', key: 'fullName', width: 120 },
      { header: 'Dept', key: 'department', width: 80 },
      { header: 'P', key: 'present', width: 24, align: 'right' },
      { header: 'A', key: 'absent', width: 24, align: 'right' },
      { header: 'HD', key: 'halfDay', width: 26, align: 'right' },
      { header: 'Payable', key: 'payableDays', width: 44, align: 'right' },
      // Working hours sits beside overtime: overtime alone does not say
      // whether a short day or a long one produced it.
      { header: 'Worked hrs', key: 'workedHours', width: 52, align: 'right' },
      { header: 'OT', key: 'overtimeFormatted', width: 46, align: 'right' },
    ],
    rows,
    company: { name: 'HRMS' },
  });

  await recordAudit({
    req,
    entity: 'Attendance',
    entityId: new mongoose.Types.ObjectId(),
    action: AUDIT_ACTIONS.EXPORT,
    metadata: { report: 'MONTHLY_SUMMARY_PDF', year, month, rows: rows.length },
  });

  return { buffer, rowCount: rows.length };
};

export default {
  monthlyRegister,
  monthlySummary,
  overtimeTrend,
  exceptionReport,
  exportMonthlySummary,
  dayReport,
  groupedReport,
  exportDayReport,
  exportMonthlySummaryPdf,
  STATUS_CODE,
};
