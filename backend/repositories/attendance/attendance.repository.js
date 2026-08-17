import Attendance from '../../models/attendance/attendance.model.js';
import AttendancePolicy from '../../models/attendance/attendancePolicy.model.js';
import Holiday from '../../models/attendance/holiday.model.js';
import CompOff from '../../models/attendance/compOff.model.js';
import { startOfDay } from '../../helpers/attendanceRules.helper.js';
import { COMP_OFF_STATUS } from '../../utils/constants.js';

const POPULATE = [
  {
    path: 'employeeId',
    select: 'employeeCode employeeId firstName lastName departmentId designationId shiftId',
    populate: [
      { path: 'departmentId', select: 'name code' },
      { path: 'designationId', select: 'name code' },
    ],
  },
];

/* ---------------------------------------------------------------- reads -- */

export const findByEmployeeAndDate = (employeeId, date) =>
  Attendance.findOne({ employeeId, date: startOfDay(date) });

export const findById = (id) => Attendance.findById(id).populate(POPULATE);

export const paginate = async ({ filter, sort, skip, limit }) => {
  const [items, total] = await Promise.all([
    Attendance.find(filter).sort(sort).skip(skip).limit(limit).populate(POPULATE).lean({ virtuals: true }),
    Attendance.countDocuments(filter),
  ]);

  return { items, total };
};

/** Whole-month window for one employee, used by the monthly report and payroll. */
export const findForRange = (filter) =>
  Attendance.find(filter).sort({ date: 1 }).populate(POPULATE).lean({ virtuals: true });

export const findRawForRange = (filter) => Attendance.find(filter).sort({ date: 1 }).lean();

/* --------------------------------------------------------------- writes -- */

/**
 * Upsert on (employee, date) -- the invariant every ingest path shares.
 *
 * `$setOnInsert` carries the fields that must not be overwritten when a second
 * source touches a day that already exists: a CSV backfill must not reset who
 * originally marked the record.
 */
export const upsertDay = (employeeId, date, { set = {}, setOnInsert = {}, push = null }) => {
  const update = { $set: set };
  if (Object.keys(setOnInsert).length) update.$setOnInsert = setOnInsert;
  if (push) update.$push = push;

  return Attendance.findOneAndUpdate({ employeeId, date: startOfDay(date) }, update, {
    new: true,
    upsert: true,
    runValidators: true,
    setDefaultsOnInsert: true,
  });
};

export const updateById = (id, update) =>
  Attendance.findByIdAndUpdate(id, update, { new: true, runValidators: true }).populate(POPULATE);

export const lockRange = (tenantId, from, to) =>
  Attendance.updateMany(
    { tenantId, date: { $gte: startOfDay(from), $lte: startOfDay(to) }, isLocked: false },
    { $set: { isLocked: true, lockedAt: new Date() } },
  );

/* ----------------------------------------------------------- aggregates -- */

/** Status counts for one date -- the register's summary strip. */
export const dailySummary = (filter) =>
  Attendance.aggregate([{ $match: filter }, { $group: { _id: '$status', count: { $sum: 1 } } }]);

/**
 * Per-employee monthly roll-up in a single aggregation.
 *
 * Doing this in Mongo rather than by pulling every day into Node matters at
 * scale: a 500-person month is 15,000 documents, and the report only needs
 * nine numbers per person.
 */
export const monthlyAggregate = (filter) =>
  Attendance.aggregate([
    { $match: filter },
    {
      $group: {
        _id: '$employeeId',
        present: { $sum: { $cond: [{ $eq: ['$status', 'PRESENT'] }, 1, 0] } },
        halfDay: { $sum: { $cond: [{ $eq: ['$status', 'HALF_DAY'] }, 1, 0] } },
        absent: { $sum: { $cond: [{ $eq: ['$status', 'ABSENT'] }, 1, 0] } },
        onLeave: { $sum: { $cond: [{ $eq: ['$status', 'ON_LEAVE'] }, 1, 0] } },
        holiday: { $sum: { $cond: [{ $eq: ['$status', 'HOLIDAY'] }, 1, 0] } },
        weeklyOff: { $sum: { $cond: [{ $eq: ['$status', 'WEEKLY_OFF'] }, 1, 0] } },
        missingPunch: { $sum: { $cond: [{ $eq: ['$status', 'MISSING_PUNCH'] }, 1, 0] } },
        lateCount: { $sum: { $cond: [{ $gt: ['$lateMinutes', 0] }, 1, 0] } },
        earlyGoingCount: { $sum: { $cond: [{ $gt: ['$earlyGoingMinutes', 0] }, 1, 0] } },
        totalLateMinutes: { $sum: '$lateMinutes' },
        totalWorkedMinutes: { $sum: '$workedMinutes' },
        totalOvertimeMinutes: { $sum: '$overtimeMinutes' },
        compOffEarnedDays: { $sum: '$compOffEarnedDays' },
      },
    },
  ]);

/**
 * Overtime minutes per DAY, and who contributed them.
 *
 * Grouped by the stored date rather than by `$month`, and folded into months by
 * the caller. `$month` reads the date in UTC, while every date in this system
 * is a local midnight -- so in any timezone ahead of UTC the first day of each
 * month is stamped 18:30 on the last day of the previous one, and its overtime
 * was being reported under the wrong month.
 *
 * `$addToSet` rather than a count: an employee with overtime on nine days is
 * one person, not nine.
 */
export const overtimeByDay = (filter) =>
  Attendance.aggregate([
    { $match: { ...filter, overtimeMinutes: { $gt: 0 } } },
    {
      $group: {
        _id: '$date',
        overtimeMinutes: { $sum: '$overtimeMinutes' },
        employees: { $addToSet: '$employeeId' },
      },
    },
    { $sort: { _id: 1 } },
  ]);

/* -------------------------------------------------------------- policy --- */

/**
 * Most specific policy wins: a department policy overrides the tenant default.
 * Falls back to the engine's built-in defaults when a tenant has configured
 * nothing at all, so attendance still computes on day one.
 */
export const resolvePolicy = async (tenantId, departmentId = null) => {
  const candidates = await AttendancePolicy.find({
    tenantId: tenantId ?? null,
    isActive: true,
    $or: [{ departmentId: departmentId ?? null }, { departmentId: null }],
  }).lean();

  if (!candidates.length) return null;

  return (
    candidates.find((policy) => String(policy.departmentId) === String(departmentId)) ??
    candidates.find((policy) => policy.departmentId === null) ??
    candidates[0]
  );
};

export const findHolidays = (tenantId, from, to) =>
  Holiday.find({
    tenantId: tenantId ?? null,
    isActive: true,
    date: { $gte: startOfDay(from), $lte: startOfDay(to) },
  }).lean();

/* ------------------------------------------------------------- comp off -- */

export const upsertCompOff = (employeeId, earnedOn, document) =>
  CompOff.findOneAndUpdate(
    { employeeId, earnedOn: startOfDay(earnedOn) },
    { $set: document },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

export const removeCompOff = (employeeId, earnedOn) =>
  CompOff.deleteOne({ employeeId, earnedOn: startOfDay(earnedOn), status: COMP_OFF_STATUS.EARNED });

export const compOffLedger = (filter) => CompOff.find(filter).sort({ earnedOn: -1 }).lean();

/** Usable balance: earned, unexpired, unconsumed. */
export const compOffBalance = async (employeeId) => {
  const rows = await CompOff.aggregate([
    {
      $match: {
        employeeId,
        status: COMP_OFF_STATUS.EARNED,
        expiresAt: { $gt: new Date() },
      },
    },
    { $group: { _id: null, days: { $sum: '$days' } } },
  ]);

  return rows[0]?.days ?? 0;
};

export default {
  findByEmployeeAndDate,
  findById,
  paginate,
  findForRange,
  findRawForRange,
  upsertDay,
  updateById,
  lockRange,
  dailySummary,
  monthlyAggregate,
  overtimeByDay,
  resolvePolicy,
  findHolidays,
  upsertCompOff,
  removeCompOff,
  compOffLedger,
  compOffBalance,
};
