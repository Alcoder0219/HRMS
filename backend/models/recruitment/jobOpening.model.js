import mongoose from 'mongoose';
import { JOB_STATUS, EMPLOYMENT_TYPE } from '../../utils/constants.js';

const { Schema, model } = mongoose;

/**
 * A requisition: one role, some number of seats.
 *
 * Points at the organisation masters rather than restating them, so a role is
 * described in the same vocabulary the employee it eventually produces will
 * use. That is what makes conversion at the end a copy rather than a
 * translation.
 */
const jobOpeningSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null, index: true },

    code: { type: String, required: true, trim: true, uppercase: true, maxlength: 20 },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 4000, default: null },

    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', default: null, index: true },
    designationId: { type: Schema.Types.ObjectId, ref: 'Designation', default: null },
    unitId: { type: Schema.Types.ObjectId, ref: 'Unit', default: null },
    gradeId: { type: Schema.Types.ObjectId, ref: 'Grade', default: null },

    employmentType: {
      type: String,
      enum: Object.values(EMPLOYMENT_TYPE),
      default: EMPLOYMENT_TYPE.FULL_TIME,
    },

    vacancies: { type: Number, required: true, min: 1, max: 999, default: 1 },
    // Maintained as candidates are hired, so "2 of 3 filled" needs no count.
    filled: { type: Number, default: 0, min: 0 },

    minExperienceYears: { type: Number, default: 0, min: 0, max: 50 },
    maxExperienceYears: { type: Number, default: 0, min: 0, max: 50 },
    minSalary: { type: Number, default: 0, min: 0 },
    maxSalary: { type: Number, default: 0, min: 0 },

    skills: { type: [String], default: [] },
    location: { type: String, trim: true, maxlength: 120, default: null },

    hiringManagerId: { type: Schema.Types.ObjectId, ref: 'Employee', default: null },
    status: { type: String, enum: Object.values(JOB_STATUS), default: JOB_STATUS.DRAFT, index: true },

    openedAt: { type: Date, default: null },
    closesOn: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    closeReason: { type: String, trim: true, maxlength: 300, default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

jobOpeningSchema.index({ tenantId: 1, code: 1 }, { unique: true });
jobOpeningSchema.index({ tenantId: 1, status: 1, createdAt: -1 });

/** Seats still to fill. Never negative, however the counts were edited. */
jobOpeningSchema.virtual('remaining').get(function remaining() {
  return Math.max(0, (this.vacancies ?? 0) - (this.filled ?? 0));
});

/**
 * A band whose ceiling sits below its floor accepts everything and rejects
 * nothing, which is worse than no band at all.
 */
jobOpeningSchema.pre('validate', function validateBands(next) {
  if (this.maxSalary > 0 && this.maxSalary < this.minSalary) {
    return next(new Error('Maximum salary cannot be below the minimum'));
  }

  if (this.maxExperienceYears > 0 && this.maxExperienceYears < this.minExperienceYears) {
    return next(new Error('Maximum experience cannot be below the minimum'));
  }

  return next();
});

export default model('JobOpening', jobOpeningSchema);
