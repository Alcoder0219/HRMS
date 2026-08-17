import mongoose from 'mongoose';
import { LOAN_STATUS, LOAN_TYPES } from '../../utils/constants.js';

const { Schema, model } = mongoose;

const instalmentSchema = new Schema(
  {
    sequence: { type: Number, required: true },
    dueYear: { type: Number, required: true },
    dueMonth: { type: Number, required: true },
    amount: { type: Number, required: true, min: 0 },
    paidAmount: { type: Number, default: 0, min: 0 },
    paidOn: { type: Date, default: null },
    payslipId: { type: Schema.Types.ObjectId, ref: 'Payslip', default: null },
    status: { type: String, enum: ['PENDING', 'PAID', 'SKIPPED', 'WAIVED'], default: 'PENDING' },
  },
  { _id: false },
);

/**
 * Employee loans and salary advances.
 *
 * One model covers both: an advance is a loan with a short tenure, and giving
 * them separate schemas would duplicate the entire recovery and schedule
 * machinery for no gain. `type` distinguishes them for reporting.
 *
 * The schedule is materialised up front rather than derived each run, so a
 * skipped month is a visible gap in the plan instead of a silent shift.
 */
const loanSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null, index: true },
    employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },

    loanNumber: { type: String, required: true, trim: true, uppercase: true },
    type: { type: String, enum: Object.values(LOAN_TYPES), default: LOAN_TYPES.PERSONAL },

    principal: { type: Number, required: true, min: 1 },
    // Simple annual rate; zero for an interest-free advance, which is the norm.
    interestRate: { type: Number, default: 0, min: 0, max: 100 },
    totalPayable: { type: Number, required: true, min: 0 },

    tenureMonths: { type: Number, required: true, min: 1, max: 120 },
    emi: { type: Number, required: true, min: 1 },

    // Recovery starts here, which need not be the disbursement month.
    recoveryStartYear: { type: Number, required: true },
    recoveryStartMonth: { type: Number, required: true, min: 1, max: 12 },

    /* ---------------------------------------------------------- ledger -- */
    // The authoritative figure. Every recovery decrements it, and the payroll
    // engine never deducts more than what remains.
    outstanding: { type: Number, required: true, min: 0 },
    recoveredAmount: { type: Number, default: 0, min: 0 },
    instalments: { type: [instalmentSchema], default: [] },

    status: {
      type: String,
      enum: Object.values(LOAN_STATUS),
      default: LOAN_STATUS.PENDING,
      index: true,
    },

    // Pauses recovery without closing the loan -- unpaid leave, a hardship
    // request. The schedule is preserved; the deduction simply does not run.
    isOnHold: { type: Boolean, default: false },
    holdReason: { type: String, trim: true, maxlength: 300, default: null },

    purpose: { type: String, trim: true, maxlength: 300, default: null },
    disbursedOn: { type: Date, default: null },
    closedOn: { type: Date, default: null },

    approvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null },
    rejectionReason: { type: String, trim: true, maxlength: 300, default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

loanSchema.index({ tenantId: 1, loanNumber: 1 }, { unique: true });
// The query every payroll run makes: active loans for these employees.
loanSchema.index({ employeeId: 1, status: 1, isOnHold: 1 });

loanSchema.virtual('isRecoverable').get(function isRecoverable() {
  return (
    [LOAN_STATUS.DISBURSED, LOAN_STATUS.ACTIVE].includes(this.status) &&
    !this.isOnHold &&
    this.outstanding > 0
  );
});

loanSchema.virtual('completedInstalments').get(function completedInstalments() {
  return (this.instalments ?? []).filter((entry) => entry.status === 'PAID').length;
});

export default model('Loan', loanSchema);
