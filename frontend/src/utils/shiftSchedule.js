/**
 * Day-wise shift schedules: the arithmetic and checks the Shifts form shows.
 *
 * Mirrors `scheduledNetMinutes` and the Shift model's own checks on the server,
 * which remain the authority -- this is so the screen can say what the server
 * will say before anyone presses Save.
 */

/** Monday first, the way people read a week. 0 = Sunday, as on the server. */
export const SCHEDULE_DAYS = [
  { day: 1, label: 'Monday' },
  { day: 2, label: 'Tuesday' },
  { day: 3, label: 'Wednesday' },
  { day: 4, label: 'Thursday' },
  { day: 5, label: 'Friday' },
  { day: 6, label: 'Saturday' },
  { day: 0, label: 'Sunday' },
];

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const minutesOfDay = (hhmm) => {
  const [hours, minutes] = String(hhmm).split(':').map(Number);
  return hours * 60 + minutes;
};

/** The span from start to end, running on past midnight when the end comes first. */
export const spanMinutes = (startTime, endTime) => {
  if (!TIME.test(startTime ?? '') || !TIME.test(endTime ?? '')) return 0;
  const span = minutesOfDay(endTime) - minutesOfDay(startTime);
  return span <= 0 ? span + 24 * 60 : span;
};

/** End less start less break, for a working day. */
export const netMinutes = (entry) =>
  entry?.isWorking ? Math.max(0, spanMinutes(entry.startTime, entry.endTime) - (Number(entry.breakMinutes) || 0)) : 0;

/** 450 -> "7h 30m". */
export const formatDuration = (minutes) => {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
};

/**
 * A full week built from the shift's single timing, so switching to day-wise
 * starts from what the shift already does and changes nothing until edited.
 */
export const scheduleFromShift = ({ startTime, endTime, breakMinutes, weeklyOffs = [] } = {}) =>
  SCHEDULE_DAYS.map(({ day }) => {
    const isWorking = !(weeklyOffs ?? []).includes(day);
    return {
      day,
      isWorking,
      startTime: isWorking ? startTime || '' : '',
      endTime: isWorking ? endTime || '' : '',
      breakMinutes: isWorking ? Number(breakMinutes) || 0 : 0,
    };
  });

/** Monday's times and break onto Tuesday to Friday. Weekend days are left alone. */
export const copyMondayToWeekdays = (schedule) => {
  const monday = schedule.find((entry) => entry.day === 1);
  if (!monday) return schedule;

  return schedule.map((entry) =>
    [2, 3, 4, 5].includes(entry.day)
      ? { ...entry, isWorking: monday.isWorking, startTime: monday.startTime, endTime: monday.endTime, breakMinutes: monday.breakMinutes }
      : entry,
  );
};

/**
 * What is wrong with each day, keyed by weekday number. Empty when the schedule
 * can be saved. Overnight days are valid: an end before the start runs on.
 */
export const scheduleErrors = (schedule) => {
  const errors = {};

  (schedule ?? []).forEach((entry) => {
    if (!entry.isWorking) return;

    if (!TIME.test(entry.startTime ?? '') || !TIME.test(entry.endTime ?? '')) {
      errors[entry.day] = 'Enter a start and an end time';
    } else if (entry.startTime === entry.endTime) {
      errors[entry.day] = 'Start and end cannot be the same';
    } else if (!Number.isFinite(Number(entry.breakMinutes)) || Number(entry.breakMinutes) < 0 || Number(entry.breakMinutes) > 480) {
      errors[entry.day] = 'Break must be 0 to 480 minutes';
    } else if (Number(entry.breakMinutes) >= spanMinutes(entry.startTime, entry.endTime)) {
      errors[entry.day] = 'The break is as long as the day';
    }
  });

  return errors;
};

/** Whether a day ends on the next calendar day. */
export const isOvernight = (entry) =>
  Boolean(entry?.isWorking && TIME.test(entry.startTime ?? '') && TIME.test(entry.endTime ?? '') && entry.endTime < entry.startTime);

export default {
  SCHEDULE_DAYS,
  spanMinutes,
  netMinutes,
  formatDuration,
  scheduleFromShift,
  copyMondayToWeekdays,
  scheduleErrors,
  isOvernight,
};
