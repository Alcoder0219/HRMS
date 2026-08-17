import mongoose from 'mongoose';
import { ATTENDANCE_STATUS, ATTENDANCE_SOURCE } from '../../utils/constants.js';

const { Schema, model } = mongoose;

const locationSchema = new Schema(
  {
    latitude: { type: Number, min: -90, max: 90 },
    longitude: { type: Number, min: -180, max: 180 },
    accuracy: { type: Number, default: null },
    address: { type: String, trim: true, maxlength: 250, default: null },
    // Retained even when the punch was allowed, so a later dispute can be
    // reconstructed rather than re-litigated.
    withinGeofence: { type: Boolean, default: null },
    distanceMetres: { type: Number, default: null },
    siteName: { type: String, default: null },
  },
  { _id: false },
);

/**
 * A single device or app event. Kept as an append-only log rather than being
 * collapsed into check-in/check-out on write: biometric doors emit one per
 * swipe, and discarding the intermediate ones destroys the only evidence that
 * would settle a "the machine didn't read my finger" dispute.
 */
const punchSchema = new Schema(
  {
    time: { type: Date, required: true },
    source: { type: String, enum: Object.values(ATTENDANCE_SOURCE), required: true },
    direction: { type: String, enum: ['IN', 'OUT', 'UNKNOWN'], default: 'UNKNOWN' },
    deviceId: { type: String, trim: true, default: null },
    location: { type: locationSchema, default: null },
    ip: { type: String, default: null },
    recordedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    note: { type: String, trim: true, maxlength: 250, default: null },
  },
  { _id: true },
);

const attendanceSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null, index: true },
    employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },

    /**
     * Normalised to local midnight. Every query, uniqueness rule and monthly
     * roll-up keys off this, so a punch at 23:59 and one at 00:01 must not land
     * on different days by accident.
     */
    date: { type: Date, required: true, index: true },

    /**
     * The shift as it applied on this date, denormalised. Rosters change; a
     * record that resolved its shift live would silently re-grade last
     * quarter's lateness the day someone edits the shift master.
     */
    shiftId: { type: Schema.Types.ObjectId, ref: 'Shift', default: null },
    shiftSnapshot: {
      type: new Schema(
        {
          code: String,
          name: String,
          startTime: String,
          endTime: String,
          breakMinutes: Number,
          isNightShift: Boolean,
        },
        { _id: false },
      ),
      default: null,
    },

    punches: { type: [punchSchema], default: [] },

    checkInAt: { type: Date, default: null },
    checkOutAt: { type: Date, default: null },

    /* ----------------------------------------------------- computed ----- */
    status: {
      type: String,
      enum: Object.values(ATTENDANCE_STATUS),
      default: ATTENDANCE_STATUS.ABSENT,
      index: true,
    },
    workedMinutes: { type: Number, default: 0, min: 0 },
    expectedMinutes: { type: Number, default: 0, min: 0 },
    breakMinutes: { type: Number, default: 0, min: 0 },
    lateMinutes: { type: Number, default: 0, min: 0 },
    earlyGoingMinutes: { type: Number, default: 0, min: 0 },
    overtimeMinutes: { type: Number, default: 0, min: 0 },

    isHoliday: { type: Boolean, default: false },
    isWeeklyOff: { type: Boolean, default: false },
    isNightShift: { type: Boolean, default: false },
    compOffEarnedDays: { type: Number, default: 0, min: 0, max: 2 },

    // Machine-readable flags from the rules engine (CHECKOUT_BEFORE_CHECKIN,
    // NO_CHECKOUT). Drives the exceptions view without re-deriving them.
    anomalies: { type: [String], default: [] },

    /* ------------------------------------------------------ overrides ---- */
    // Set by an approved regularization or a manual mark; the recompute path
    // honours it instead of concluding ABSENT from missing punches.
    overrideStatus: {
      type: String,
      enum: [...Object.values(ATTENDANCE_STATUS), null],
      default: null,
    },
    isRegularized: { type: Boolean, default: false, index: true },
    regularizationId: { type: Schema.Types.ObjectId, ref: 'Regularization', default: null },

    source: {
      type: String,
      enum: Object.values(ATTENDANCE_SOURCE),
      default: ATTENDANCE_SOURCE.SYSTEM,
    },
    remarks: { type: String, trim: true, maxlength: 500, default: null },

    // Locked once payroll has consumed the month; edits then require an
    // explicit unlock rather than silently changing a paid figure.
    isLocked: { type: Boolean, default: false },
    lockedAt: { type: Date, default: null },

    markedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

/* --------------------------------------------------------------- indexes */

// One record per employee per day. This is the invariant the whole module
// rests on -- every ingest path upserts against it.
attendanceSchema.index({ employeeId: 1, date: 1 }, { unique: true });

// The daily register: one tenant, one date, ordered by status.
attendanceSchema.index({ tenantId: 1, date: -1, status: 1 });
// Monthly reports and payroll extraction for one person.
attendanceSchema.index({ tenantId: 1, employeeId: 1, date: -1 });
// The exceptions queue.
attendanceSchema.index({ tenantId: 1, date: -1, isRegularized: 1 });

attendanceSchema.virtual('workedHours').get(function workedHours() {
  return Number((this.workedMinutes / 60).toFixed(2));
});

attendanceSchema.virtual('overtimeHours').get(function overtimeHours() {
  return Number((this.overtimeMinutes / 60).toFixed(2));
});

export default model('Attendance', attendanceSchema);
