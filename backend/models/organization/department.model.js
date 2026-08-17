import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * Minimal department master. Created here because the Employee record
 * references it; the full Organization module (hierarchy, cost centres,
 * budgets) extends this schema rather than replacing it.
 */
const departmentSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null, index: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    code: { type: String, required: true, trim: true, uppercase: true, maxlength: 20 },
    description: { type: String, trim: true, maxlength: 500, default: null },
    headId: { type: Schema.Types.ObjectId, ref: 'Employee', default: null },
    parentId: { type: Schema.Types.ObjectId, ref: 'Department', default: null },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

departmentSchema.index({ tenantId: 1, code: 1 }, { unique: true });

export default model('Department', departmentSchema);
