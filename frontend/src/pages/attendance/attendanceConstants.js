/**
 * Shared attendance vocabulary and formatting for the attendance screens.
 *
 * Collected here so the monthly register, the edit dialog and the filters all
 * spell a status the same way and render a duration the same way -- these were
 * about to be written three times.
 */

/**
 * The statuses an administrator may set by hand.
 *
 * The values mirror `ATTENDANCE_STATUS` on the server; the server validates
 * against its own enum, so a value the API does not know is refused there
 * rather than stored.
 */
export const ATTENDANCE_STATUSES = [
  { value: 'PRESENT', label: 'Present' },
  { value: 'ABSENT', label: 'Absent' },
  { value: 'HALF_DAY', label: 'Half Day' },
  { value: 'ON_LEAVE', label: 'Leave' },
  { value: 'WEEKLY_OFF', label: 'Weekly Off' },
  { value: 'HOLIDAY', label: 'Holiday' },
  { value: 'ON_DUTY', label: 'On Duty' },
  { value: 'WORK_FROM_HOME', label: 'WFH' },
  { value: 'MISSING_PUNCH', label: 'Missing Punch' },
];

/**
 * Minutes as hours:minutes, zero-padded.
 *
 * Mirrors `toHoursMinutes` in `attendanceReport.service.js` so the figure on
 * screen matches the one in the Excel and PDF exports exactly. A duration is
 * read as 01:15, never as 1.3 hours.
 */
export const toHoursMinutes = (minutes) => {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(total / 60);
  return `${String(hours).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

/** Overtime filter options for the monthly register. */
export const OVERTIME_FILTERS = [
  { value: '', label: 'All employees' },
  { value: 'with', label: 'With overtime' },
  { value: 'without', label: 'Without overtime' },
];

export default { ATTENDANCE_STATUSES, toHoursMinutes, OVERTIME_FILTERS };
