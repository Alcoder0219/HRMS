import mongoose from 'mongoose';
import { DEFAULT_POLICY } from '../../helpers/attendanceRules.helper.js';

const { Schema, model } = mongoose;

const geofenceSiteSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    latitude: { type: Number, required: true, min: -90, max: 90 },
    longitude: { type: Number, required: true, min: -180, max: 180 },
    radiusMetres: { type: Number, default: 200, min: 20, max: 5000 },
    isActive: { type: Boolean, default: true },
  },
  { _id: true },
);

/**
 * The tunable half of the rules engine.
 *
 * Thresholds live in the database rather than in code because they are a
 * customer policy decision, not a product one -- grace periods and half-day
 * cut-offs differ per organisation and change without a release.
 *
 * A policy may be scoped to a department; the tenant-wide record (no
 * department) is the fallback.
 */
const attendancePolicySchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null, index: true },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', default: null, index: true },

    name: { type: String, required: true, trim: true, maxlength: 100 },
    isDefault: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },

    /* -------------------------------------------------- day thresholds -- */
    fullDayMinutes: { type: Number, default: DEFAULT_POLICY.fullDayMinutes, min: 60, max: 900 },
    halfDayMinutes: { type: Number, default: DEFAULT_POLICY.halfDayMinutes, min: 30, max: 600 },

    /* ------------------------------------------------------- tolerance -- */
    lateGraceMinutes: { type: Number, default: DEFAULT_POLICY.lateGraceMinutes, min: 0, max: 120 },
    earlyGoingGraceMinutes: {
      type: Number,
      default: DEFAULT_POLICY.earlyGoingGraceMinutes,
      min: 0,
      max: 120,
    },
    // Three lates make a half-day deduction, for example. Applied monthly in
    // the report, not per day -- it is a pattern, not a single event.
    latesPerHalfDayDeduction: { type: Number, default: 0, min: 0, max: 10 },

    /* -------------------------------------------------------- overtime -- */
    overtimeEnabled: { type: Boolean, default: DEFAULT_POLICY.overtimeEnabled },
    minOvertimeMinutes: { type: Number, default: DEFAULT_POLICY.minOvertimeMinutes, min: 0, max: 240 },
    maxOvertimeMinutes: { type: Number, default: DEFAULT_POLICY.maxOvertimeMinutes, min: 0, max: 720 },
    overtimeAfterShiftEnd: { type: Boolean, default: DEFAULT_POLICY.overtimeAfterShiftEnd },

    /* -------------------------------------------------------- comp off -- */
    compOffEnabled: { type: Boolean, default: DEFAULT_POLICY.compOffEnabled },
    compOffMinMinutes: { type: Number, default: DEFAULT_POLICY.compOffMinMinutes, min: 60, max: 720 },
    compOffExpiryDays: { type: Number, default: 90, min: 7, max: 365 },

    /* ---------------------------------------------------------- misc ---- */
    autoAbsentOnNoPunch: { type: Boolean, default: DEFAULT_POLICY.autoAbsentOnNoPunch },
    countBreakAsWorked: { type: Boolean, default: DEFAULT_POLICY.countBreakAsWorked },
    // 0 = Sunday. Overridden per shift when a shift defines its own.
    weeklyOffs: { type: [Number], default: [0] },

    /* ----------------------------------------------------- geofencing --- */
    geofenceEnabled: { type: Boolean, default: false },
    geofenceSites: { type: [geofenceSiteSchema], default: [] },
    // When off, an out-of-fence punch is recorded and flagged instead of
    // refused -- useful while rolling geofencing out.
    rejectOutsideGeofence: { type: Boolean, default: true },

    /* ------------------------------------------------ regularization ---- */
    regularizationEnabled: { type: Boolean, default: true },
    // Beyond this, the month is closed and a correction is an HR matter.
    regularizationWindowDays: { type: Number, default: 7, min: 1, max: 90 },
    maxRegularizationsPerMonth: { type: Number, default: 3, min: 0, max: 31 },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

// One default per tenant; department policies are unique per department.
attendancePolicySchema.index(
  { tenantId: 1, departmentId: 1 },
  { unique: true, partialFilterExpression: { isActive: true } },
);

/**
 * Guards the one combination the rules engine cannot make sense of: a half-day
 * threshold at or above the full-day threshold would classify every full day as
 * half.
 */
attendancePolicySchema.pre('validate', function validateThresholds(next) {
  if (this.halfDayMinutes >= this.fullDayMinutes) {
    return next(new Error('halfDayMinutes must be less than fullDayMinutes'));
  }
  return next();
});

export default model('AttendancePolicy', attendancePolicySchema);
