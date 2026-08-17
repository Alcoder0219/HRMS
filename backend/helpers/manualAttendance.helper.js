/**
 * Manual attendance arithmetic.
 *
 * The whole of it. There is no policy here, no shift, no grace time, no
 * rounding and no minimum or maximum -- deliberately, because in this phase of
 * the product the administrator is the authority on what a day was, and the
 * server's only job is to hold what they said.
 *
 * Two figures are derived rather than typed, because they are pure functions of
 * values the administrator did type:
 *
 *   working hours = out time - in time
 *   overtime      = working hours - the employee's standard duty hours
 *
 * Deriving them server-side rather than accepting them from the browser keeps
 * the stored record self-consistent: a day can never claim eight hours between
 * a 09:30 in and an 18:00 out. The administrator sees the same numbers, because
 * the same two lines of arithmetic run in the dialog as they type.
 *
 * This file is intentionally separate from attendanceRules.helper.js. That is
 * the automatic engine -- shifts, weekly offs, late marks, half-day thresholds
 * -- and it still serves the punch, biometric and regularization paths. Manual
 * attendance must not touch it, so it does not import it.
 */

/** 08:30, the company default when an employee has no figure of their own. */
export const DEFAULT_DUTY_MINUTES = 510;

/** A day cannot be longer than a day, whichever way the punches read. */
const MINUTES_PER_DAY = 1440;

/**
 * 0 = Sunday, matching `Date#getDay`. The company default when neither the
 * shift nor the attendance policy says otherwise -- the same fallback the rules
 * engine and the leave calculator use, so all three agree on which day is a
 * rest day.
 */
export const DEFAULT_WEEKLY_OFF_DAYS = [0];

const normalizeWeeklyOffDays = (value) =>
  Array.isArray(value)
    ? [...new Set(value.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))]
    : [];

/**
 * Which weekdays are this employee's rest days.
 *
 * The shift's own weekly offs win over the policy default -- a night-shift
 * roster often rests on a different day from the office -- which is the same
 * precedence `loadDayContext` and the leave calculator already apply. Nothing
 * here assumes Sunday: an employee whose shift rests on Saturday gets Saturday.
 */
export const resolveWeeklyOffDays = (shift = null, policy = null) => {
  const fromShift = normalizeWeeklyOffDays(shift?.weeklyOffs);
  if (fromShift.length) return fromShift;

  const fromPolicy = normalizeWeeklyOffDays(policy?.weeklyOffs);
  if (fromPolicy.length) return fromPolicy;

  return DEFAULT_WEEKLY_OFF_DAYS;
};

/**
 * Whether a date falls on one of the employee's rest days.
 *
 * An unknown roster answers "no" rather than falling back to Sunday. A caller
 * that has not resolved the employee's weekly offs cannot be allowed to hand
 * every employee a Sunday one by omission -- that would create overtime for
 * people whose rest day is Saturday.
 */
export const isWeeklyOffDate = (date, weeklyOffDays = null) => {
  const days = normalizeWeeklyOffDays(weeklyOffDays);
  if (!days.length || !date) return false;

  const day = new Date(date);
  return Number.isNaN(day.getTime()) ? false : days.includes(day.getDay());
};

/**
 * Statuses that mean the employee actually worked the day.
 *
 * The rest-day rule is gated on these because worked minutes are derived from
 * whatever times are on the record, and times can sit on a day marked ABSENT or
 * ON_LEAVE. Without the gate, a Sunday marked ON_LEAVE that still carried an
 * old punch pair would silently earn a day of overtime.
 */
const WORKED_STATUSES = new Set(['PRESENT', 'HALF_DAY', 'ON_DUTY', 'WORK_FROM_HOME']);

/**
 * Whether the day being priced is work done on a rest day.
 *
 * Two ways in, and both are needed:
 *
 *   1. The administrator marked the day WEEKLY_OFF. This is the original rule
 *      and is unchanged.
 *   2. The date falls on the employee's configured weekly off and they worked
 *      it. This is the case that was missing: an employee who works their
 *      Sunday is marked PRESENT -- by the administrator, or by the times alone
 *      -- so the status no longer says "rest day" even though the calendar
 *      does, and the day was being priced as an ordinary one.
 *
 * A holiday is deliberately not included: only the weekly-off rule was asked
 * for, and a holiday keeps the ordinary beyond-duty-hours treatment.
 */
const isRestDayWork = (status, date, weeklyOffDays) => {
  if (status === 'WEEKLY_OFF') return true;
  if (!WORKED_STATUSES.has(status)) return false;

  return isWeeklyOffDate(date, weeklyOffDays);
};

/**
 * Reads a duty-hours figure from whatever shape it arrives in.
 *
 * The database holds minutes, but a person types "08:30" and an API caller may
 * send 8.5 or "510". All four mean the same thing and all four are accepted;
 * anything unreadable returns null so the caller can fall back rather than
 * silently storing a zero-hour duty day, which would make every worked minute
 * overtime.
 */
export const parseDutyMinutes = (value) => {
  if (value === null || value === undefined || value === '') return null;

  if (typeof value === 'string' && value.includes(':')) {
    const [hours, minutes] = value.split(':');
    const total = Number(hours) * 60 + Number(minutes);
    return Number.isFinite(total) && total >= 0 && total <= MINUTES_PER_DAY ? Math.round(total) : null;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;

  // Whole numbers are minutes; a fraction can only have been meant as hours,
  // since half a minute is not a thing anyone configures.
  const total = Number.isInteger(numeric) ? numeric : numeric * 60;
  return total <= MINUTES_PER_DAY ? Math.round(total) : null;
};

/** Minutes as HH:MM. 270 -> "04:30". */
export const formatMinutes = (minutes) => {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

/**
 * The employee's own duty hours, or the company default.
 *
 * Written to tolerate a `.lean()` document, where Mongoose applies no schema
 * defaults -- every employee stored before this field existed reads `undefined`
 * and must land on 08:30 rather than on zero.
 */
export const dutyMinutesFor = (employee) =>
  parseDutyMinutes(employee?.standardDutyMinutes) ?? DEFAULT_DUTY_MINUTES;

/**
 * Working hours: the plain span between the two times.
 *
 * An out time earlier than the in time is read as the following morning, which
 * is the only interpretation that makes sense of a night worker's 22:00 to
 * 06:00. That is arithmetic on the two values given, not a shift rule -- no
 * roster is consulted and no night-shift flag is required.
 *
 * A missing time means there is nothing to measure, so the day is zero rather
 * than a guess.
 */
export const workedMinutesBetween = (checkIn, checkOut) => {
  if (!checkIn || !checkOut) return 0;

  const from = new Date(checkIn).getTime();
  const to = new Date(checkOut).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;

  const span = Math.round((to - from) / 60_000);
  const normalized = span < 0 ? span + MINUTES_PER_DAY : span;

  return Math.min(Math.max(0, normalized), MINUTES_PER_DAY);
};

/**
 * Overtime: everything worked beyond the employee's own duty hours -- except on
 * a weekly off, where every worked minute is overtime.
 *
 * No duty hours are owed on a rest day, so there is nothing to work through
 * before overtime begins: four hours on a Sunday is four hours of overtime, not
 * zero because four is less than eight and a half. On any other day the rule is
 * unchanged -- the shift's threshold still governs an ordinary day.
 *
 * The rest day is recognised two ways, from the status AND from the calendar.
 * The status alone was not enough, and that is the bug this fixes: an employee
 * who works their Sunday is PRESENT, not WEEKLY_OFF, so 07:47 worked was priced
 * against 08:30 of duty and came out at nil. `weeklyOffDays` is the employee's
 * own roster -- their shift's weekly offs, or the attendance policy's -- so an
 * employee who rests on Saturday gets the rule on Saturday. Callers that do not
 * supply it keep the status-only behaviour.
 *
 * Holidays are deliberately NOT included. Only the weekly-off rule was asked
 * for, and a holiday keeps the ordinary beyond-duty-hours treatment.
 *
 * No floor, no ceiling, no rounding and no multiplier. The multiplier is a
 * pricing decision and belongs to payroll; storing multiplied minutes here
 * would mean the attendance record no longer says how long someone worked.
 *
 * An employee who is not marked overtime-eligible records none, however long
 * the day ran and whichever day it was.
 */
export const overtimeMinutesFor = (
  workedMinutes,
  employee,
  status = null,
  { date = null, weeklyOffDays = null } = {},
) => {
  if (!employee?.overtimeEligible) return 0;

  const worked = Math.max(0, Math.round(Number(workedMinutes) || 0));
  // Nothing worked is nothing owed, whichever day it was -- which is what makes
  // a weekly off that was absent, on leave or unpunched come out at 00:00.
  if (!worked) return 0;

  if (isRestDayWork(status, date, weeklyOffDays)) return worked;
  return Math.max(0, worked - dutyMinutesFor(employee));
};

/**
 * The status implied by the two times, used only where nobody has said.
 *
 * This is not the automatic status engine: it reads no calendar, no roster and
 * no holiday list, so it can never decide a Sunday is a weekly off or that a
 * short day is a half day. It answers one question -- were both times given --
 * and the administrator overrides it whenever they disagree.
 */
export const statusFromTimes = (checkIn, checkOut) => {
  if (checkIn && checkOut) return 'PRESENT';
  if (checkIn || checkOut) return 'MISSING_PUNCH';
  return 'ABSENT';
};

/**
 * Everything a stored day needs, from the four values a human supplies.
 *
 * One function so the manual edit path and the Excel import path cannot drift
 * apart -- the complaint that started this work was that an imported day and
 * an edited day disagreed about the same hours.
 *
 * `date` and `weeklyOffDays` are what let the day know whether it is a rest day
 * the employee worked. They change nothing else about the record: the status,
 * the times and the working hours are still exactly what was supplied.
 */
export const deriveManualDay = ({
  checkIn,
  checkOut,
  status,
  employee,
  date = null,
  weeklyOffDays = null,
}) => {
  const workedMinutes = workedMinutesBetween(checkIn, checkOut);

  // The status is resolved BEFORE overtime, because overtime depends on it: a
  // weekly off is paid differently from an ordinary day.
  const resolved = status || statusFromTimes(checkIn, checkOut);
  const overtimeMinutes = overtimeMinutesFor(workedMinutes, employee, resolved, {
    // The day the record belongs to. Falls back to the entry punch so a caller
    // that supplies a roster but no date still prices the right weekday.
    date: date ?? checkIn ?? checkOut ?? null,
    weeklyOffDays,
  });

  return {
    checkInAt: checkIn ? new Date(checkIn) : null,
    checkOutAt: checkOut ? new Date(checkOut) : null,
    status: resolved,
    workedMinutes,
    overtimeMinutes,
    expectedMinutes: dutyMinutesFor(employee),

    // Derived from the status the administrator chose, never from a calendar.
    isWeeklyOff: resolved === 'WEEKLY_OFF',
    isHoliday: resolved === 'HOLIDAY',

    /**
     * Late and early-going marks are zeroed rather than left behind.
     *
     * Both are products of shift rules and grace periods, which no longer run.
     * Leaving an old engine-written figure in place would show a late mark on a
     * day whose times the administrator has since corrected, with nothing in
     * the system able to explain or clear it.
     */
    lateMinutes: 0,
    earlyGoingMinutes: 0,
  };
};

export default {
  DEFAULT_DUTY_MINUTES,
  DEFAULT_WEEKLY_OFF_DAYS,
  parseDutyMinutes,
  formatMinutes,
  dutyMinutesFor,
  resolveWeeklyOffDays,
  isWeeklyOffDate,
  workedMinutesBetween,
  overtimeMinutesFor,
  statusFromTimes,
  deriveManualDay,
};
