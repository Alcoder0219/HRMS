import mongoose from 'mongoose';
import { COMPONENT_CODE, TAX_REGIME } from '../../utils/constants.js';

const { Schema, model } = mongoose;

const allowanceSchema = new Schema(
  {
    code: { type: String, default: COMPONENT_CODE.OTHER_ALLOWANCE, trim: true, uppercase: true },
    label: { type: String, required: true, trim: true, maxlength: 60 },
    amount: { type: Number, required: true, min: 0 },
    // Reimbursements are paid in full regardless of loss of pay; fixed
    // allowances scale with it.
    prorate: { type: Boolean, default: true },
    taxable: { type: Boolean, default: true },
  },
  { _id: true },
);

/**
 * An employee's pay structure, effective-dated.
 *
 * Revisions are new rows rather than edits. A payslip must be reproducible
 * years later, and overwriting the structure would silently re-price every
 * historical run -- which is exactly what an auditor checks for.
 */
const salaryStructureSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null, index: true },
    employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },

    effectiveFrom: { type: Date, required: true, index: true },
    // Set when a later revision supersedes this one; null means current.
    effectiveTo: { type: Date, default: null },

    annualCtc: { type: Number, required: true, min: 0 },
    monthlyCtc: { type: Number, required: true, min: 0 },

    basic: { type: Number, required: true, min: 0 },
    hra: { type: Number, default: 0, min: 0 },
    da: { type: Number, default: 0, min: 0 },
    specialAllowance: { type: Number, default: 0, min: 0 },
    otherAllowances: { type: [allowanceSchema], default: [] },

    /* ------------------------------------------------ statutory flags -- */
    // Per employee, because eligibility is individual: a director may be
    // outside PF, a high earner outside ESI.
    pfApplicable: { type: Boolean, default: true },
    esiApplicable: { type: Boolean, default: true },
    ptApplicable: { type: Boolean, default: true },
    tdsApplicable: { type: Boolean, default: true },
    taxRegime: { type: String, enum: Object.values(TAX_REGIME), default: TAX_REGIME.NEW },

    // Carries a declaration-based figure from finance when the projection is
    // not the number to deduct.
    tdsOverride: { type: Number, default: null, min: 0 },

    overtimeEligible: { type: Boolean, default: true },
    overtimeMultiplier: { type: Number, default: 2, min: 1, max: 4 },

    revisionReason: { type: String, trim: true, maxlength: 300, default: null },
    isActive: { type: Boolean, default: true, index: true },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

// One structure per employee per effective date, and the lookup the payroll
// run performs for every person on every run.
salaryStructureSchema.index({ employeeId: 1, effectiveFrom: -1 }, { unique: true });
salaryStructureSchema.index({ tenantId: 1, isActive: 1, effectiveFrom: -1 });

/** Sum of fixed monthly earnings, before variable pay and loss of pay. */
salaryStructureSchema.virtual('grossMonthly').get(function grossMonthly() {
  const allowances = (this.otherAllowances ?? []).reduce((sum, entry) => sum + (entry.amount ?? 0), 0);
  return this.basic + this.hra + this.da + this.specialAllowance + allowances;
});

export default model('SalaryStructure', salaryStructureSchema);
