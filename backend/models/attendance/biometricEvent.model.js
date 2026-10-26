import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * What became of one device punch.
 *
 *   IMPORTED  written to the employee's attendance day and recomputed.
 *   UNMAPPED  the device user ID has no employee mapping yet. Kept, and
 *             imported by "Reprocess" once the mapping exists.
 *   HELD      deliberately not applied: the day is locked for payroll, or it
 *             was corrected by hand or by an approved regularization, and a
 *             late-arriving punch must not silently re-derive it.
 *   IGNORED   older than the device's accept-from date -- typically the
 *             backlog a terminal uploads on its first connection.
 *   FAILED    applying it threw. Retried by Reprocess.
 *   PENDING   stored and about to be applied. Only seen if the process died
 *             between the two steps; Reprocess picks it up.
 *
 * DUPLICATE is not a status: a duplicate never becomes a row. It is counted on
 * the sync log of the request that carried it, which is where the question
 * "why did this upload import nothing?" gets answered.
 */
export const BIOMETRIC_EVENT_STATUS = {
  IMPORTED: 'IMPORTED',
  UNMAPPED: 'UNMAPPED',
  HELD: 'HELD',
  IGNORED: 'IGNORED',
  FAILED: 'FAILED',
  PENDING: 'PENDING',
};

/**
 * One punch exactly as a terminal reported it, before any interpretation.
 *
 * Kept apart from the Attendance day for the reason the day keeps its own punch
 * array: the day is a COMPUTED summary, and the moment a punch is folded into it
 * the question "what did the device actually send?" can no longer be answered.
 * This collection answers it -- for a dispute, for a punch that arrived before
 * its employee was mapped, and for a re-import after a correction.
 *
 * Deliberately holds no biometric data. A terminal can upload fingerprint and
 * face templates and photos; none of them are requested, and none would be
 * stored here if they arrived.
 */
const biometricEventSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null, index: true },

    // The device row in AppSettings, and the identity the terminal itself
    // reports. Both, because a device row can be deleted and re-added while
    // the terminal on the wall stays the same.
    deviceId: { type: Schema.Types.ObjectId, required: true, index: true },
    deviceSerial: { type: String, trim: true, maxlength: 60, default: null },
    transport: { type: String, trim: true, maxlength: 20, required: true },

    deviceUserId: { type: String, required: true, trim: true, maxlength: 30 },
    employeeCode: { type: String, trim: true, uppercase: true, maxlength: 20, default: null },
    employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', default: null },

    /** The instant of the punch, after the device's wall clock was interpreted. */
    punchTime: { type: Date, required: true },
    /** The wall-clock text exactly as received, so the interpretation can be audited. */
    deviceLocalTime: { type: String, trim: true, maxlength: 25, default: null },

    /** The device's own state code (0 check-in, 1 check-out, ...), unmapped. */
    punchType: { type: Number, default: null },
    direction: { type: String, enum: ['IN', 'OUT', 'UNKNOWN'], default: 'UNKNOWN' },
    verifyMode: { type: Number, default: null },
    workCode: { type: String, trim: true, maxlength: 20, default: null },

    /** Who, where, when -- see `buildDedupKey`. The guard against every retry. */
    dedupKey: { type: String, required: true },

    status: {
      type: String,
      enum: Object.values(BIOMETRIC_EVENT_STATUS),
      required: true,
      index: true,
    },
    statusReason: { type: String, trim: true, maxlength: 300, default: null },

    /** The attendance day it was applied to -- the shift day, not always the calendar day. */
    attendanceDate: { type: Date, default: null },

    receivedAt: { type: Date, default: Date.now },
    processedAt: { type: Date, default: null },
    attempts: { type: Number, default: 0 },
  },
  { timestamps: true },
);

/* --------------------------------------------------------------- indexes */

// The deduplication guarantee. Every write is an upsert against this, so two
// instances receiving the same retry at the same moment still store one row.
biometricEventSchema.index({ dedupKey: 1 }, { unique: true });

// The device activity view, newest first, optionally narrowed by status.
biometricEventSchema.index({ tenantId: 1, deviceId: 1, punchTime: -1 });
biometricEventSchema.index({ tenantId: 1, deviceId: 1, status: 1, punchTime: -1 });

// The unmapped review queue across every device.
biometricEventSchema.index({ tenantId: 1, status: 1, deviceUserId: 1 });

export default model('BiometricEvent', biometricEventSchema);
