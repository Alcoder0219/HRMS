/**
 * Attendance times on the business's clock, not the viewer's.
 *
 * The server stores every punch as an instant and keys every attendance day at
 * midnight in ITS zone; shift times, lateness and the Excel import/export all
 * read `HH:mm` in that same zone. A browser that formats those instants in its
 * own zone shows a different clock in every country -- the same 08:30 punch
 * read 08:30 in India and 06:00 in Tanzania.
 *
 * Every attendance screen therefore reads and writes times through this one
 * zone, so a record shows the same clock time wherever it is opened.
 *
 * It MUST equal the zone the backend evaluates attendance in (Cloud Run `TZ`,
 * and `BIOMETRIC_DEVICE_TIMEZONE` for the terminal). Today that is
 * Asia/Kolkata: the stored records were written in it, so reading them in it
 * gives back exactly the clock time the MB360 recorded in Tanzania. It becomes
 * Africa/Dar_es_Salaam only together with the backend settings and a one-time
 * correction of the stored records -- changing it alone would move every
 * displayed time by 2h30.
 */
export const ATTENDANCE_TIME_ZONE = 'Asia/Kolkata';

const formats = new Map();

const clockFormat = (timeZone) => {
  if (!formats.has(timeZone)) {
    formats.set(
      timeZone,
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
    );
  }
  return formats.get(timeZone);
};

/**
 * A browser-local `Date` whose fields (`getDate()`, `getHours()`, date-fns
 * `format`, `toLocaleTimeString`) read the attendance clock's wall time.
 *
 * For reading and formatting only: it is not the same instant, so it is never
 * sent back to the server. Use `fromAttendanceClock` for that.
 */
export const toAttendanceClock = (value, timeZone = ATTENDANCE_TIME_ZONE) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const parts = Object.fromEntries(
    clockFormat(timeZone).formatToParts(date).map(({ type, value: part }) => [type, Number(part)]),
  );
  return new Date(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
};

/** The instant at a wall time on the attendance clock (`month` is 1-12). */
export const fromAttendanceClock = (year, month, day, hours = 0, minutes = 0, seconds = 0, timeZone = ATTENDANCE_TIME_ZONE) => {
  const wall = Date.UTC(year, month - 1, day, hours, minutes, seconds);

  const offsetAt = (instant) => {
    const clock = toAttendanceClock(new Date(instant), timeZone);
    const asUtc = Date.UTC(clock.getFullYear(), clock.getMonth(), clock.getDate(), clock.getHours(), clock.getMinutes(), clock.getSeconds());
    return Math.round((asUtc - instant) / 60_000) * 60_000;
  };

  // Two passes: the first offset is taken at the wrong instant, which only
  // matters within an hour of a daylight-saving change.
  let instant = wall - offsetAt(wall);
  instant = wall - offsetAt(instant);
  return new Date(instant);
};

/** `HH:mm` as the attendance screens have always shown it, on the attendance clock. */
export const formatAttendanceTime = (value) => {
  const clock = toAttendanceClock(value);
  return clock ? clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
};

export default { ATTENDANCE_TIME_ZONE, toAttendanceClock, fromAttendanceClock, formatAttendanceTime };
