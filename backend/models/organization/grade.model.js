import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * Pay grade master.
 *
 * Distinct from designation: two people can share the title "Engineer" and sit
 * in different grades, and it is the grade -- not the title -- that governs
 * salary band, leave entitlement and approval limits.
 *
 * The employee record already carries a free-text `salaryStructure.grade`;
 * this master gives that field a controlled vocabulary without removing it.
 */
const gradeSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null, index: true },

    name: { type: String, required: true, trim: true, maxlength: 60 },
    code: { type: String, required: true, trim: true, uppercase: true, maxlength: 20 },

    // Ordering rank. Higher is more senior; spaced so a tier can be inserted.
    level: { type: Number, default: 1, min: 1, max: 100 },

    minGross: { type: Number, default: 0, min: 0 },
    maxGross: { type: Number, default: 0, min: 0 },

    description: { type: String, trim: true, maxlength: 250, default: null },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

gradeSchema.index({ tenantId: 1, code: 1 }, { unique: true });

// A band whose ceiling sits below its floor would silently accept every
// salary, which defeats the point of having a band at all.
gradeSchema.pre('validate', function validateBand(next) {
  if (this.maxGross && this.minGross && this.maxGross < this.minGross) {
    return next(new Error('maxGross cannot be lower than minGross'));
  }
  return next();
});

export default model('Grade', gradeSchema);
