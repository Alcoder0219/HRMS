import mongoose from 'mongoose';
import { COMP_OFF_STATUS } from '../../utils/constants.js';

const { Schema, model } = mongoose;

/**
 * Compensatory off earned by working a holiday or weekly off.
 *
 * A ledger of individual credits rather than a single balance counter. Each
 * credit expires on its own schedule, so a running total could not answer
 * "how much do I have that is still usable" -- and an expiring-credits warning
 * would be impossible.
 */
const compOffSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null, index: true },
    employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },

    // The day that was worked, and the attendance record proving it.
    earnedOn: { type: Date, required: true },
    attendanceId: { type: Schema.Types.ObjectId, ref: 'Attendance', default: null },

    // Half a day's work earns 0.5; the ledger deals in days, not minutes.
    days: { type: Number, required: true, min: 0.5, max: 2 },
    workedMinutes: { type: Number, default: 0 },

    expiresAt: { type: Date, required: true, index: true },

    status: {
      type: String,
      enum: Object.values(COMP_OFF_STATUS),
      default: COMP_OFF_STATUS.EARNED,
      index: true,
    },

    consumedOn: { type: Date, default: null },
    // Populated once the Leave module redeems the credit against a request.
    leaveRequestId: { type: Schema.Types.ObjectId, ref: 'LeaveRequest', default: null },

    reason: { type: String, trim: true, maxlength: 300, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

// One credit per employee per worked day -- a recompute must not mint a second.
compOffSchema.index({ employeeId: 1, earnedOn: 1 }, { unique: true });
compOffSchema.index({ tenantId: 1, employeeId: 1, status: 1 });

compOffSchema.virtual('isUsable').get(function isUsable() {
  return this.status === COMP_OFF_STATUS.EARNED && this.expiresAt > new Date();
});

export default model('CompOff', compOffSchema);
