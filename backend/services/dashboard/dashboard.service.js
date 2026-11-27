import mongoose from 'mongoose';

import ApiError from '../../utils/ApiError.js';
import {
  ACTIONS,
  ACTIVE_EMPLOYEE_STATUSES,
  ATTENDANCE_STATUS,
  EMPLOYEE_STATUS,
  LEAVE_STATUS,
  PAYROLL_STATUS,
  REGULARIZATION_STATUS,
  RESOURCES,
  SCOPES,
} from '../../utils/constants.js';
import Employee from '../../models/employee/employee.model.js';
import Unit from '../../models/organization/unit.model.js';
import Department from '../../models/organization/department.model.js';
import Attendance from '../../models/attendance/attendance.model.js';
import Regularization from '../../models/attendance/regularization.model.js';
import LeaveRequest from '../../models/leave/leaveRequest.model.js';
import PayrollRun from '../../models/payroll/payrollRun.model.js';
import attendanceRepository from '../../repositories/attendance/attendance.repository.js';
import { buildScopeFilter, can, hasScopeAtLeast } from '../../helpers/permission.helper.js';
import { unitAllowed, unitDenied, visibleEmployeeIds } from '../../helpers/unitScope.helper.js';
import { startOfDay } from '../../helpers/attendanceRules.helper.js';
import { monthlySummary } from '../attendance/attendanceReport.service.js';
import { weeklyOffDaysByEmployee } from '../attendance/weeklyOff.service.js';
import { salaryRegister } from '../payroll/payrollReport.service.js';

/**
 * The dashboard's figures, one section per module.
 *
 * Nothing here is a second calculation of anything. Attendance totals are the
 * monthly attendance summary's own rows; salary is the salary register's own
 * rows, which are read off the stored payslips; leave and headcount are counts
 * of the records those modules keep. What this service adds is the one thing
 * the module endpoints cannot do together: apply the dashboard's Unit and
 * Department filters to every section the same way, in the database, and
 * return totals rather than records.
 *
 * Each section checks the same permission the module itself demands, and every
 * query is narrowed by the caller's scope and unit before anything is counted
 * -- the filters can only narrow that further. A unit outside the caller's own
 * is refused (403).
 */

const toObjectId = (value) => new mongoose.Types.ObjectId(String(value));
const idOf = (value) => (value ? String(value._id ?? value) : null);
const tenantOf = (req) => req.user?.tenantId ?? null;

const forbidden = (resource) =>
  new ApiError(403, `You do not have access to ${resource} figures`, { code: 'RBAC_PERMISSION_DENIED' });

const assertCan = (req, resource, action = ACTIONS.READ) => {
  if (!can(req.user?.role, resource, action)) throw forbidden(resource);
};

/**
 * The employees the Unit and Department filters select, ignoring scope: every
 * section intersects this with its own scoped set, so it can only narrow.
 * Null when neither filter is set.
 */
const filteredEmployees = async (req, { unitId, departmentId }) => {
  if (unitId && !unitAllowed(req, unitId)) {
    throw unitDenied(req, { requestedUnit: String(unitId) }, 'You do not have access to that unit');
  }
  if (!unitId && !departmentId) return null;

  return Employee.find({
    tenantId: tenantOf(req),
    ...(unitId ? { unitId: toObjectId(unitId) } : {}),
    ...(departmentId ? { departmentId: toObjectId(departmentId) } : {}),
  })
    .select('_id employeeCode')
    .lean();
};

/** Employee ids a section may count: its own scope, narrowed by the filters. */
const sectionEmployeeIds = async (req, resource, filters) => {
  const [scoped, selected] = await Promise.all([visibleEmployeeIds(req, resource), filteredEmployees(req, filters)]);
  if (!selected) return scoped; // null = everyone in the tenant
  const chosen = selected.map((row) => row._id);
  if (!scoped) return chosen;
  const allowed = new Set(scoped.map(idOf));
  return chosen.filter((id) => allowed.has(idOf(id)));
};

const employeeIdMatch = (ids, field = 'employeeId') => (ids ? { [field]: { $in: ids } } : {});

const monthWindow = (year, month) => ({
  from: startOfDay(new Date(year, month - 1, 1)),
  to: startOfDay(new Date(year, month, 0)),
  daysInMonth: new Date(year, month, 0).getDate(),
});

/** Named counts, largest first, the tail folded into "Other" past `limit`. */
const ranked = (counts, names, { limit = 8, unknown = 'Unassigned' } = {}) => {
  const rows = counts
    .map((row) => ({ label: row._id ? (names.get(idOf(row._id)) ?? String(row._id)) : unknown, value: row.count }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  if (rows.length <= limit) return rows;
  const tail = rows.slice(limit - 1).reduce((sum, row) => sum + row.value, 0);
  return [...rows.slice(0, limit - 1), { label: 'Other', value: tail }];
};

const nameMap = async (Model, ids) => {
  const wanted = ids.filter(Boolean);
  if (!wanted.length) return new Map();
  const rows = await Model.find({ _id: { $in: wanted } }).select('name').lean();
  return new Map(rows.map((row) => [String(row._id), row.name]));
};

const personOf = (employee) =>
  employee
    ? {
        _id: idOf(employee._id),
        employeeCode: employee.employeeCode,
        employeeId: employee.employeeId ?? null,
        fullName: [employee.firstName, employee.lastName].filter(Boolean).join(' '),
      }
    : null;

/* -------------------------------------------------------------------------- */
/*                                 Employees                                  */
/* -------------------------------------------------------------------------- */

/**
 * Headcount and its make-up. Requires `employee:dashboard`, as the employee
 * summary does. Soft-deleted records are not headcount.
 */
export const employeeOverview = async ({ unitId, departmentId }, req) => {
  assertCan(req, RESOURCES.EMPLOYEE, ACTIONS.DASHBOARD);
  if (unitId && !unitAllowed(req, unitId)) {
    throw unitDenied(req, { requestedUnit: String(unitId) }, 'You do not have access to that unit');
  }

  const scope = buildScopeFilter(req, {
    ownerField: '_id',
    managerField: 'reportingManagerId',
    departmentField: 'departmentId',
    resource: RESOURCES.EMPLOYEE,
  });
  delete scope.tenantId;

  const match = {
    tenantId: tenantOf(req),
    deletedAt: null,
    ...(unitId ? { unitId: toObjectId(unitId) } : {}),
    ...(departmentId ? { departmentId: toObjectId(departmentId) } : {}),
    $and: [scope],
  };

  const today = startOfDay(new Date());
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const employed = { status: { $in: ACTIVE_EMPLOYEE_STATUSES } };

  const [facets] = await Employee.aggregate([
    { $match: match },
    {
      $facet: {
        byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
        // Distributions describe the people currently employed.
        byUnit: [{ $match: employed }, { $group: { _id: '$unitId', count: { $sum: 1 } } }],
        byDepartment: [{ $match: employed }, { $group: { _id: '$departmentId', count: { $sum: 1 } } }],
        byEmploymentType: [{ $match: employed }, { $group: { _id: '$employmentType', count: { $sum: 1 } } }],
        byGender: [{ $match: employed }, { $group: { _id: '$gender', count: { $sum: 1 } } }],
        byCategory: [{ $match: employed }, { $group: { _id: '$employeeCategory', count: { $sum: 1 } } }],
        joinedThisMonth: [{ $match: { ...employed, joiningDate: { $gte: monthStart } } }, { $count: 'count' }],
        recent: [
          { $sort: { joiningDate: -1, employeeCode: -1 } },
          { $limit: 6 },
          { $project: { employeeCode: 1, employeeId: 1, firstName: 1, lastName: 1, joiningDate: 1, status: 1, departmentId: 1 } },
        ],
      },
    },
  ]);

  const status = Object.fromEntries(Object.values(EMPLOYEE_STATUS).map((value) => [value, 0]));
  facets.byStatus.forEach((row) => {
    if (row._id) status[row._id] = row.count;
  });
  const total = Object.values(status).reduce((sum, value) => sum + value, 0);
  const active = ACTIVE_EMPLOYEE_STATUSES.reduce((sum, value) => sum + (status[value] ?? 0), 0);

  const [units, departments] = await Promise.all([
    nameMap(Unit, facets.byUnit.map((row) => row._id)),
    nameMap(Department, [...facets.byDepartment.map((row) => row._id), ...facets.recent.map((row) => row.departmentId)]),
  ]);
  const plain = (rows) =>
    rows
      .filter((row) => row._id)
      .map((row) => ({ label: row._id, value: row.count }))
      .sort((a, b) => b.value - a.value);

  return {
    total,
    active,
    inactive: total - active,
    probation: status.PROBATION,
    confirmed: status.ACTIVE + status.NOTICE_PERIOD,
    noticePeriod: status.NOTICE_PERIOD,
    joinedThisMonth: facets.joinedThisMonth[0]?.count ?? 0,
    byStatus: status,
    byUnit: ranked(facets.byUnit, units),
    byDepartment: ranked(facets.byDepartment, departments),
    byEmploymentType: plain(facets.byEmploymentType),
    byGender: plain(facets.byGender),
    byCategory: plain(facets.byCategory),
    recentJoiners: facets.recent.map((employee) => ({
      ...personOf(employee),
      joiningDate: employee.joiningDate,
      status: employee.status,
      department: departments.get(idOf(employee.departmentId)) ?? null,
    })),
  };
};

/* -------------------------------------------------------------------------- */
/*                                 Attendance                                 */
/* -------------------------------------------------------------------------- */

const PRESENT_STATUSES = [ATTENDANCE_STATUS.PRESENT, ATTENDANCE_STATUS.ON_DUTY, ATTENDANCE_STATUS.WORK_FROM_HOME];

/**
 * The selected month and today. The month's figures are the attendance
 * module's monthly summary rows (weekly offs with no record included, as the
 * register shows them), narrowed to the filtered employees. Today's are the
 * stored day records plus the rest days and holidays that have none.
 */
export const attendanceOverview = async ({ year, month, unitId, departmentId }, req) => {
  assertCan(req, RESOURCES.ATTENDANCE, ACTIONS.READ);

  const selected = await filteredEmployees(req, { unitId, departmentId });
  const keep = selected ? new Set(selected.map((row) => idOf(row._id))) : null;

  // The module's own summary, scoped by the caller as it always is.
  const summary = await monthlySummary({ year, month, departmentId }, req);
  const rows = keep ? summary.rows.filter((row) => keep.has(row._id)) : summary.rows;
  const ids = rows.map((row) => toObjectId(row._id));

  const sum = (key) => rows.reduce((total, row) => total + (row[key] ?? 0), 0);
  const totals = {
    present: sum('present'),
    halfDay: sum('halfDay'),
    absent: sum('absent'),
    onLeave: sum('onLeave'),
    weeklyOff: sum('weeklyOff'),
    holiday: sum('holiday'),
    missingPunch: sum('missingPunch'),
    lateCount: sum('lateCount'),
    overtimeMinutes: sum('overtimeMinutes'),
    employeesWithOvertime: rows.filter((row) => (row.overtimeMinutes ?? 0) > 0).length,
    employees: rows.length,
  };
  // Days somebody was expected to work; half a day present counts as half.
  const scheduled = totals.present + totals.halfDay + totals.absent + totals.onLeave;
  totals.attendancePercent = scheduled ? Math.round(((totals.present + totals.halfDay * 0.5) / scheduled) * 100) : null;

  const byDepartment = new Map();
  rows.forEach((row) => {
    const key = row.department || 'Unassigned';
    const entry = byDepartment.get(key) ?? { present: 0, halfDay: 0, scheduled: 0 };
    entry.present += row.present ?? 0;
    entry.halfDay += row.halfDay ?? 0;
    entry.scheduled += (row.present ?? 0) + (row.halfDay ?? 0) + (row.absent ?? 0) + (row.onLeave ?? 0);
    byDepartment.set(key, entry);
  });

  const { from, to, daysInMonth } = monthWindow(year, month);
  const today = startOfDay(new Date());

  const yearFrom = startOfDay(new Date(year, 0, 1));
  const yearTo = startOfDay(new Date(year, 11, 31));

  const [daily, exceptions, pendingRegularizations, overtimeDays] = await Promise.all([
    ids.length
      ? Attendance.aggregate([
          { $match: { employeeId: { $in: ids }, date: { $gte: from, $lte: to } } },
          { $group: { _id: { date: '$date', status: '$status' }, count: { $sum: 1 } } },
        ])
      : [],
    ids.length
      ? Attendance.aggregate([
          { $match: { employeeId: { $in: ids }, date: { $gte: from, $lte: to }, status: ATTENDANCE_STATUS.MISSING_PUNCH } },
          {
            $group: {
              _id: null,
              missingIn: { $sum: { $cond: [{ $eq: [{ $ifNull: ['$checkInAt', null] }, null] }, 1, 0] } },
              missingOut: {
                $sum: {
                  $cond: [
                    { $and: [{ $ne: [{ $ifNull: ['$checkInAt', null] }, null] }, { $eq: [{ $ifNull: ['$checkOutAt', null] }, null] }] },
                    1,
                    0,
                  ],
                },
              },
            },
          },
        ])
      : [],
    ids.length ? Regularization.countDocuments({ employeeId: { $in: ids }, status: REGULARIZATION_STATUS.PENDING }) : 0,
    // The year's overtime, the same stored `overtimeMinutes` the register and
    // payroll read, summed per day and folded into local months below.
    ids.length
      ? attendanceRepository.overtimeByDay({ employeeId: { $in: ids }, date: { $gte: yearFrom, $lte: yearTo } })
      : [],
  ]);

  const overtimeByMonth = new Map();
  overtimeDays.forEach((entry) => {
    const monthNumber = new Date(entry._id).getMonth() + 1;
    overtimeByMonth.set(monthNumber, (overtimeByMonth.get(monthNumber) ?? 0) + (entry.overtimeMinutes ?? 0));
  });

  // Day-by-day counts, folded on local dates (stored dates are local midnights).
  const days = Array.from({ length: daysInMonth }, (_, index) => ({ day: index + 1, present: 0, halfDay: 0, absent: 0, onLeave: 0 }));
  daily.forEach(({ _id, count }) => {
    const date = new Date(_id.date);
    if (date.getMonth() !== month - 1) return;
    const day = days[date.getDate() - 1];
    if (PRESENT_STATUSES.includes(_id.status)) day.present += count;
    else if (_id.status === ATTENDANCE_STATUS.HALF_DAY) day.halfDay += count;
    else if (_id.status === ATTENDANCE_STATUS.ABSENT) day.absent += count;
    else if (_id.status === ATTENDANCE_STATUS.ON_LEAVE) day.onLeave += count;
  });
  // Future days have nothing to report; trimmed so the line ends at today.
  const lastDay = year === today.getFullYear() && month === today.getMonth() + 1 ? today.getDate() : daysInMonth;
  const isFuture = new Date(year, month - 1, 1) > today;

  return {
    year,
    month,
    totals,
    byDepartment: [...byDepartment.entries()]
      .map(([label, entry]) => ({
        label,
        value: entry.scheduled ? Math.round(((entry.present + entry.halfDay * 0.5) / entry.scheduled) * 100) : 0,
        scheduled: entry.scheduled,
      }))
      .filter((row) => row.scheduled > 0)
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label)),
    // Days with no record at all (Sundays, a closed site) are left out rather
    // than drawn as a dive to zero, which would read as everyone absent.
    trend: isFuture ? [] : days.slice(0, lastDay).filter((day) => day.present + day.halfDay + day.absent + day.onLeave > 0),
    overtimeTrend: [...overtimeByMonth.entries()]
      .map(([monthNumber, minutes]) => ({ month: monthNumber, overtimeMinutes: minutes }))
      .sort((a, b) => a.month - b.month),
    exceptions: {
      missingPunch: totals.missingPunch,
      missingIn: exceptions[0]?.missingIn ?? 0,
      missingOut: exceptions[0]?.missingOut ?? 0,
      lateArrivals: totals.lateCount,
      pendingRegularizations,
    },
  };
};

/**
 * Today, on its own so the headline cards do not wait for the month: stored
 * day records by status, plus the currently employed people with no record
 * today whose rest day it is or whose calendar has it as a holiday -- the same
 * rule the register uses to show an unrecorded weekly off. Requires
 * `attendance:read`; the same employees as the month (scope, unit, department).
 */
export const todayOverview = async ({ unitId, departmentId }, req) => {
  assertCan(req, RESOURCES.ATTENDANCE, ACTIONS.READ);
  const today = startOfDay(new Date());

  // The month summary covers the caller's employee reach, every status; so does this.
  const scoped = await sectionEmployeeIds(req, RESOURCES.EMPLOYEE, { unitId, departmentId });
  const ids = (
    await Employee.find({ tenantId: tenantOf(req), deletedAt: null, ...(scoped ? { _id: { $in: scoped } } : {}) })
      .select('_id')
      .lean()
  ).map((row) => row._id);
  return todayAttendance(req, ids, today);
};

const todayAttendance = async (req, ids, today) => {
  const empty = { date: today, present: 0, halfDay: 0, absent: 0, onLeave: 0, missingPunch: 0, weeklyOffOrHoliday: 0, recorded: 0, employed: 0 };
  if (!ids.length) return empty;

  const [records, employed, holidays] = await Promise.all([
    Attendance.find({ employeeId: { $in: ids }, date: today }).select('employeeId status').lean(),
    Employee.find({ _id: { $in: ids }, deletedAt: null, status: { $in: ACTIVE_EMPLOYEE_STATUSES }, joiningDate: { $lte: today } })
      .select('_id tenantId shiftId departmentId')
      .populate({ path: 'shiftId', select: 'weeklyOffs' })
      .lean(),
    attendanceRepository.findHolidays(tenantOf(req), today, today),
  ]);

  const result = { ...empty, recorded: records.length, employed: employed.length };
  records.forEach(({ status }) => {
    if (PRESENT_STATUSES.includes(status)) result.present += 1;
    else if (status === ATTENDANCE_STATUS.HALF_DAY) result.halfDay += 1;
    else if (status === ATTENDANCE_STATUS.ABSENT) result.absent += 1;
    else if (status === ATTENDANCE_STATUS.ON_LEAVE) result.onLeave += 1;
    else if (status === ATTENDANCE_STATUS.MISSING_PUNCH) result.missingPunch += 1;
    else if ([ATTENDANCE_STATUS.WEEKLY_OFF, ATTENDANCE_STATUS.HOLIDAY].includes(status)) result.weeklyOffOrHoliday += 1;
  });

  const recordedIds = new Set(records.map((record) => idOf(record.employeeId)));
  const unrecorded = employed.filter((employee) => !recordedIds.has(idOf(employee._id)));
  if (unrecorded.length) {
    if (holidays.length) {
      result.weeklyOffOrHoliday += unrecorded.length;
    } else {
      const restDays = await weeklyOffDaysByEmployee(unrecorded, { tenantId: tenantOf(req) });
      result.weeklyOffOrHoliday += unrecorded.filter((employee) => (restDays.get(idOf(employee._id)) ?? []).includes(today.getDay())).length;
    }
  }

  result.holidayToday = holidays[0]?.name ?? null;
  return result;
};

/* -------------------------------------------------------------------------- */
/*                                    Leave                                   */
/* -------------------------------------------------------------------------- */

const presentLeave = (request) => ({
  _id: idOf(request._id),
  requestNumber: request.requestNumber ?? null,
  employee: personOf(request.employeeId),
  leaveType: request.leaveTypeId?.name ?? request.typeSnapshot?.name ?? null,
  from: request.from,
  to: request.to,
  days: request.days ?? null,
  status: request.status,
});

/**
 * Applications touching the selected month by status, who is away today, and
 * the next approved and pending requests. Requires `leave:read`; scoped as the
 * leave lists are.
 */
export const leaveOverview = async ({ year, month, unitId, departmentId }, req) => {
  assertCan(req, RESOURCES.LEAVE, ACTIONS.READ);

  const ids = await sectionEmployeeIds(req, RESOURCES.LEAVE, { unitId, departmentId });
  const base = { tenantId: tenantOf(req), ...employeeIdMatch(ids) };

  const monthStart = startOfDay(new Date(year, month - 1, 1));
  const monthEnd = startOfDay(new Date(year, month, 0));
  const today = startOfDay(new Date());
  const populate = [
    { path: 'employeeId', select: 'employeeCode employeeId firstName lastName' },
    { path: 'leaveTypeId', select: 'name' },
  ];

  const [byStatus, onLeaveToday, upcoming, pending, pendingTotal] = await Promise.all([
    LeaveRequest.aggregate([
      { $match: { ...base, from: { $lte: monthEnd }, to: { $gte: monthStart } } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    LeaveRequest.distinct('employeeId', { ...base, status: LEAVE_STATUS.APPROVED, from: { $lte: today }, to: { $gte: today } }),
    LeaveRequest.find({ ...base, status: LEAVE_STATUS.APPROVED, from: { $gt: today } }).sort({ from: 1 }).limit(6).populate(populate).lean(),
    LeaveRequest.find({ ...base, status: LEAVE_STATUS.PENDING }).sort({ from: 1, createdAt: 1 }).limit(6).populate(populate).lean(),
    LeaveRequest.countDocuments({ ...base, status: LEAVE_STATUS.PENDING }),
  ]);

  const counts = Object.fromEntries(Object.values(LEAVE_STATUS).map((status) => [status, 0]));
  byStatus.forEach((row) => {
    counts[row._id] = row.count;
  });

  return {
    year,
    month,
    received: Object.values(counts).reduce((total, value) => total + value, 0),
    approved: counts.APPROVED,
    pending: counts.PENDING,
    rejected: counts.REJECTED,
    cancelled: counts.CANCELLED,
    onLeaveToday: onLeaveToday.length,
    pendingTotal,
    pendingRequests: pending.map(presentLeave),
    upcomingApproved: upcoming.map(presentLeave),
  };
};

/* -------------------------------------------------------------------------- */
/*                                   Payroll                                  */
/* -------------------------------------------------------------------------- */

/** Monthly gross bands the distribution counts into (boundaries only; the screen labels them). */
export const SALARY_BANDS = [0, 500_000, 1_000_000, 2_500_000, 5_000_000];

/**
 * A run's figures from its salary register -- the Payroll module's own rows,
 * read off the stored payslips and already narrowed to the caller's units --
 * further narrowed to the filtered employees. Gross is the register's `gross`
 * (salary plus overtime, bonus and arrears); net is gross less what left the
 * employee's pay, which is what the run's own net is.
 */
const registerFigures = async (run, req, codes) => {
  const { rows: all } = await salaryRegister(run._id, req);
  const rows = codes ? all.filter((row) => codes.has(row.employeeCode)) : all;
  const sum = (key) => rows.reduce((total, row) => total + (row[key] ?? 0), 0);
  const gross = sum('gross');
  const deductions = sum('employeeDeductions');
  // The employee's statutory lines, as the register prints them. SDL and WCF are
  // employer levies and never part of what left the employee's pay.
  const nssf = sum('nssfEmployee');
  const nhif = sum('nhif');
  const paye = sum('paye');
  return {
    rows,
    gross,
    deductions,
    net: gross - deductions,
    overtime: sum('overtime'),
    employees: rows.length,
    breakdown: { nssf, nhif, paye, other: Math.max(0, deductions - (nssf + nhif + paye)) },
  };
};

/**
 * The selected month's run, the year's trend and the previous month, all from
 * stored payslips. Requires what the Payroll Runs screen requires:
 * `payroll:read` with organisation-wide reach.
 */
export const payrollOverview = async ({ year, month, unitId, departmentId }, req) => {
  assertCan(req, RESOURCES.PAYROLL, ACTIONS.READ);
  if (!hasScopeAtLeast(req.user?.role, SCOPES.TENANT, RESOURCES.PAYROLL)) throw forbidden(RESOURCES.PAYROLL);

  const selected = await filteredEmployees(req, { unitId, departmentId });
  const codes = selected ? new Set(selected.map((row) => row.employeeCode)) : null;

  const previous = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  const [runs, previousRun, awaitingApproval] = await Promise.all([
    PayrollRun.find({ tenantId: tenantOf(req), year, status: { $ne: PAYROLL_STATUS.CANCELLED } }).sort({ month: 1 }).lean(),
    PayrollRun.findOne({ tenantId: tenantOf(req), ...previous, status: { $ne: PAYROLL_STATUS.CANCELLED } }).lean(),
    PayrollRun.countDocuments({ tenantId: tenantOf(req), status: PAYROLL_STATUS.PENDING_APPROVAL }),
  ]);

  // One register per run, computed once even when it is both "this month" and
  // a point on the trend.
  const cache = new Map();
  const figuresOf = (run) => {
    if (!cache.has(idOf(run._id))) cache.set(idOf(run._id), registerFigures(run, req, codes));
    return cache.get(idOf(run._id));
  };

  const trend = await Promise.all(
    runs.map(async (run) => {
      const figures = await figuresOf(run);
      return { month: run.month, period: run.period, status: run.status, gross: figures.gross, net: figures.net, deductions: figures.deductions, employees: figures.employees };
    }),
  );

  const run = runs.find((entry) => entry.month === month) ?? null;
  const current = run ? await figuresOf(run) : null;
  const before = previousRun ? await figuresOf(previousRun) : null;

  const byDepartment = new Map();
  (current?.rows ?? []).forEach((row) => {
    const key = row.department || 'Unassigned';
    const entry = byDepartment.get(key) ?? { value: 0, employees: 0 };
    entry.value += row.gross ?? 0;
    entry.employees += 1;
    byDepartment.set(key, entry);
  });

  const bands = SALARY_BANDS.map((min, index) => ({
    min,
    max: SALARY_BANDS[index + 1] ?? null,
    employees: (current?.rows ?? []).filter((row) => (row.gross ?? 0) >= min && (SALARY_BANDS[index + 1] === undefined || (row.gross ?? 0) < SALARY_BANDS[index + 1])).length,
  }));

  return {
    year,
    month,
    awaitingApproval,
    run: run
      ? {
          _id: idOf(run._id),
          period: run.period,
          status: run.status,
          gross: current.gross,
          net: current.net,
          deductions: current.deductions,
          overtime: current.overtime,
          employees: current.employees,
          breakdown: current.breakdown,
        }
      : null,
    previous: previousRun && before ? { period: previousRun.period, gross: before.gross, net: before.net, employees: before.employees } : null,
    trend,
    byDepartment: [...byDepartment.entries()]
      .map(([label, entry]) => ({ label, value: entry.value, employees: entry.employees }))
      .sort((a, b) => b.value - a.value),
    bands,
  };
};

export default { employeeOverview, attendanceOverview, todayOverview, leaveOverview, payrollOverview, SALARY_BANDS };
