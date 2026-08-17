import Attendance from '../../models/attendance/attendance.model.js';
import logger from '../../config/logger.js';
import {
  dutyMinutesFor,
  overtimeMinutesFor,
} from '../../helpers/manualAttendance.helper.js';
import { weeklyOffDaysForEmployee } from './weeklyOff.service.js';

/**
 * Brings stored attendance days back in step with the employee's overtime
 * configuration.
 *
 * Overtime is derived when a day is written -- on import, on a manual edit --
 * from the employee's eligibility and duty hours as they stood at that moment.
 * That is what makes the stored record self-consistent, but it also means the
 * figures go stale the moment either setting changes afterwards.
 *
 * That is exactly what happened: a month was imported at 07:19 while the
 * employee was not overtime-eligible, so every day was correctly written with
 * nil overtime; eligibility was switched on at 07:25, and nothing revisited the
 * days already on file. The Edit Attendance dialog recomputes as you type and
 * so showed 01:22, while the Monthly Attendance grid read the stored nil and
 * showed 00:00. Two different answers for the same day, from the same rule
 * applied at two different times.
 *
 * Re-deriving here from the times already stored is what closes that gap. It
 * reuses `overtimeMinutesFor`, so there is one overtime rule in the system and
 * this is not a second implementation of it.
 *
 * Deliberately narrow: it touches `overtimeMinutes` and `expectedMinutes` and
 * nothing else. Times, status, worked minutes and every other field on the day
 * are the administrator's and are left exactly as they are.
 *
 * @param {object} employee  The saved employee, with overtime settings.
 * @param {object} [options]
 * @param {Date}   [options.from]    Only days on or after this date.
 * @param {boolean}[options.dryRun]  Report what would change without writing.
 * @returns {Promise<{scanned: number, updated: number}>}
 */
export const recomputeOvertimeForEmployee = async (employee, { from = null, dryRun = false } = {}) => {
  if (!employee?._id) return { scanned: 0, updated: 0 };

  const filter = { employeeId: employee._id };
  if (from) filter.date = { $gte: from };

  const days = await Attendance.find(filter)
    .select('_id date status workedMinutes overtimeMinutes expectedMinutes')
    .lean();

  const expectedMinutes = dutyMinutesFor(employee);

  // Resolved once for the employee: their roster is a property of the employee,
  // not of the day, so it does not need re-reading per row.
  const weeklyOffDays = await weeklyOffDaysForEmployee(employee);

  const operations = [];

  days.forEach((day) => {
    const overtimeMinutes = overtimeMinutesFor(day.workedMinutes ?? 0, employee, day.status, {
      date: day.date,
      weeklyOffDays,
    });

    // Only write where something actually differs, so an unrelated employee
    // edit does not touch every attendance row they have ever had.
    if (overtimeMinutes === (day.overtimeMinutes ?? 0) && expectedMinutes === (day.expectedMinutes ?? null)) return;

    operations.push({
      updateOne: {
        filter: { _id: day._id },
        update: { $set: { overtimeMinutes, expectedMinutes } },
      },
    });
  });

  if (operations.length && !dryRun) await Attendance.bulkWrite(operations, { ordered: false });

  return { scanned: days.length, updated: operations.length };
};

const shiftIdOf = (employee) => {
  const id = employee?.shiftId?._id ?? employee?.shiftId ?? null;
  return id ? String(id) : null;
};

/**
 * Whether an employee edit changed anything overtime depends on.
 *
 * Kept beside the recompute so the caller does not have to know which fields
 * matter. All are read from the document rather than the payload, because a
 * payload may carry a field without changing its value.
 *
 * The shift is on the list because it carries the weekly offs, and a day worked
 * on a weekly off is priced as overtime in full. Moving someone from a
 * Sunday-off roster to a Saturday-off one changes what their stored Sundays and
 * Saturdays are worth, and without this the grid would keep reporting the
 * figures the old roster produced -- which is precisely how the monthly total
 * and the edit dialog came to disagree.
 */
export const overtimeSettingsChanged = (before, after) =>
  Boolean(before) && Boolean(after)
  && (before.overtimeEligible !== after.overtimeEligible
    || (before.standardDutyMinutes ?? null) !== (after.standardDutyMinutes ?? null)
    || shiftIdOf(before) !== shiftIdOf(after));

/**
 * Recompute after an employee save, when and only when it is warranted.
 *
 * Never throws into the caller: an employee edit that has already been accepted
 * and audited must not fail because a follow-up recalculation did.
 */
export const syncOvertimeAfterEmployeeChange = async (before, after) => {
  if (!overtimeSettingsChanged(before, after)) return null;

  try {
    const result = await recomputeOvertimeForEmployee(after);

    logger.info('Attendance overtime recomputed after an employee change', {
      employeeId: String(after._id),
      employeeCode: after.employeeCode,
      overtimeEligible: after.overtimeEligible,
      ...result,
    });

    return result;
  } catch (error) {
    logger.error('Could not recompute attendance overtime after an employee change', {
      employeeId: String(after._id),
      error: error.message,
    });
    return null;
  }
};

export default { recomputeOvertimeForEmployee, overtimeSettingsChanged, syncOvertimeAfterEmployeeChange };
