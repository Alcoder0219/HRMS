import mongoose from 'mongoose';
import { CANDIDATE_STAGE, CANDIDATE_SOURCE } from '../../utils/constants.js';

const { Schema, model } = mongoose;

/** Every stage move, so time-to-hire is measurable rather than estimated. */
const stageEntrySchema = new Schema(
  {
    stage: { type: String, enum: Object.values(CANDIDATE_STAGE), required: true },
    at: { type: Date, default: Date.now },
    by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    note: { type: String, trim: true, maxlength: 500, default: null },
  },
  { _id: false },
);

/**
 * Someone applying for a job.
 *
 * Deliberately NOT an Employee. A candidate has no employee code, no salary
 * structure and no attendance -- and most never will. Conversion happens once,
 * when an offer is accepted and they actually turn up, and is the only point
 * where the two meet.
 */
const candidateSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null, index: true },

    firstName: { type: String, required: true, trim: true, maxlength: 60 },
    lastName: { type: String, required: true, trim: true, maxlength: 60 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 120, index: true },
    phone: { type: String, trim: true, maxlength: 20, default: null },

    jobOpeningId: { type: Schema.Types.ObjectId, ref: 'JobOpening', required: true, index: true },

    source: { type: String, enum: Object.values(CANDIDATE_SOURCE), default: CANDIDATE_SOURCE.DIRECT },
    // Free text: the referrer may not be an employee, and often is not.
    referredBy: { type: String, trim: true, maxlength: 120, default: null },

    totalExperienceYears: { type: Number, default: 0, min: 0, max: 60 },
    currentEmployer: { type: String, trim: true, maxlength: 120, default: null },
    currentCtc: { type: Number, default: 0, min: 0 },
    expectedCtc: { type: Number, default: 0, min: 0 },
    noticePeriodDays: { type: Number, default: 0, min: 0, max: 365 },

    skills: { type: [String], default: [] },

    /**
     * The resume, stored the same way employee documents are, so the upload
     * path, the static mount and the preview all behave identically.
     */
    resume: {
      fileName: { type: String, default: null },
      filePath: { type: String, default: null },
      mimeType: { type: String, default: null },
      size: { type: Number, default: 0 },
      uploadedAt: { type: Date, default: null },
    },

    stage: {
      type: String,
      enum: Object.values(CANDIDATE_STAGE),
      default: CANDIDATE_STAGE.APPLIED,
      index: true,
    },
    stageHistory: { type: [stageEntrySchema], default: [] },

    rejectionReason: { type: String, trim: true, maxlength: 300, default: null },
    notes: { type: String, trim: true, maxlength: 2000, default: null },

    // Set once the candidate becomes an employee. The link both directions is
    // what stops a second conversion creating a duplicate person.
    convertedEmployeeId: { type: Schema.Types.ObjectId, ref: 'Employee', default: null },
    convertedAt: { type: Date, default: null },

    appliedAt: { type: Date, default: Date.now },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

/**
 * One application per person per role.
 *
 * The same person applying for a DIFFERENT opening is legitimate and common,
 * so the constraint is the pair rather than the email alone.
 */
candidateSchema.index({ tenantId: 1, email: 1, jobOpeningId: 1 }, { unique: true });
candidateSchema.index({ tenantId: 1, stage: 1, createdAt: -1 });

candidateSchema.virtual('fullName').get(function fullName() {
  return `${this.firstName} ${this.lastName}`.trim();
});

export default model('Candidate', candidateSchema);
