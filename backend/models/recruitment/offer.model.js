import mongoose from 'mongoose';
import { OFFER_STATUS, EMPLOYMENT_TYPE } from '../../utils/constants.js';

const { Schema, model } = mongoose;

/**
 * A formal offer to a candidate.
 *
 * Carries the placement it promises -- department, designation, grade, unit --
 * because those are what conversion copies onto the employee record. An offer
 * that only said "we will pay you X" would leave the joining step guessing at
 * everything else.
 */
const offerSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null, index: true },

    offerNumber: { type: String, required: true, trim: true, uppercase: true },

    candidateId: { type: Schema.Types.ObjectId, ref: 'Candidate', required: true, index: true },
    jobOpeningId: { type: Schema.Types.ObjectId, ref: 'JobOpening', required: true, index: true },

    /* ------------------------------------------------------- placement -- */

    designationId: { type: Schema.Types.ObjectId, ref: 'Designation', default: null },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', default: null },
    unitId: { type: Schema.Types.ObjectId, ref: 'Unit', default: null },
    gradeId: { type: Schema.Types.ObjectId, ref: 'Grade', default: null },
    reportingManagerId: { type: Schema.Types.ObjectId, ref: 'Employee', default: null },

    employmentType: {
      type: String,
      enum: Object.values(EMPLOYMENT_TYPE),
      default: EMPLOYMENT_TYPE.FULL_TIME,
    },

    /* ------------------------------------------------------------ terms -- */

    annualCtc: { type: Number, required: true, min: 0 },
    // The split is optional here: payroll builds the real structure at joining.
    monthlyCtc: { type: Number, default: 0, min: 0 },
    probationMonths: { type: Number, default: 0, min: 0, max: 24 },
    noticePeriodDays: { type: Number, default: 0, min: 0, max: 365 },

    proposedJoiningDate: { type: Date, required: true },
    validUntil: { type: Date, default: null },

    /* --------------------------------------------------------- workflow -- */

    status: { type: String, enum: Object.values(OFFER_STATUS), default: OFFER_STATUS.DRAFT, index: true },

    sentAt: { type: Date, default: null },
    respondedAt: { type: Date, default: null },
    declineReason: { type: String, trim: true, maxlength: 300, default: null },
    withdrawReason: { type: String, trim: true, maxlength: 300, default: null },

    /* ---------------------------------------------------------- joining -- */

    actualJoiningDate: { type: Date, default: null },
    // Set when the offer becomes a person on the payroll.
    employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', default: null },
    joinedAt: { type: Date, default: null },

    notes: { type: String, trim: true, maxlength: 2000, default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

offerSchema.index({ tenantId: 1, offerNumber: 1 }, { unique: true });
offerSchema.index({ tenantId: 1, status: 1, createdAt: -1 });

/** An offer that expires before it is made cannot be accepted. */
offerSchema.pre('validate', function validateDates(next) {
  if (this.validUntil && this.proposedJoiningDate && this.validUntil > this.proposedJoiningDate) {
    return next(new Error('The offer cannot stay open past the proposed joining date'));
  }

  return next();
});

export default model('Offer', offerSchema);
