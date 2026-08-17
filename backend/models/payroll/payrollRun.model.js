import mongoose from 'mongoose';
import { PAYROLL_STATUS } from '../../utils/constants.js';

const { Schema, model } = mongoose;

/**
 * One payroll cycle for a tenant: a month, its status, and its totals.
 *
 * The run is the unit of approval and audit. Payslips hang off it, and its
 * status is what decides whether figures may still change -- so the lifecycle
 * lives here rather than being inferred from the slips.
 */
const payrollRunSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null, index: true },

    year: { type: Number, required: true, min: 2000, max: 2100 },
    month: { type: Number, required: true, min: 1, max: 12 },
    // Human label ("August 2026"), stamped once so a renamed locale setting
    // cannot retitle a historical register.
    period: { type: String, required: true },

    // Snapshot of how the month was measured. Changing the policy later must
    // not silently re-price a completed run.
    totalDaysInMonth: { type: Number, required: true },
    payableDaysBasis: { type: String, enum: ['CALENDAR', 'WORKING'], default: 'CALENDAR' },

    status: {
      type: String,
      enum: Object.values(PAYROLL_STATUS),
      default: PAYROLL_STATUS.DRAFT,
      index: true,
    },

    /* ---------------------------------------------------------- totals -- */
    employeeCount: { type: Number, default: 0 },
    totalGross: { type: Number, default: 0 },
    totalDeductions: { type: Number, default: 0 },
    totalNet: { type: Number, default: 0 },
    totalEmployerContribution: { type: Number, default: 0 },
    totalPf: { type: Number, default: 0 },
    totalEsi: { type: Number, default: 0 },
    totalPt: { type: Number, default: 0 },
    totalTds: { type: Number, default: 0 },
    totalLoanRecovery: { type: Number, default: 0 },

    /* -------------------------------------------------------- workflow -- */
    processedAt: { type: Date, default: null },
    processedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    submittedAt: { type: Date, default: null },
    submittedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    approvedAt: { type: Date, default: null },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    paidAt: { type: Date, default: null },
    paidBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    paymentReference: { type: String, trim: true, default: null },

    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, trim: true, maxlength: 500, default: null },

    remarks: { type: String, trim: true, maxlength: 1000, default: null },

    // Rows the run could not price -- no structure, no bank details. Surfaced
    // rather than silently skipped, because a missing payslip is a person who
    // does not get paid.
    exclusions: {
      type: [
        new Schema(
          {
            employeeId: { type: Schema.Types.ObjectId, ref: 'Employee' },
            employeeCode: String,
            reason: String,
          },
          { _id: false },
        ),
      ],
      default: [],
    },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

// One run per tenant per month. Re-running replaces its payslips rather than
// creating a second register for the same period.
payrollRunSchema.index({ tenantId: 1, year: 1, month: 1 }, { unique: true });
payrollRunSchema.index({ tenantId: 1, status: 1, year: -1, month: -1 });

payrollRunSchema.virtual('isEditable').get(function isEditable() {
  return [PAYROLL_STATUS.DRAFT, PAYROLL_STATUS.PROCESSING, PAYROLL_STATUS.PENDING_APPROVAL].includes(
    this.status,
  );
});

export default model('PayrollRun', payrollRunSchema);
