import mongoose from 'mongoose';
import { LEAVE_STATUS, LEAVE_SESSION } from '../../utils/constants.js';

const { Schema, model } = mongoose;

/** One day inside a request, so a partial day is explicit rather than inferred. */
const leaveDaySchema = new Schema(
  {
    date: { type: Date, required: true },
    // 1 for a full day, 0.5 for a half, 0 for a holiday or weekly off that the
    // leave type does not count.
    days: { type: Number, required: true, min: 0, max: 1 },
    session: { type: String, enum: [...Object.values(LEAVE_SESSION), null], default: null },
    // Why a day counted as zero, so a 5-day request showing 3 days is readable.
    reason: { type: String, trim: true, maxlength: 60, default: null },
  },
  { _id: false },
);

const decisionSchema = new Schema(
  {
    decision: { type: String, enum: ['APPROVED', 'REJECTED'], required: true },
    by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    byEmail: { type: String, default: null },
    at: { type: Date, default: Date.now },
    comment: { type: String, trim: true, maxlength: 500, default: null },
  },
  { _id: false },
);

/**
 * An application for leave.
 *
 * The day breakdown is stored rather than recomputed on read. Weekly offs,
 * holidays and the policy that decided them all change over time, so a request
 * approved last March must still show the days it was approved for -- the same
 * snapshot-on-write rule the payslips follow.
 */
const leaveRequestSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null, index: true },
    employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    leaveTypeId: { type: Schema.Types.ObjectId, ref: 'LeaveType', required: true, index: true },

    requestNumber: { type: String, required: true, trim: true, uppercase: true },

    from: { type: Date, required: true, index: true },
    to: { type: Date, required: true },
    // Denormalised so the balance year is unambiguous for a request that
    // straddles a year end.
    year: { type: Number, required: true, index: true },

    days: { type: Number, required: true, min: 0.5 },
    breakdown: { type: [leaveDaySchema], default: [] },

    isHalfDay: { type: Boolean, default: false },
    session: { type: String, enum: [...Object.values(LEAVE_SESSION), null], default: null },

    reason: { type: String, required: true, trim: true, maxlength: 500 },
    contactDuringLeave: { type: String, trim: true, maxlength: 60, default: null },

    status: {
      type: String,
      enum: Object.values(LEAVE_STATUS),
      default: LEAVE_STATUS.PENDING,
      index: true,
    },

    decision: { type: decisionSchema, default: null },
    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, trim: true, maxlength: 300, default: null },

    // Who the request was routed to when it was raised.
    approverId: { type: Schema.Types.ObjectId, ref: 'Employee', default: null },

    /**
     * What the type allowed at the time of application.
     *
     * Rules change; a request has to remain explainable against the ones that
     * were actually applied to it.
     */
    typeSnapshot: { type: Schema.Types.Mixed, default: null },

    document: {
      fileName: { type: String, default: null },
      filePath: { type: String, default: null },
      mimeType: { type: String, default: null },
      size: { type: Number, default: 0 },
    },

    appliedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

leaveRequestSchema.index({ tenantId: 1, employeeId: 1, from: 1 });
leaveRequestSchema.index({ tenantId: 1, status: 1, from: 1 });
leaveRequestSchema.index({ tenantId: 1, requestNumber: 1 }, { unique: true });

/** A range that ends before it starts would silently produce zero days. */
leaveRequestSchema.pre('validate', function validateRange(next) {
  if (this.from && this.to && this.to < this.from) {
    return next(new Error('The last day of leave cannot be before the first'));
  }

  if (this.isHalfDay && this.from && this.to && this.from.getTime() !== this.to.getTime()) {
    return next(new Error('A half day must start and end on the same date'));
  }

  return next();
});

export default model('LeaveRequest', leaveRequestSchema);
