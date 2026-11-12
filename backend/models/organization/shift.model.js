import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

const minutesOfDay = (hhmm) => {
  const [hours, minutes] = String(hhmm).split(':').map(Number);
  return hours * 60 + minutes;
};

/**
 * One day of a day-wise schedule. A working day carries its own times and
 * break; a weekly off carries none that matter. An end at or before the start
 * runs into the next morning, as it does for the shift itself.
 */
const scheduleDaySchema = new Schema(
  {
    // 0 = Sunday ... 6 = Saturday, as everywhere else in attendance.
    day: { type: Number, required: true, min: 0, max: 6 },
    isWorking: { type: Boolean, default: true },
    startTime: { type: String, default: null, match: [HH_MM, 'Use HH:mm'] },
    endTime: { type: String, default: null, match: [HH_MM, 'Use HH:mm'] },
    breakMinutes: { type: Number, default: 0, min: 0, max: 480 },
  },
  { _id: false },
);

/**
 * Minimal shift master, referenced by Employee. Times are stored as `HH:mm`
 * strings rather than Dates: a shift is a wall-clock pattern, not an instant,
 * and storing it as a Date would drag a meaningless date and timezone along
 * with it.
 */
const shiftSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null, index: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    code: { type: String, required: true, trim: true, uppercase: true, maxlength: 20 },
    startTime: { type: String, required: true, match: [HH_MM, 'Use HH:mm'] },
    endTime: { type: String, required: true, match: [HH_MM, 'Use HH:mm'] },
    breakMinutes: { type: Number, default: 60, min: 0, max: 480 },
    // True when the shift ends on the following day (e.g. 22:00 -> 06:00).
    isNightShift: { type: Boolean, default: false },
    weeklyOffs: { type: [Number], default: [0], validate: (v) => v.every((d) => d >= 0 && d <= 6) },
    /**
     * Saturday's working time, when it is shorter (or longer) than a weekday's
     * -- 330 for 5 h 30 m. Saturday then starts at `startTime` and lasts this
     * long, and is graded against it. Null or 0 means the company's Saturday
     * from the attendance policy applies; Monday to Friday never read it.
     * Superseded by `schedule` when one is set, and kept for shifts without one.
     */
    saturdayWorkMinutes: { type: Number, default: null, min: 0, max: 1440 },
    /**
     * Times for each day of the week, all seven or none.
     *
     * Empty -- every shift until an administrator sets one -- means the shift
     * works exactly as it always has: the times above, `weeklyOffs`, and the
     * Saturday rule. Set, it decides each day on its own: that day's times and
     * break, and whether it is worked at all.
     */
    schedule: { type: [scheduleDaySchema], default: [] },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

shiftSchema.index({ tenantId: 1, code: 1 }, { unique: true });

/**
 * Keeps a day-wise schedule whole and in step with `weeklyOffs`.
 *
 * Weekly offs are read in many places -- the monthly register, the leave
 * calculator, overtime on a rest day -- so they are derived from the schedule
 * here rather than each of those learning to read it. The shift's own times
 * follow Monday (or the first working day), so lists and older readers show a
 * real day of this shift.
 */
shiftSchema.pre('validate', function syncSchedule(next) {
  const schedule = this.schedule ?? [];
  if (!schedule.length) return next();

  const days = schedule.map((entry) => entry.day);
  if (schedule.length !== 7 || new Set(days).size !== 7) {
    return next(new Error('A day-wise schedule must list each day of the week exactly once'));
  }

  for (const entry of schedule) {
    if (!entry.isWorking) continue;

    if (!entry.startTime || !entry.endTime) return next(new Error('Each working day needs a start and an end time'));
    if (entry.startTime === entry.endTime) return next(new Error('A working day cannot start and end at the same time'));

    const span = (minutesOfDay(entry.endTime) - minutesOfDay(entry.startTime) + 1440) % 1440;
    if ((entry.breakMinutes ?? 0) >= span) return next(new Error('A break cannot be as long as the working day'));
  }

  this.weeklyOffs = schedule.filter((entry) => !entry.isWorking).map((entry) => entry.day).sort();

  const reference = [1, 2, 3, 4, 5, 6, 0]
    .map((day) => schedule.find((entry) => entry.day === day))
    .find((entry) => entry?.isWorking);

  if (reference) {
    this.startTime = reference.startTime;
    this.endTime = reference.endTime;
    this.breakMinutes = reference.breakMinutes ?? 0;
  }

  return next();
});

export default model('Shift', shiftSchema);
