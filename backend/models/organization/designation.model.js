import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * Minimal designation (job title) master, referenced by Employee. `level` is
 * kept here so grade-based rules -- approval limits, salary bands -- have a
 * numeric handle without parsing the title.
 */
const designationSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null, index: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    code: { type: String, required: true, trim: true, uppercase: true, maxlength: 20 },
    level: { type: Number, default: 1, min: 1, max: 20 },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', default: null },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

designationSchema.index({ tenantId: 1, code: 1 }, { unique: true });

export default model('Designation', designationSchema);
