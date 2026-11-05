import Shift from '../../models/organization/shift.model.js';
import attendanceRepository from '../../repositories/attendance/attendance.repository.js';
import { startOfDay } from '../../helpers/attendanceRules.helper.js';
import { isWeeklyOffDate, resolveWeeklyOffDays } from '../../helpers/manualAttendance.helper.js';

/**
 * Which weekdays an employee rests on, read from the configuration that already
 * decides it everywhere else.
 *
 * The precedence -- the shift's own weekly offs, then the attendance policy's,
 * then Sunday -- lives in `resolveWeeklyOffDays`; this is only the impure half
 * that fetches the two documents. Kept out of `attendance.service.js` so the
 * reports and the recompute can use it without importing the write path and
 * creating a cycle.
 */
export const weeklyOffDaysForEmployee = async (employee, { policy = null } = {}) => {
  if (!employee) return resolveWeeklyOffDays(null, null);

  const shiftId = employee.shiftId?._id ?? employee.shiftId ?? null;

  // A populated shift already carries what is needed; only a bare id costs a
  // query.
  const shift = employee.shiftId?.weeklyOffs
    ? employee.shiftId
    : shiftId
      ? await Shift.findById(shiftId).select('weeklyOffs').lean()
      : null;

  const resolvedPolicy =
    policy ??
    (await attendanceRepository.resolvePolicy(
      employee.tenantId ?? null,
      employee.departmentId?._id ?? employee.departmentId ?? null,
    ));

  return resolveWeeklyOffDays(shift, resolvedPolicy);
};

/**
 * The same answer for a whole list, in a handful of queries rather than two per
 * employee.
 *
 * The monthly register asks this for every employee in scope -- 500 of them on
 * a large tenant -- so shifts are fetched in one query and each distinct
 * tenant/department policy is resolved once.
 *
 * @returns {Promise<Map<string, number[]>>} employee id -> weekday numbers
 */
export const weeklyOffDaysByEmployee = async (employees = [], { tenantId = null } = {}) => {
  const result = new Map();
  if (!employees.length) return result;

  const shiftIdOf = (employee) => {
    const id = employee.shiftId?._id ?? employee.shiftId ?? null;
    return id ? String(id) : null;
  };
  const departmentIdOf = (employee) => {
    const id = employee.departmentId?._id ?? employee.departmentId ?? null;
    return id ? String(id) : null;
  };

  const missingShiftIds = [
    ...new Set(
      employees
        .filter((employee) => !employee.shiftId?.weeklyOffs)
        .map(shiftIdOf)
        .filter(Boolean),
    ),
  ];

  const shifts = missingShiftIds.length
    ? await Shift.find({ _id: { $in: missingShiftIds } }).select('weeklyOffs').lean()
    : [];
  const shiftById = new Map(shifts.map((shift) => [String(shift._id), shift]));

  const policyCache = new Map();
  const policyFor = async (employee) => {
    const employeeTenantId = employee.tenantId ?? tenantId ?? null;
    const departmentId = departmentIdOf(employee);
    const key = `${employeeTenantId ?? ''}|${departmentId ?? ''}`;

    if (!policyCache.has(key)) {
      policyCache.set(key, await attendanceRepository.resolvePolicy(employeeTenantId, departmentId));
    }
    return policyCache.get(key);
  };

  for (const employee of employees) {
    const shift = employee.shiftId?.weeklyOffs ? employee.shiftId : shiftById.get(shiftIdOf(employee));
    result.set(String(employee._id), resolveWeeklyOffDays(shift, await policyFor(employee)));
  }

  return result;
};

/**
 * The rest days in a month that have no attendance record.
 *
 * Attendance is only stored for days something happened, so an unworked Sunday
 * has no row and a report reading rows alone shows it blank. These are shown as
 * weekly offs at read time, exactly as the personal calendar does, and nothing
 * is written.
 *
 * A record always wins, because it is what actually happened: a worked Sunday,
 * leave or a correction stay as they are. A day that is a holiday for this
 * employee is left to the holiday rules, and days before they joined or after
 * they left are not theirs to rest on.
 *
 * `elapsed` counts only days that have happened: every rest day is displayed,
 * but a total must not claim days that are still to come.
 *
 * @param {object}   input
 * @param {Set}      input.recordedDays  Day numbers of the month that have a record
 * @returns {{ days: Set<number>, elapsed: number }}
 */
export const unrecordedWeeklyOffs = ({
  year,
  month,
  employee,
  weeklyOffDays,
  recordedDays,
  holidays = [],
  now = new Date(),
}) => {
  const lastDay = new Date(year, month, 0).getDate();
  const joined = employee.joiningDate ? startOfDay(employee.joiningDate) : null;
  const left = employee.lifecycle?.lastWorkingDate ? startOfDay(employee.lifecycle.lastWorkingDate) : null;
  const departmentId = String(employee.departmentId?._id ?? employee.departmentId ?? '');
  const today = startOfDay(now);

  const holidayDays = new Set(
    holidays
      .filter(
        (entry) =>
          !entry.isOptional &&
          // An empty department list means the holiday applies to everyone.
          (!entry.departmentIds?.length || entry.departmentIds.some((id) => String(id) === departmentId)),
      )
      .map((entry) => startOfDay(entry.date).getTime()),
  );

  const days = new Set();
  let elapsed = 0;

  for (let dayNumber = 1; dayNumber <= lastDay; dayNumber += 1) {
    // Built from the calendar date rather than a stored instant, so the weekday
    // cannot shift with a time zone. Noon, because not every zone has a midnight
    // on the day its clocks change.
    const date = new Date(year, month - 1, dayNumber, 12);
    const day = startOfDay(date);

    if (recordedDays.has(dayNumber) || !isWeeklyOffDate(date, weeklyOffDays)) continue;
    if (holidayDays.has(day.getTime())) continue;
    if ((joined && day < joined) || (left && day > left)) continue;

    days.add(dayNumber);
    if (day <= today) elapsed += 1;
  }

  return { days, elapsed };
};

export default { weeklyOffDaysForEmployee, weeklyOffDaysByEmployee, unrecordedWeeklyOffs };
