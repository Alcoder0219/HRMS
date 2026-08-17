import mongoose from 'mongoose';
import {
  REGULARIZATION_TYPES,
  REGULARIZATION_STATUS,
  ATTENDANCE_STATUS,
} from '../../utils/constants.js';

const { Schema, model } = mongoose;

/**
 * A request to correct one attendance day.
 *
 * Separate from the attendance record on purpose: the request and its outcome
 * are the audit trail. Editing the attendance row directly would leave no
 * evidence of who asked for what, who approved it, or what the original
 * machine reading was -- which is the whole point of regularization.
 */
const regularizationSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null, index: true },
    employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    attendanceId: { type: Schema.Types.ObjectId, ref: 'Attendance', default: null },

    date: { type: Date, required: true, index: true },
    type: { type: String, enum: Object.values(REGULARIZATION_TYPES), required: true },

    /* ------------------------------------------------------- requested -- */
    requestedCheckIn: { type: Date, default: null },
    requestedCheckOut: { type: Date, default: null },
    requestedStatus: {
      type: String,
      enum: [...Object.values(ATTENDANCE_STATUS), null],
      default: null,
    },
    reason: { type: String, required: true, trim: true, minlength: 5, maxlength: 500 },

    /**
     * What the record said before approval. Captured at request time, not at
     * approval time -- by then it may already have been recomputed, and the
     * original reading would be unrecoverable.
     */
    originalSnapshot: {
      type: new Schema(
        {
          checkInAt: Date,
          checkOutAt: Date,
          status: String,
          workedMinutes: Number,
          lateMinutes: Number,
        },
        { _id: false },
      ),
      default: null,
    },

    /* -------------------------------------------------------- workflow -- */
    status: {
      type: String,
      enum: Object.values(REGULARIZATION_STATUS),
      default: REGULARIZATION_STATUS.PENDING,
      index: true,
    },

    // Snapshotted from the employee's reporting line at request time, so a
    // pending request does not silently change hands when someone transfers.
    approverId: { type: Schema.Types.ObjectId, ref: 'Employee', default: null, index: true },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    decidedAt: { type: Date, default: null },
    decisionComment: { type: String, trim: true, maxlength: 500, default: null },

    appliedAt: { type: Date, default: null },

    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

// One live request per employee-day: two competing corrections for the same
// date cannot both be applied, and racing them would corrupt the record.
regularizationSchema.index(
  { employeeId: 1, date: 1 },
  { unique: true, partialFilterExpression: { status: REGULARIZATION_STATUS.PENDING } },
);

// The approver's inbox, and an employee's own history.
regularizationSchema.index({ tenantId: 1, status: 1, date: -1 });
regularizationSchema.index({ approverId: 1, status: 1, createdAt: -1 });
regularizationSchema.index({ employeeId: 1, createdAt: -1 });

export default model('Regularization', regularizationSchema);
