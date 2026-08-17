import Shift from '../../models/organization/shift.model.js';
import attendanceRepository from '../../repositories/attendance/attendance.repository.js';
import { resolveWeeklyOffDays } from '../../helpers/manualAttendance.helper.js';

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

export default { weeklyOffDaysForEmployee, weeklyOffDaysByEmployee };
