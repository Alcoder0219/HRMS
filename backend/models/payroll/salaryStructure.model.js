import mongoose from 'mongoose';
import { COMPONENT_CODE } from '../../utils/constants.js';

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
    hraAllowance: { type: Number, default: 0, min: 0 },
    foodAllowance: { type: Number, default: 0, min: 0 },
    transportationAllowance: { type: Number, default: 0, min: 0 },
    communicationAllowance: { type: Number, default: 0, min: 0 },
    mediclaim: { type: Number, default: 0, min: 0 },
    schoolFeesAllowance: { type: Number, default: 0, min: 0 },
    // Per annum by entitlement, stored as its monthly equivalent -- see the
    // Employee Master field of the same name.
    annualLeaveAllowance: { type: Number, default: 0, min: 0 },
    performanceIncentive: { type: Number, default: 0, min: 0 },
    otherAllowances: { type: [allowanceSchema], default: [] },

    /* ------------------------------------------------ statutory flags -- */
    // Per employee, because enrolment is individual: a short-term consultant
    // may sit outside NSSF, an expatriate outside NHIF.
    nssfApplicable: { type: Boolean, default: true },
    nhifApplicable: { type: Boolean, default: true },
    payeApplicable: { type: Boolean, default: true },

    // Carries a figure finance has determined outside the slabs -- a TRA
    // assessment -- when the calculated amount is not the number to deduct.
    payeOverride: { type: Number, default: null, min: 0 },

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

/**
 * Sum of fixed monthly earnings, before variable pay and loss of pay.
 *
 * The named columns are listed rather than spread so that adding a column
 * without adding it here is a visible omission instead of a silently
 * under-stated gross.
 */
export const STRUCTURE_EARNING_FIELDS = [
  'basic',
  'hraAllowance',
  'foodAllowance',
  'transportationAllowance',
  'communicationAllowance',
  'mediclaim',
  'schoolFeesAllowance',
  'annualLeaveAllowance',
  'performanceIncentive',
];

/** Gross for one structure, used by payroll, loans and settlements alike. */
export const structureGross = (structure = {}) =>
  STRUCTURE_EARNING_FIELDS.reduce((sum, field) => sum + (Number(structure[field]) || 0), 0) +
  (structure.otherAllowances ?? []).reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);

salaryStructureSchema.virtual('grossMonthly').get(function grossMonthly() {
  return structureGross(this);
});

export default model('SalaryStructure', salaryStructureSchema);
