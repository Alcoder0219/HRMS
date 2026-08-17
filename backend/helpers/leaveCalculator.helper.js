import { LEAVE_ACCRUAL, LEAVE_SESSION } from '../utils/constants.js';

/**
 * Leave arithmetic.
 *
 * Pure: no database, no clock, no request. Every input is passed in, so the
 * rules can be exercised against fixtures rather than against whatever happens
 * to be in the database today -- the same shape as the attendance, salary and
 * settlement engines.
 */

/** Midnight local, so a date is compared as a day rather than an instant. */
export const startOfDay = (value) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

const sameDay = (a, b) => startOfDay(a).getTime() === startOfDay(b).getTime();

/**
 * Expands a date range into individual days, marking which of them the leave
 * type actually consumes.
 *
 * A weekly off or a holiday inside a long leave is included in the breakdown
 * with `days: 0` rather than dropped, so the request shows the calendar span it
 * covers as well as the entitlement it costs. `countsHolidays` flips that --
 * some organisations charge sandwiched days, most do not.
 */
export const expandLeaveDays = ({
  from,
  to,
  weeklyOffs = [0],
  holidays = [],
  countsHolidays = false,
  isHalfDay = false,
  session = null,
}) => {
  const start = startOfDay(from);
  const end = startOfDay(to);

  if (end < start) return [];

  const holidayTimes = new Set(holidays.map((holiday) => startOfDay(holiday.date ?? holiday).getTime()));
  const offDays = new Set(weeklyOffs);

  const breakdown = [];

  for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const day = startOfDay(cursor);
    const isWeeklyOff = offDays.has(day.getDay());
    const isHoliday = holidayTimes.has(day.getTime());

    if (!countsHolidays && (isWeeklyOff || isHoliday)) {
      breakdown.push({
        date: new Date(day),
        days: 0,
        session: null,
        reason: isHoliday ? 'Holiday' : 'Weekly off',
      });
      continue;
    }

    breakdown.push({
      date: new Date(day),
      // A half day only ever applies to a single-date request, which the model
      // enforces -- so it is safe to apply here without checking the span.
      days: isHalfDay ? 0.5 : 1,
      session: isHalfDay ? (session ?? LEAVE_SESSION.FIRST_HALF) : null,
      reason: null,
    });
  }

  return breakdown;
};

/** Days the request costs, which is not the number of dates it spans. */
export const countLeaveDays = (breakdown = []) =>
  Number(breakdown.reduce((sum, day) => sum + (day.days ?? 0), 0).toFixed(2));

/**
 * Entitlement earned so far this year.
 *
 * ANNUAL grants the whole allowance up front. MONTHLY earns it in twelfths, and
 * a joiner part-way through earns only from the month they joined -- which is
 * the figure a leaver's settlement has to be built on.
 */
export const accruedEntitlement = ({
  daysPerYear = 0,
  accrual = LEAVE_ACCRUAL.ANNUAL,
  year,
  asOf,
  joiningDate = null,
}) => {
  if (accrual === LEAVE_ACCRUAL.NONE || !daysPerYear) return 0;
  if (accrual === LEAVE_ACCRUAL.ANNUAL) return daysPerYear;

  const reference = startOfDay(asOf);
  // A future year has earned nothing; a past year earned all of it.
  if (reference.getFullYear() < year) return 0;
  if (reference.getFullYear() > year) return daysPerYear;

  const joined = joiningDate ? startOfDay(joiningDate) : null;
  const startMonth = joined && joined.getFullYear() === year ? joined.getMonth() : 0;
  const endMonth = reference.getMonth();

  if (endMonth < startMonth) return 0;

  const monthsEarned = endMonth - startMonth + 1;
  const perMonth = daysPerYear / 12;

  return Number(Math.min(daysPerYear, monthsEarned * perMonth).toFixed(2));
};

/**
 * What survives into next year.
 *
 * Capped by the type's own limit, and never more than is actually left. The
 * remainder lapses and is reported rather than silently dropped -- an employee
 * losing five days at year end should be able to see that it happened.
 */
export const carryForwardable = ({ available = 0, carryForward = {} }) => {
  if (!carryForward.enabled || available <= 0) {
    return { carried: 0, lapsed: Math.max(0, available) };
  }

  const cap = carryForward.maxDays > 0 ? carryForward.maxDays : available;
  const carried = Number(Math.min(available, cap).toFixed(2));

  return { carried, lapsed: Number((available - carried).toFixed(2)) };
};

/**
 * How many days may be paid out.
 *
 * Bounded by three separate limits, and the tightest wins: the type's ceiling,
 * the floor it insists on leaving behind, and what the employee actually has.
 */
export const encashableDays = ({ available = 0, encashment = {}, requested = null }) => {
  if (!encashment.enabled) return { allowed: 0, reason: 'Encashment is not enabled for this leave type' };

  const retained = encashment.minBalanceToRetain ?? 0;
  const spare = available - retained;

  if (spare <= 0) {
    return { allowed: 0, reason: `At least ${retained} day(s) must remain in the balance` };
  }

  const cap = encashment.maxDays > 0 ? Math.min(encashment.maxDays, spare) : spare;
  const allowed = Number(cap.toFixed(2));

  if (requested === null) return { allowed, reason: null };

  if (requested > allowed) {
    return { allowed, reason: `At most ${allowed} day(s) can be encashed` };
  }

  return { allowed: Number(requested.toFixed(2)), reason: null };
};

/**
 * Whether a request may be raised at all.
 *
 * Returns every problem rather than the first, so an application is corrected
 * in one pass instead of one rejection at a time.
 */
export const validateRequest = ({
  type = {},
  days = 0,
  from,
  asOf = new Date(),
  balance = null,
  employee = {},
  overlapping = [],
}) => {
  const problems = [];

  if (days <= 0) {
    problems.push('This range contains no working days for this leave type');
  }

  if (type.minNoticeDays > 0) {
    const noticeDays = Math.floor((startOfDay(from) - startOfDay(asOf)) / 86_400_000);
    if (noticeDays < type.minNoticeDays) {
      problems.push(`${type.name} needs ${type.minNoticeDays} day(s) notice`);
    }
  }

  if (type.maxConsecutiveDays > 0 && days > type.maxConsecutiveDays) {
    problems.push(`${type.name} allows at most ${type.maxConsecutiveDays} consecutive day(s)`);
  }

  if (type.applicableGender && employee.gender && employee.gender !== type.applicableGender) {
    problems.push(`${type.name} does not apply to this employee`);
  }

  if (type.applicableAfterMonths > 0 && employee.joiningDate) {
    const months =
      (startOfDay(asOf).getFullYear() - startOfDay(employee.joiningDate).getFullYear()) * 12 +
      (startOfDay(asOf).getMonth() - startOfDay(employee.joiningDate).getMonth());

    if (months < type.applicableAfterMonths) {
      problems.push(`${type.name} becomes available ${type.applicableAfterMonths} month(s) after joining`);
    }
  }

  if (overlapping.length > 0) {
    problems.push('These dates overlap leave that has already been applied for');
  }

  /**
   * Checked against what is left AFTER pending requests, not against the raw
   * balance -- otherwise three applications for the last five days would all
   * pass and the third would be honoured against nothing.
   */
  if (balance && !type.allowNegativeBalance) {
    const usable = balance.usable ?? balance.available ?? 0;
    if (days > usable) {
      problems.push(`Only ${usable} day(s) are available, including leave already applied for`);
    }
  }

  return problems;
};

export default {
  startOfDay,
  expandLeaveDays,
  countLeaveDays,
  accruedEntitlement,
  carryForwardable,
  encashableDays,
  validateRequest,
};
