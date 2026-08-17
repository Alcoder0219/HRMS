import logger from '../../config/logger.js';
import ApiError from '../../utils/ApiError.js';
import {
  ATTENDANCE_SOURCE,
  ATTENDANCE_STATUS,
  AUDIT_ACTIONS,
  COMP_OFF_STATUS,
  RESOURCES,
} from '../../utils/constants.js';
import { buildPagination, buildSort, buildFilters, dateRange } from '../../utils/queryBuilder.js';
import attendanceRepository from '../../repositories/attendance/attendance.repository.js';
import employeeRepository from '../../repositories/employee/employee.repository.js';
import Employee from '../../models/employee/employee.model.js';
import Shift from '../../models/organization/shift.model.js';
import { evaluateDay, startOfDay, summarizeMonth } from '../../helpers/attendanceRules.helper.js';
// Manual attendance derives its own figures and never consults the engine above.
import { deriveManualDay, resolveWeeklyOffDays } from '../../helpers/manualAttendance.helper.js';
import { weeklyOffDaysForEmployee } from './weeklyOff.service.js';
import { checkGeofence } from '../../helpers/geo.helper.js';
import { recordAudit } from '../../helpers/audit.helper.js';
import { buildScopeFilter } from '../../helpers/permission.helper.js';

const ENTITY = 'Attendance';

export const SORTABLE_FIELDS = ['date', 'status', 'checkInAt', 'workedMinutes', 'lateMinutes', 'overtimeMinutes'];

/* -------------------------------------------------------------------------- */
/*                              Context loading                               */
/* -------------------------------------------------------------------------- */

/**
 * Everything the rules engine needs for one employee-day, gathered once.
 *
 * The engine is pure; this is the impure half that feeds it. Keeping the split
 * sharp is what lets the calculation be tested without a database.
 */
export const loadDayContext = async (employee, date, { holidays = null, policy = null } = {}) => {
  const day = startOfDay(date);

  const shift = employee.shiftId
    ? await Shift.findById(employee.shiftId._id ?? employee.shiftId).lean()
    : null;

  const resolvedPolicy =
    policy ??
    (await attendanceRepository.resolvePolicy(
      employee.tenantId ?? null,
      employee.departmentId?._id ?? employee.departmentId ?? null,
    ));

  const holidayList =
    holidays ?? (await attendanceRepository.findHolidays(employee.tenantId ?? null, day, day));

  const holiday =
    holidayList.find(
      (entry) =>
        startOfDay(entry.date).getTime() === day.getTime() &&
        // An empty department list means the holiday applies to everyone.
        (!entry.departmentIds?.length ||
          entry.departmentIds.some(
            (id) => String(id) === String(employee.departmentId?._id ?? employee.departmentId),
          )) &&
        !entry.isOptional,
    ) ?? null;

  // The shift's own weekly offs win over the policy default -- a night-shift
  // roster often rests on a different day from the office. The precedence lives
  // in one function so the engine path and the manual path cannot disagree
  // about which day is a rest day.
  const weeklyOffs = resolveWeeklyOffDays(shift, resolvedPolicy);

  /**
   * The employee's own overtime caps override the company policy.
   *
   * Attendance still MEASURES time worked past the shift end regardless of
   * eligibility -- that is a fact about the day, and suppressing it here would
   * lose the record. Eligibility decides whether the hours are paid, which is
   * payroll's call. What the employee's configuration does change is the
   * ceiling on how much is recorded.
   */
  const employeeCap = employee.overtime?.maxDailyOT;
  const policyWithEmployeeCaps =
    employeeCap > 0
      ? { ...(resolvedPolicy ?? {}), maxOvertimeMinutes: employeeCap * 60 }
      : (resolvedPolicy ?? {});

  return {
    day,
    shift,
    policy: policyWithEmployeeCaps,
    holiday,
    isWeeklyOff: weeklyOffs.includes(day.getDay()),
  };
};

const shiftSnapshot = (shift) =>
  shift
    ? {
        code: shift.code,
        name: shift.name,
        startTime: shift.startTime,
        endTime: shift.endTime,
        breakMinutes: shift.breakMinutes,
        isNightShift: shift.isNightShift,
      }
    : null;

/* -------------------------------------------------------------------------- */
/*                                 Recompute                                  */
/* -------------------------------------------------------------------------- */

/**
 * The single write path for a computed attendance day.
 *
 * Every source -- a web punch, a biometric batch, a CSV row, an approved
 * regularization -- appends its punches and then calls this. One place decides
 * what a day means, so the same inputs always produce the same record
 * regardless of which door they came through.
 */
export const recomputeDay = async (employee, date, { context = null, req = null, source } = {}) => {
  const { day, shift, policy, holiday, isWeeklyOff } =
    context ?? (await loadDayContext(employee, date));

  const existing = await attendanceRepository.findByEmployeeAndDate(employee._id, day);

  if (existing?.isLocked) {
    throw ApiError.badRequest('This attendance period is locked and cannot be changed');
  }

  const evaluation = evaluateDay({
    date: day,
    punches: existing?.punches ?? [],
    shift,
    policy,
    holiday,
    isWeeklyOff,
    onLeave: existing?.status === ATTENDANCE_STATUS.ON_LEAVE,
    overrideStatus: existing?.overrideStatus ?? null,
  });

  /**
   * Overtime is only credited to employees configured for it.
   *
   * The rules engine is pure and knows the shift and the policy but not the
   * person, so it computed overtime for everyone -- including staff whose
   * contract has `overtimeEligible: false`. Those minutes were stored and then
   * read by payroll, which is the expensive end of the mistake.
   *
   * Applied here rather than in the engine because this is where the employee
   * is in hand, and it deliberately applies to every source: an ineligible
   * employee should not accrue overtime from a biometric punch, an Excel
   * import or a manual correction. Nothing about how those imports run
   * changes -- only the figure they leave behind.
   */
  if (!employee.overtimeEligible && evaluation.overtimeMinutes > 0) {
    evaluation.overtimeMinutes = 0;
  }

  const record = await attendanceRepository.upsertDay(employee._id, day, {
    set: {
      tenantId: employee.tenantId ?? null,
      shiftId: shift?._id ?? null,
      shiftSnapshot: shiftSnapshot(shift),
      checkInAt: evaluation.checkInAt,
      checkOutAt: evaluation.checkOutAt,
      status: evaluation.status,
      workedMinutes: evaluation.workedMinutes,
      expectedMinutes: evaluation.expectedMinutes,
      breakMinutes: evaluation.breakMinutes,
      lateMinutes: evaluation.lateMinutes,
      earlyGoingMinutes: evaluation.earlyGoingMinutes,
      overtimeMinutes: evaluation.overtimeMinutes,
      isHoliday: evaluation.isHoliday,
      isWeeklyOff: evaluation.isWeeklyOff,
      isNightShift: evaluation.isNightShift,
      compOffEarnedDays: evaluation.compOffEarnedDays,
      anomalies: evaluation.anomalies,
      ...(source ? { source } : {}),
      ...(req?.user?.id ? { updatedBy: req.user.id } : {}),
    },
    setOnInsert: { markedBy: req?.user?.id ?? null },
  });

  await syncCompOff(employee, record, policy);

  return record;
};

/**
 * Keeps the comp-off ledger consistent with the day it was earned from.
 *
 * Recompute may add or remove the credit -- a corrected punch pair can take a
 * holiday shift below the threshold. The credit is only withdrawn while it is
 * still unconsumed; once someone has taken the day off, clawing it back is a
 * human decision, not an automatic one.
 */
const syncCompOff = async (employee, record, policy) => {
  if (!policy?.compOffEnabled) return;

  if (record.compOffEarnedDays > 0) {
    const expiryDays = policy.compOffExpiryDays ?? 90;

    await attendanceRepository.upsertCompOff(employee._id, record.date, {
      tenantId: employee.tenantId ?? null,
      employeeId: employee._id,
      earnedOn: record.date,
      attendanceId: record._id,
      days: record.compOffEarnedDays,
      workedMinutes: record.workedMinutes,
      expiresAt: new Date(record.date.getTime() + expiryDays * 86_400_000),
      status: COMP_OFF_STATUS.EARNED,
      reason: record.isHoliday ? 'Worked on a holiday' : 'Worked on a weekly off',
    });
    return;
  }

  await attendanceRepository.removeCompOff(employee._id, record.date);
};

/* -------------------------------------------------------------------------- */
/*                                  Punching                                  */
/* -------------------------------------------------------------------------- */

const resolveEmployeeForUser = async (req, employeeId = null) => {
  if (employeeId) {
    const employee = await employeeRepository.findById(employeeId);
    if (!employee) throw ApiError.notFound('Employee not found');
    return employee;
  }

  // Self-service: the punch belongs to whoever is signed in.
  if (!req.user.employeeId) {
    throw ApiError.badRequest('Your login is not linked to an employee record');
  }

  const employee = await employeeRepository.findById(req.user.employeeId);
  if (!employee) throw ApiError.notFound('Employee record not found');
  return employee;
};

/**
 * Records one punch and recomputes the day.
 *
 * Direction is inferred rather than trusted: a client that says "OUT" when no
 * entry exists would otherwise create a day that ends before it starts.
 */
export const punch = async ({ employeeId = null, direction = null, location = null, source = ATTENDANCE_SOURCE.WEB, note = null, time = null }, req) => {
  const employee = await resolveEmployeeForUser(req, employeeId);
  const at = time ? new Date(time) : new Date();
  const context = await loadDayContext(employee, at);

  /* --- geofence ---------------------------------------------------------- */
  let geo = null;
  if (location) {
    const sites = (context.policy.geofenceSites ?? []).filter((site) => site.isActive);
    geo = checkGeofence(location, context.policy.geofenceEnabled ? sites : []);

    if (context.policy.geofenceEnabled && context.policy.rejectOutsideGeofence && !geo.allowed) {
      throw ApiError.badRequest(
        geo.reason === 'INVALID_COORDINATES'
          ? 'Your location could not be read. Enable location access and try again.'
          : `You are ${geo.distance}m from ${geo.nearest?.name ?? 'the office'}. Punching is only allowed on site.`,
        { code: geo.reason, distance: geo.distance },
      );
    }
  }

  const existing = await attendanceRepository.findByEmployeeAndDate(employee._id, at);
  const inferredDirection = direction ?? (existing?.punches?.length ? 'OUT' : 'IN');

  if (inferredDirection === 'OUT' && !existing?.punches?.length) {
    throw ApiError.badRequest('You have not checked in today');
  }

  await attendanceRepository.upsertDay(employee._id, at, {
    set: { tenantId: employee.tenantId ?? null },
    setOnInsert: { markedBy: req.user.id, source },
    push: {
      punches: {
        time: at,
        source,
        direction: inferredDirection,
        location: location
          ? {
              ...location,
              withinGeofence: geo?.allowed ?? null,
              distanceMetres: geo?.distance ?? null,
              siteName: geo?.nearest?.name ?? null,
            }
          : null,
        ip: req.ip,
        recordedBy: req.user.id,
        note,
      },
    },
  });

  const record = await recomputeDay(employee, at, { context, req, source });

  logger.info('Attendance punch recorded', {
    employeeId: String(employee._id),
    direction: inferredDirection,
    source,
  });

  return { record, direction: inferredDirection, geofence: geo };
};

/* -------------------------------------------------------------------------- */
/*                                Manual entry                                */
/* -------------------------------------------------------------------------- */

/**
 * HR or a manager setting a day directly.
 *
 * Supplied times are stored as MANUAL punches rather than written straight to
 * `checkInAt` -- so the record keeps one consistent shape, and the audit trail
 * shows a human entered them.
 */
/**
 * Records or corrects one employee's day by hand.
 *
 * What the administrator sends is what gets stored. This path deliberately does
 * not call `recomputeDay`, and that is the whole of the fix: it used to write
 * the supplied values and then immediately hand the day to the rules engine,
 * which re-derived status, worked minutes and overtime from the shift, the
 * holiday calendar and the attendance policy -- discarding the correction
 * between the write and the response. A weekly off chosen by hand came back
 * PRESENT because the engine saw punches and no roster said otherwise.
 *
 * The only figures not taken verbatim are working hours and overtime, and only
 * because they are arithmetic on the times supplied. See
 * helpers/manualAttendance.helper.js.
 *
 * `reason` is why the correction was made, as distinct from `remarks`, which is
 * a note about the day itself and is stored on the record. The reason goes to
 * the audit trail only -- it explains the edit, not the attendance -- so no
 * attendance field or collection changes to carry it.
 */
export const markManual = async ({ employeeId, date, checkIn, checkOut, status, remarks, reason }, req) => {
  const employee = await employeeRepository.findById(employeeId);
  if (!employee) throw ApiError.notFound('Employee not found');

  const day = startOfDay(date);
  const before = await attendanceRepository.findByEmployeeAndDate(employee._id, day);

  if (before?.isLocked) {
    throw ApiError.badRequest('This attendance period is locked and cannot be changed');
  }

  const punches = [];
  if (checkIn) {
    punches.push({ time: new Date(checkIn), source: ATTENDANCE_SOURCE.MANUAL, direction: 'IN', recordedBy: req.user.id });
  }
  if (checkOut) {
    punches.push({ time: new Date(checkOut), source: ATTENDANCE_SOURCE.MANUAL, direction: 'OUT', recordedBy: req.user.id });
  }

  /**
   * An absent field means "leave this alone"; an explicit null means "clear it".
   *
   * The two used to be the same thing, so an edit that touched only the times
   * also pinned the day's current status as a permanent override, and an edit
   * that touched only the status resent the times as MANUAL punches --
   * discarding the biometric punch log the device had written. A correction
   * should change what the administrator changed and nothing else.
   */
  const set = {
    tenantId: employee.tenantId ?? null,
    source: ATTENDANCE_SOURCE.MANUAL,
    updatedBy: req.user.id,
  };

  // Replaces rather than appends: a manual correction of the times supersedes
  // whatever was there, and mixing the two would double-count the day.
  if (punches.length) set.punches = punches;

  if (remarks !== undefined) set.remarks = remarks || null;

  /**
   * An absent field means "leave this alone"; an explicit null means "clear it".
   *
   * The two used to be the same thing, so an edit that touched only the times
   * also pinned the day's current status, and an edit that touched only the
   * status resent the times -- discarding the punch log. A correction should
   * change what the administrator changed and nothing else, so anything they
   * did not send is read back off the stored day.
   */
  const effectiveIn =
    checkIn !== undefined ? (checkIn ? new Date(checkIn) : null) : (before?.checkInAt ?? null);
  const effectiveOut =
    checkOut !== undefined ? (checkOut ? new Date(checkOut) : null) : (before?.checkOutAt ?? null);
  /**
   * A status a human chose stands; one that was merely derived follows the
   * times.
   *
   * `overrideStatus` is the record of who decided -- it is set when someone
   * picked a status from the list and null when they left it to the times. So
   * an administrator who marks a day WORK_FROM_HOME and then corrects the
   * clock-out keeps WORK_FROM_HOME, while a day showing ABSENT only because it
   * had no times becomes PRESENT the moment times are entered. Reading
   * `before.status` instead would freeze that ABSENT in place, and the day
   * would report ten hours worked and no attendance.
   */
  const chosenStatus = status !== undefined ? status || null : (before?.overrideStatus ?? null);

  /**
   * The employee's rest days, so a day worked on one is priced as overtime in
   * full rather than against duty hours nobody owed that day.
   *
   * Read from the shift or the attendance policy -- the same configuration the
   * rules engine reads -- and never assumed to be Sunday.
   */
  const weeklyOffDays = await weeklyOffDaysForEmployee(employee);

  Object.assign(
    set,
    deriveManualDay({
      checkIn: effectiveIn,
      checkOut: effectiveOut,
      status: chosenStatus,
      employee,
      date: day,
      weeklyOffDays,
    }),
  );

  /**
   * The override still records that a human chose this status, which is what
   * the column has always meant and what the attendance register displays. It
   * no longer gates anything, because nothing re-derives the status now.
   */
  if (status !== undefined) set.overrideStatus = status || null;

  const record = await attendanceRepository.upsertDay(employee._id, day, {
    set,
    setOnInsert: { markedBy: req.user.id },
  });

  await recordAudit({
    req,
    entity: ENTITY,
    entityId: record._id,
    entityLabel: `${employee.employeeCode} ${day.toISOString().slice(0, 10)}`,
    action: before ? AUDIT_ACTIONS.UPDATE : AUDIT_ACTIONS.CREATE,
    changes: [
      { field: 'status', from: before?.status ?? null, to: record.status },
      { field: 'checkInAt', from: before?.checkInAt?.toISOString() ?? null, to: record.checkInAt?.toISOString() ?? null },
      { field: 'checkOutAt', from: before?.checkOutAt?.toISOString() ?? null, to: record.checkOutAt?.toISOString() ?? null },
      // Recorded because a corrected day's worked and overtime minutes feed
      // payroll; "what did this edit change" has to include the figures.
      {
        field: 'workedMinutes',
        from: before?.workedMinutes ?? null,
        to: record.workedMinutes ?? null,
      },
      {
        field: 'overtimeMinutes',
        from: before?.overtimeMinutes ?? null,
        to: record.overtimeMinutes ?? null,
      },
    ].filter((change) => change.from !== change.to),
    metadata: { source: ATTENDANCE_SOURCE.MANUAL, remarks, reason: reason ?? null },
  });

  return record;
};

/* -------------------------------------------------------------------------- */
/*                                   Reads                                    */
/* -------------------------------------------------------------------------- */

const FILTER_DEFINITIONS = {
  status: (value) => ({ status: Array.isArray(value) ? { $in: value } : value }),
  employeeId: (value) => ({ employeeId: employeeRepository.toObjectId(value) }),
  from: (value, params) => {
    const range = dateRange(value, params.to ?? value);
    return range ? { date: range } : null;
  },
  to: () => null,
  isRegularized: (value) => ({ isRegularized: value }),
  hasAnomaly: (value) => (value ? { anomalies: { $ne: [] } } : null),
  lateOnly: (value) => (value ? { lateMinutes: { $gt: 0 } } : null),
  overtimeOnly: (value) => (value ? { overtimeMinutes: { $gt: 0 } } : null),
};

/**
 * Scope-aware base filter. An employee sees their own days, a manager their
 * team's, HR the whole tenant -- decided by the RBAC scope, not by the caller.
 */
const scopedFilter = async (req, extra = {}) => {
  const scope = buildScopeFilter(req, {
    ownerField: 'employeeId',
    managerField: 'employeeId',
    departmentField: 'employeeId',
    resource: RESOURCES.ATTENDANCE,
  });

  const filter = { tenantId: req.user.tenantId ?? null, ...extra };

  // Attendance has no manager or department column of its own, so TEAM and
  // DEPARTMENT scopes are resolved to the employee ids they cover.
  if (scope.employeeId !== undefined) {
    const employeeScope = buildScopeFilter(req, {
      ownerField: '_id',
      managerField: 'reportingManagerId',
      departmentField: 'departmentId',
      resource: RESOURCES.EMPLOYEE,
    });

    const employees = await Employee.find({ ...employeeScope, deletedAt: null })
      .select('_id')
      .lean();

    filter.employeeId = { $in: employees.map((employee) => employee._id) };
  }

  return filter;
};

export const listAttendance = async (query, req) => {
  const { page, limit, skip } = buildPagination(query);
  const sort = buildSort(query, SORTABLE_FIELDS, { date: -1 });

  const filter = {
    ...(await scopedFilter(req)),
    ...buildFilters(query, FILTER_DEFINITIONS),
  };

  const { items, total } = await attendanceRepository.paginate({ filter, sort, skip, limit });
  return { items, total, page, limit };
};

export const getDailySummary = async (date, req) => {
  const day = startOfDay(date);
  const filter = { ...(await scopedFilter(req)), date: day };

  const rows = await attendanceRepository.dailySummary(filter);

  const summary = Object.fromEntries(Object.values(ATTENDANCE_STATUS).map((status) => [status, 0]));
  rows.forEach(({ _id, count }) => {
    summary[_id] = count;
  });
  summary.total = rows.reduce((sum, row) => sum + row.count, 0);
  summary.date = day;

  return summary;
};

/** Today's card for the signed-in employee: punch state and shift context. */
export const getMyToday = async (req) => {
  const employee = await resolveEmployeeForUser(req);
  const today = startOfDay(new Date());

  const record = await attendanceRepository.findByEmployeeAndDate(employee._id, today);
  const context = await loadDayContext(employee, today);

  return {
    date: today,
    employee: {
      id: String(employee._id),
      employeeCode: employee.employeeCode,
      employeeId: employee.employeeId ?? null,
      fullName: employee.fullName,
    },
    shift: shiftSnapshot(context.shift),
    isHoliday: Boolean(context.holiday),
    holidayName: context.holiday?.name ?? null,
    isWeeklyOff: context.isWeeklyOff,
    geofenceEnabled: Boolean(context.policy.geofenceEnabled),
    record: record ? record.toObject({ virtuals: true }) : null,
    canCheckIn: !record?.punches?.length,
    canCheckOut: Boolean(record?.punches?.length),
  };
};

/**
 * One employee's month, with every date present -- including days that have no
 * record at all. A calendar with holes in it is unreadable, and the absence of
 * a row is itself meaningful.
 */
export const getMonthlyCalendar = async ({ employeeId, year, month }, req) => {
  const employee = await resolveEmployeeForUser(req, employeeId);

  const from = new Date(year, month - 1, 1);
  const to = new Date(year, month, 0);

  const [records, holidays, policy] = await Promise.all([
    attendanceRepository.findRawForRange({
      employeeId: employee._id,
      date: { $gte: startOfDay(from), $lte: startOfDay(to) },
    }),
    attendanceRepository.findHolidays(employee.tenantId ?? null, from, to),
    attendanceRepository.resolvePolicy(
      employee.tenantId ?? null,
      employee.departmentId?._id ?? employee.departmentId ?? null,
    ),
  ]);

  const byDate = new Map(records.map((record) => [startOfDay(record.date).getTime(), record]));
  const shift = employee.shiftId ? await Shift.findById(employee.shiftId._id ?? employee.shiftId).lean() : null;
  const weeklyOffs = shift?.weeklyOffs?.length ? shift.weeklyOffs : (policy?.weeklyOffs ?? [0]);

  const days = [];
  for (let cursor = new Date(from); cursor <= to; cursor.setDate(cursor.getDate() + 1)) {
    const day = startOfDay(cursor);
    const record = byDate.get(day.getTime());
    const holiday = holidays.find((entry) => startOfDay(entry.date).getTime() === day.getTime());

    days.push(
      record ?? {
        date: new Date(day),
        // A day with no record is not automatically absent: it may be a
        // weekend, a holiday, or simply in the future.
        status: holiday
          ? ATTENDANCE_STATUS.HOLIDAY
          : weeklyOffs.includes(day.getDay())
            ? ATTENDANCE_STATUS.WEEKLY_OFF
            : day > new Date()
              ? null
              : ATTENDANCE_STATUS.ABSENT,
        holidayName: holiday?.name ?? null,
        workedMinutes: 0,
        lateMinutes: 0,
        overtimeMinutes: 0,
        isPlaceholder: true,
      },
    );
  }

  return {
    employee: {
      id: String(employee._id),
      employeeCode: employee.employeeCode,
      employeeId: employee.employeeId ?? null,
      fullName: employee.fullName,
    },
    year,
    month,
    days,
    summary: summarizeMonth(days.filter((day) => day.status)),
  };
};

export const getAttendance = async (id, req) => {
  const record = await attendanceRepository.findById(id);
  if (!record) throw ApiError.notFound('Attendance record not found');

  const callerTenant = req.user.tenantId ?? null;
  if (callerTenant !== null && String(record.tenantId) !== callerTenant) {
    throw ApiError.notFound('Attendance record not found');
  }

  return record.toObject({ virtuals: true });
};

/* -------------------------------------------------------------------------- */
/*                                  Comp off                                  */
/* -------------------------------------------------------------------------- */

export const getCompOffLedger = async (employeeId, req) => {
  const employee = await resolveEmployeeForUser(req, employeeId);

  const [entries, balance] = await Promise.all([
    attendanceRepository.compOffLedger({ employeeId: employee._id }),
    attendanceRepository.compOffBalance(employee._id),
  ]);

  return { balance, entries };
};

/* -------------------------------------------------------------------------- */
/*                                Period lock                                 */
/* -------------------------------------------------------------------------- */

/**
 * Freezes a date range once payroll has consumed it. Without this, a late
 * regularization silently changes a figure that has already been paid.
 */
export const lockPeriod = async ({ from, to }, req) => {
  const result = await attendanceRepository.lockRange(req.user.tenantId ?? null, from, to);

  await recordAudit({
    req,
    entity: ENTITY,
    entityId: employeeRepository.toObjectId(req.user.id),
    action: AUDIT_ACTIONS.BULK_UPDATE,
    metadata: { action: 'LOCK_PERIOD', from, to, locked: result.modifiedCount },
  });

  logger.info('Attendance period locked', { from, to, count: result.modifiedCount });
  return { locked: result.modifiedCount ?? 0 };
};

export default {
  punch,
  markManual,
  recomputeDay,
  loadDayContext,
  listAttendance,
  getDailySummary,
  getMyToday,
  getMonthlyCalendar,
  getAttendance,
  getCompOffLedger,
  lockPeriod,
  SORTABLE_FIELDS,
};
