import { ATTENDANCE_SOURCE, ATTENDANCE_STATUS } from '../utils/constants.js';

/**
 * The attendance rules engine.
 *
 * Deliberately a pure function of (punches, shift, policy, calendar). No
 * database, no request context, no clock -- everything it needs is passed in.
 * That is what makes payroll-affecting logic testable against fixtures rather
 * than against a seeded database, and reproducible when someone disputes a
 * deduction six months later.
 */

const MINUTE = 60_000;

/** `HH:mm` on a given date, in local server time. */
export const timeOnDate = (date, hhmm) => {
  const [hours, minutes] = String(hhmm).split(':').map(Number);
  const result = new Date(date);
  result.setHours(hours, minutes, 0, 0);
  return result;
};

export const minutesBetween = (from, to) => Math.round((to - from) / MINUTE);

/** Midnight of the given date, so a day key never depends on punch time. */
export const startOfDay = (date) => {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
};

const minutesOfDay = (hhmm) => {
  const [hours, minutes] = String(hhmm).split(':').map(Number);
  return hours * 60 + minutes;
};

/**
 * The attendance day a device punch belongs to.
 *
 * For a day shift that is simply the calendar day. For a shift that crosses
 * midnight it is not: the 05:58 exit from a 22:00-06:00 shift belongs to the
 * day the shift STARTED, and filing it under the next calendar day splits one
 * shift into two half-records -- an entry with no exit, and an exit with no
 * entry -- both of which the engine then grades as missing punches.
 *
 * The boundary is the middle of the off-duty gap. For 22:00-06:00 that is
 * 14:00: anything earlier belongs to the shift that began the night before,
 * anything later to the one starting tonight. It is the one point equally far
 * from both shifts, so an early arrival and a late exit are both still read
 * correctly.
 *
 * Only shifts whose end is not after their start are treated this way -- the
 * same test `resolveShiftWindow` uses to extend the window past midnight -- so
 * this and the engine always agree about which shifts cross it.
 */
export const attributeShiftDay = (time, shift = null) => {
  const calendarDay = startOfDay(time);
  if (!shift?.startTime || !shift?.endTime) return calendarDay;

  const start = minutesOfDay(shift.startTime);
  const end = minutesOfDay(shift.endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end > start) return calendarDay;

  const cutoff = end + (start - end) / 2;
  const punchMinutes = new Date(time).getHours() * 60 + new Date(time).getMinutes();
  if (punchMinutes >= cutoff) return calendarDay;

  const previous = new Date(calendarDay);
  previous.setDate(previous.getDate() - 1);
  return previous;
};

/**
 * How long a full day is on this date if it is a Saturday, or 0.
 *
 * The shift's own Saturday time wins; otherwise the company's, from the
 * attendance policy, which applies to every employee -- including one with no
 * shift assigned, who has no window for a shift setting to act on. The date is
 * the attendance day key, so the weekday is the calendar day in the server's
 * zone. 0 from both means Saturday is graded like any weekday.
 */
export const saturdayMinutesFor = (date, shift = null, policy = null) => {
  if (!date || new Date(date).getDay() !== 6) return 0;

  const fromShift = Number(shift?.saturdayWorkMinutes) || 0;
  if (fromShift > 0) return fromShift;

  return Number(policy?.saturdayFullDayMinutes ?? DEFAULT_POLICY.saturdayFullDayMinutes) || 0;
};

/**
 * Shift window for a date, expanded across midnight for night shifts.
 *
 * A 22:00-06:00 shift ends on the following calendar day. Comparing an 05:00
 * exit against a same-day 06:00 end would otherwise read as a 19-hour early
 * departure.
 */
export const resolveShiftWindow = (date, shift, policy = null) => {
  if (!shift?.startTime || !shift?.endTime) return null;

  const deductBreak = !(policy?.countBreakAsWorked ?? DEFAULT_POLICY.countBreakAsWorked);
  const start = timeOnDate(date, shift.startTime);
  let end = timeOnDate(date, shift.endTime);

  if (end <= start) end = new Date(end.getTime() + 24 * 60 * MINUTE);

  /**
   * A shorter Saturday -- see `saturdayMinutesFor`.
   *
   * Saturday starts at the shift's usual time and lasts that long, so a full
   * day, lateness, early going and overtime are all judged against it by the
   * same rules as any other day, not a separate Saturday system. The break,
   * where it is deducted, is added back to the end so the length worked still
   * comes out at the configured figure. On any other day the window is exactly
   * the weekday one.
   */
  const saturdayMinutes = saturdayMinutesFor(date, shift, policy);
  if (saturdayMinutes > 0) {
    end = new Date(start.getTime() + (saturdayMinutes + (deductBreak ? (shift.breakMinutes ?? 0) : 0)) * MINUTE);
  }

  /**
   * The shift's length, measured the same way the day's work is.
   *
   * The break is subtracted here only when it is also subtracted from worked
   * minutes. Measuring one gross and the other net is what made a 09:30-18:00
   * shift behave as 07:30 long while the employee's day was counted at its
   * full span -- overtime then began an hour early. `countBreakAsWorked`
   * governs both sides so the two figures are always comparable.
   */
  return {
    start,
    end,
    durationMinutes: minutesBetween(start, end) - (deductBreak ? (shift.breakMinutes ?? 0) : 0),
    crossesMidnight: shift.isNightShift || end.getDate() !== start.getDate(),
  };
};

export const DEFAULT_POLICY = {
  fullDayMinutes: 480,
  halfDayMinutes: 240,
  lateGraceMinutes: 15,
  earlyGoingGraceMinutes: 15,
  overtimeEnabled: true,
  minOvertimeMinutes: 30,
  /**
   * A safety net against a stuck punch, not a business rule.
   *
   * Raised from 240: a four-hour ceiling silently truncated a legitimate
   * thirteen-hour day from 04:30 to 04:00, which reads as a calculation bug
   * rather than as a policy limit. Twelve hours still catches a device that
   * never registered an exit, and is configurable per tenant on the
   * Attendance Policy screen.
   */
  maxOvertimeMinutes: 720,
  /**
   * Retained for backward compatibility with stored policies, but no longer
   * consulted for the calculation.
   *
   * It used to switch overtime to a clock rule -- everything after the
   * rostered shift end. Company policy is that overtime begins once the
   * employee has completed their shift's LENGTH, whenever they started, so an
   * employee who begins at 13:00 and leaves at 22:30 has worked 9h30 and is
   * owed 1h00, not the 4h30 a clock rule produced.
   */
  overtimeAfterShiftEnd: true,
  compOffEnabled: true,
  compOffMinMinutes: 240,
  autoAbsentOnNoPunch: true,
  /**
   * Working hours are the span between the first punch and the last.
   *
   * The shift's own length is measured the same way, so the pair stay
   * comparable -- see `resolveShiftWindow`.
   */
  countBreakAsWorked: true,
  /**
   * Biometric punches this close to the one before are the same punch.
   *
   * A terminal that is touched twice in a row records two punches a minute
   * apart, and the second then read as the exit: a one-minute day. Inclusive,
   * so the default treats 08:30 and 08:32 as one punch. 0 turns it off.
   */
  duplicatePunchWindowMinutes: 2,
  /**
   * The company's Saturday: this much eligible work is a full day. 330 is
   * 5 h 30 m. A shift may set its own; 0 grades Saturday like a weekday.
   */
  saturdayFullDayMinutes: 330,
};

const isBiometric = (punch) => punch?.source === ATTENDANCE_SOURCE.BIOMETRIC;

/**
 * Reduces a punch log to the first entry and last exit.
 *
 * Biometric devices emit a punch per door swipe, so a day routinely has six or
 * eight. First-in / last-out is the standard interpretation; the intervening
 * punches stay on the record for audit but do not change the computation.
 *
 * Before that, a biometric punch within `duplicateWindowMinutes` of the last
 * one kept is set aside as a repeat of it, whichever terminal took it: the
 * earliest stands. It is compared with the last punch KEPT, not the last seen,
 * so a run of quick touches cannot creep forward into a real exit. Punches
 * entered by a person or a file are never set aside. Nothing is removed from
 * the record -- this only decides which punches are read.
 */
export const reducePunches = (punches = [], { duplicateWindowMinutes = 0 } = {}) => {
  const valid = [...punches].filter((punch) => punch?.time);
  const ordered = valid.sort((a, b) => new Date(a.time) - new Date(b.time));

  const windowMs = Math.max(0, Number(duplicateWindowMinutes) || 0) * MINUTE;
  const sorted = [];
  let duplicates = 0;

  ordered.forEach((punch) => {
    const previous = sorted[sorted.length - 1];
    const repeat =
      windowMs > 0 &&
      previous &&
      isBiometric(punch) &&
      isBiometric(previous) &&
      new Date(punch.time) - new Date(previous.time) <= windowMs;

    if (repeat) duplicates += 1;
    else sorted.push(punch);
  });

  if (!sorted.length) {
    return { checkIn: null, checkOut: null, punchCount: 0, directionConflict: false, duplicates };
  }

  /**
   * Sorting means first/last can never themselves be inverted, so a reversed
   * pair only shows up as a contradiction between the timestamps and the
   * direction labels -- an entry stamped OUT before any IN. That is what a
   * transposed spreadsheet column looks like, and it must not silently become
   * a normal working day.
   */
  const labelledIns = sorted.filter((punch) => punch.direction === 'IN');
  const labelledOuts = sorted.filter((punch) => punch.direction === 'OUT');
  const directionConflict =
    labelledIns.length > 0 &&
    labelledOuts.length > 0 &&
    new Date(labelledOuts[labelledOuts.length - 1].time) < new Date(labelledIns[0].time);

  return {
    checkIn: sorted[0],
    // A single punch is an entry, not an entry and an exit at the same instant.
    checkOut: sorted.length > 1 ? sorted[sorted.length - 1] : null,
    punchCount: sorted.length,
    directionConflict,
    duplicates,
  };
};

/**
 * Evaluates one employee-day.
 *
 * @param {object}  input
 * @param {Date}    input.date
 * @param {Array}   input.punches      Raw punch log for the day
 * @param {object}  input.shift        { startTime, endTime, breakMinutes, isNightShift, weeklyOffs }
 * @param {object}  input.policy       Overrides for DEFAULT_POLICY
 * @param {object}  input.holiday      Holiday record, if the date is one
 * @param {boolean} input.isWeeklyOff
 * @param {boolean} input.onLeave      Approved leave covering this date
 * @param {string}  input.overrideStatus  Manually set status (ON_DUTY, WFH)
 */
export const evaluateDay = ({
  date,
  punches = [],
  shift = null,
  policy: policyOverrides = {},
  holiday = null,
  isWeeklyOff = false,
  onLeave = false,
  overrideStatus = null,
}) => {
  const policy = { ...DEFAULT_POLICY, ...policyOverrides };
  // The policy is passed through so the shift's length and the day's worked
  // minutes treat the break the same way.
  const window = resolveShiftWindow(date, shift, policy);
  const { checkIn, checkOut, punchCount, directionConflict, duplicates } = reducePunches(punches, {
    duplicateWindowMinutes: policy.duplicatePunchWindowMinutes,
  });

  /**
   * A full day is measured against the roster, capped by policy.
   *
   * Judging a 22:00-06:00 night shift (450 working minutes) against a flat
   * 480-minute bar would grade someone who worked their entire rostered shift
   * as a half day -- and dock their pay for it. The cap keeps the policy
   * meaningful for over-long shifts: rostering ten hours does not raise the
   * bar for a full day above the eight the policy defines.
   */
  /**
   * On a Saturday the day is that long. With a shift the window already says
   * so; without one there is no window, and the company's Saturday applies
   * directly -- an employee without a shift is not held to a weekday on
   * Saturday. Either way the bar is never above the Saturday figure, so 5h30
   * worked is always a full day and the weekday half-day bar cannot override it.
   */
  const saturdayMinutes = saturdayMinutesFor(date, shift, policy);
  const dayMinutes = window ? window.durationMinutes : saturdayMinutes || policy.fullDayMinutes;

  const fullDayBar = Math.min(policy.fullDayMinutes, dayMinutes);
  const halfDayBar = Math.min(policy.halfDayMinutes, fullDayBar / 2);

  const result = {
    status: ATTENDANCE_STATUS.ABSENT,
    checkInAt: checkIn?.time ? new Date(checkIn.time) : null,
    checkOutAt: checkOut?.time ? new Date(checkOut.time) : null,
    punchCount,
    // Repeat biometric punches set aside -- reported, not stored, and not an
    // anomaly: a double touch is not something HR has to resolve.
    duplicatePunches: duplicates,
    workedMinutes: 0,
    breakMinutes: shift?.breakMinutes ?? 0,
    lateMinutes: 0,
    earlyGoingMinutes: 0,
    overtimeMinutes: 0,
    isHoliday: Boolean(holiday),
    isWeeklyOff,
    isNightShift: Boolean(window?.crossesMidnight),
    compOffEarnedDays: 0,
    shiftStart: window?.start ?? null,
    shiftEnd: window?.end ?? null,
    expectedMinutes: dayMinutes,
    anomalies: [],
  };

  /* --- worked time ------------------------------------------------------ */
  if (directionConflict) {
    // Transposed columns or a mislabelled device feed. Flagged and left at
    // zero rather than quietly counted as a normal day.
    result.anomalies.push('CHECKOUT_BEFORE_CHECKIN');
  } else if (checkIn?.time && checkOut?.time) {
    const gross = minutesBetween(new Date(checkIn.time), new Date(checkOut.time));

    if (gross < 0) {
      result.anomalies.push('CHECKOUT_BEFORE_CHECKIN');
    } else {
      result.workedMinutes = policy.countBreakAsWorked
        ? gross
        : Math.max(0, gross - (shift?.breakMinutes ?? 0));
    }
  }

  /* --- non-working days ------------------------------------------------- */
  // Evaluated before absence: someone who worked a holiday must not be judged
  // against a shift that did not apply to them.
  const workedEnough = result.workedMinutes >= policy.compOffMinMinutes;

  if (holiday || isWeeklyOff) {
    result.status = holiday ? ATTENDANCE_STATUS.HOLIDAY : ATTENDANCE_STATUS.WEEKLY_OFF;

    if (result.workedMinutes > 0) {
      result.status = ATTENDANCE_STATUS.PRESENT;
      result.overtimeMinutes = policy.overtimeEnabled
        ? Math.min(result.workedMinutes, policy.maxOvertimeMinutes)
        : 0;

      if (policy.compOffEnabled && workedEnough) {
        // Half a day's work on a day off earns half a comp off, not a whole
        // one -- measured against the same roster-aware bar as a normal day.
        result.compOffEarnedDays = result.workedMinutes >= fullDayBar ? 1 : 0.5;
      }
    }

    return result;
  }

  if (onLeave) {
    result.status = ATTENDANCE_STATUS.ON_LEAVE;
    return result;
  }

  if (overrideStatus) {
    result.status = overrideStatus;
    // On-duty and work-from-home are credited as a full day even without
    // punches -- there is no device to punch on at a client site.
    if (!result.workedMinutes) result.workedMinutes = result.expectedMinutes;
  }

  /* --- no punches at all ------------------------------------------------- */
  if (!punchCount) {
    if (!overrideStatus) {
      result.status = policy.autoAbsentOnNoPunch
        ? ATTENDANCE_STATUS.ABSENT
        : ATTENDANCE_STATUS.MISSING_PUNCH;
    }
    return result;
  }

  /* --- incomplete pair ---------------------------------------------------- */
  if (!checkOut?.time) {
    result.status = ATTENDANCE_STATUS.MISSING_PUNCH;
    result.anomalies.push('NO_CHECKOUT');
    // Lateness is still computed: the entry punch is real evidence, and losing
    // it because the exit is missing would reward forgetting to punch out.
    if (window && result.checkInAt) {
      result.lateMinutes = Math.max(
        0,
        minutesBetween(window.start, result.checkInAt) - policy.lateGraceMinutes,
      );
    }
    return result;
  }

  /* --- late / early ------------------------------------------------------- */
  if (window) {
    result.lateMinutes = Math.max(
      0,
      minutesBetween(window.start, result.checkInAt) - policy.lateGraceMinutes,
    );
    result.earlyGoingMinutes = Math.max(
      0,
      minutesBetween(result.checkOutAt, window.end) - policy.earlyGoingGraceMinutes,
    );
  }

  /* --- day classification ------------------------------------------------- */
  if (!overrideStatus) {
    if (result.workedMinutes >= fullDayBar) result.status = ATTENDANCE_STATUS.PRESENT;
    else if (result.workedMinutes >= halfDayBar) result.status = ATTENDANCE_STATUS.HALF_DAY;
    else result.status = ATTENDANCE_STATUS.ABSENT;
  }

  /* --- overtime ----------------------------------------------------------- */
  /**
   * Overtime is what the employee worked beyond the LENGTH of their shift.
   *
   *   overtime = max(0, workedMinutes - shiftDurationMinutes)
   *
   * Never measured against the clock. The previous rule counted everything
   * after the rostered end time, which charged a late start as overtime: an
   * employee rostered 09:30-18:00 who worked 13:00-22:30 did the same 9h30 as
   * anyone else and is owed 1h00, but the clock rule paid 4h30. It also paid
   * nothing to someone who started early and left before the shift ended
   * having already done their hours.
   *
   * `minOvertimeMinutes` still applies as a configured floor, and
   * `maxOvertimeMinutes` as a ceiling; both are policy settings the customer
   * owns, not part of the formula.
   */
  if (policy.overtimeEnabled) {
    /**
     * An employee with no roster is still owed overtime.
     *
     * Without a shift there is no window, and the whole block used to be
     * skipped -- so an eligible employee who worked thirteen hours was shown
     * 00:00 and nobody could tell whether that meant "no overtime" or "no
     * shift". The policy's standard day stands in, and the day is flagged so
     * the gap is visible rather than silently absorbed.
     *
     * Assigning the employee's real shift is still the fix; this stops the
     * absence of one from quietly costing somebody their overtime.
     */
    const shiftMinutes = dayMinutes;

    if (!window) result.anomalies.push('NO_SHIFT_ASSIGNED');

    const raw = Math.max(0, result.workedMinutes - shiftMinutes);

    if (raw >= policy.minOvertimeMinutes) {
      result.overtimeMinutes = Math.min(raw, policy.maxOvertimeMinutes);
    }
  }

  return result;
};

/**
 * Aggregates evaluated days into a monthly summary -- the shape payroll
 * consumes and the monthly report renders.
 */
export const summarizeMonth = (days = []) => {
  const summary = {
    totalDays: days.length,
    present: 0,
    halfDay: 0,
    absent: 0,
    onLeave: 0,
    holiday: 0,
    weeklyOff: 0,
    missingPunch: 0,
    onDuty: 0,
    workFromHome: 0,
    lateCount: 0,
    earlyGoingCount: 0,
    totalLateMinutes: 0,
    totalEarlyGoingMinutes: 0,
    totalWorkedMinutes: 0,
    totalOvertimeMinutes: 0,
    compOffEarnedDays: 0,
    payableDays: 0,
  };

  const bucket = {
    [ATTENDANCE_STATUS.PRESENT]: 'present',
    [ATTENDANCE_STATUS.HALF_DAY]: 'halfDay',
    [ATTENDANCE_STATUS.ABSENT]: 'absent',
    [ATTENDANCE_STATUS.ON_LEAVE]: 'onLeave',
    [ATTENDANCE_STATUS.HOLIDAY]: 'holiday',
    [ATTENDANCE_STATUS.WEEKLY_OFF]: 'weeklyOff',
    [ATTENDANCE_STATUS.MISSING_PUNCH]: 'missingPunch',
    [ATTENDANCE_STATUS.ON_DUTY]: 'onDuty',
    [ATTENDANCE_STATUS.WORK_FROM_HOME]: 'workFromHome',
  };

  days.forEach((day) => {
    const key = bucket[day.status];
    if (key) summary[key] += 1;

    if (day.lateMinutes > 0) {
      summary.lateCount += 1;
      summary.totalLateMinutes += day.lateMinutes;
    }
    if (day.earlyGoingMinutes > 0) {
      summary.earlyGoingCount += 1;
      summary.totalEarlyGoingMinutes += day.earlyGoingMinutes;
    }

    summary.totalWorkedMinutes += day.workedMinutes ?? 0;
    summary.totalOvertimeMinutes += day.overtimeMinutes ?? 0;
    summary.compOffEarnedDays += day.compOffEarnedDays ?? 0;
  });

  // Half days count as half. This number is what payroll multiplies by, so it
  // is stated in days rather than left for the consumer to derive.
  summary.payableDays =
    summary.present +
    summary.onDuty +
    summary.workFromHome +
    summary.holiday +
    summary.weeklyOff +
    summary.onLeave +
    summary.halfDay * 0.5;

  return summary;
};

export default {
  evaluateDay,
  summarizeMonth,
  resolveShiftWindow,
  reducePunches,
  startOfDay,
  attributeShiftDay,
  DEFAULT_POLICY,
};
