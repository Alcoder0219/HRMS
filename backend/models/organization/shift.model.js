import mongoose from 'mongoose';

const { Schema, model } = mongoose;

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
    startTime: { type: String, required: true, match: [/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm'] },
    endTime: { type: String, required: true, match: [/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm'] },
    breakMinutes: { type: Number, default: 60, min: 0, max: 480 },
    // True when the shift ends on the following day (e.g. 22:00 -> 06:00).
    isNightShift: { type: Boolean, default: false },
    weeklyOffs: { type: [Number], default: [0], validate: (v) => v.every((d) => d >= 0 && d <= 6) },
    /**
     * Saturday's working time, when it is shorter (or longer) than a weekday's
     * -- 330 for 5 h 30 m. Saturday then starts at `startTime` and lasts this
     * long, and is graded against it. Null or 0 means the company's Saturday
     * from the attendance policy applies; Monday to Friday never read it.
     */
    saturdayWorkMinutes: { type: Number, default: null, min: 0, max: 1440 },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

shiftSchema.index({ tenantId: 1, code: 1 }, { unique: true });

export default model('Shift', shiftSchema);
