import mongoose from 'mongoose';
import { SETTLEMENT_STATUS, SETTLEMENT_TRIGGER } from '../../utils/constants.js';

const { Schema, model } = mongoose;

const componentSchema = new Schema(
  {
    code: { type: String, required: true },
    label: { type: String, required: true },
    amount: { type: Number, required: true },
    meta: { type: Schema.Types.Mixed, default: null },
  },
  { _id: false },
);

const approvalSchema = new Schema(
  {
    stage: { type: String, required: true }, // HR | FINANCE
    decision: { type: String, enum: ['APPROVED', 'RETURNED', 'HELD'], required: true },
    by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    byEmail: { type: String, default: null },
    at: { type: Date, default: Date.now },
    comment: { type: String, trim: true, maxlength: 500, default: null },
  },
  { _id: false },
);

/**
 * Full and final settlement for one exit.
 *
 * Every input the calculation used is stored alongside the result -- the
 * structure, the service span, the notice figures, the asset list. Exit money
 * is disputed far more often than monthly pay, sometimes long after the person
 * has left, and recomputing from live masters would give a different answer
 * the moment anything upstream changed.
 */
const settlementSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null, index: true },
    // Not `index: true` -- the compound history index below covers equality
    // lookups, and declaring both would create two indexes on the same key.
    employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },

    settlementNumber: { type: String, required: true, trim: true, uppercase: true },

    trigger: { type: String, enum: Object.values(SETTLEMENT_TRIGGER), required: true },

    /* ------------------------------------------------------ exit facts -- */
    resignationDate: { type: Date, default: null },
    lastWorkingDate: { type: Date, required: true },
    // The month payroll last paid; pending salary runs from the day after.
    lastPaidUpto: { type: Date, default: null },
    exitReason: { type: String, trim: true, maxlength: 500, default: null },
    rehireEligible: { type: Boolean, default: true },

    /* --------------------------------------------------------- service -- */
    joiningDate: { type: Date, required: true },
    service: {
      type: new Schema(
        {
          years: Number,
          months: Number,
          days: Number,
          totalDays: Number,
          completedYears: Number,
        },
        { _id: false },
      ),
      default: null,
    },

    /* ---------------------------------------------------------- notice -- */
    notice: {
      type: new Schema(
        {
          requiredDays: Number,
          servedDays: Number,
          waivedDays: Number,
          employerWaived: Boolean,
          direction: String, // PAYABLE | RECOVERABLE | NONE
          days: Number,
          perDay: Number,
          amount: Number,
          reason: String,
        },
        { _id: false },
      ),
      default: null,
    },

    /* ----------------------------------------------------------- leave -- */
    leave: {
      type: new Schema(
        { encashableDays: Number, excessDays: Number, perDay: Number, amount: Number },
        { _id: false },
      ),
      default: null,
    },

    gratuity: { type: Schema.Types.Mixed, default: null },

    /* ------------------------------------------------------- snapshots -- */
    employeeSnapshot: { type: Schema.Types.Mixed, default: null },
    structureSnapshot: { type: Schema.Types.Mixed, default: null },
    rulesSnapshot: { type: Schema.Types.Mixed, default: null },

    /* ------------------------------------------------------- recovery --- */
    loans: { type: [Schema.Types.Mixed], default: [] },
    advances: { type: [Schema.Types.Mixed], default: [] },
    assets: { type: [Schema.Types.Mixed], default: [] },
    // Assets the employee still holds that HR has not yet resolved. Blocks
    // approval, because settling with kit outstanding is how it never comes back.
    pendingAssetCount: { type: Number, default: 0 },

    /* ------------------------------------------------------ the sheet --- */
    earnings: { type: [componentSchema], default: [] },
    deductions: { type: [componentSchema], default: [] },

    totalEarnings: { type: Number, default: 0 },
    totalDeductions: { type: Number, default: 0 },
    // Signed: negative means the employee owes the company.
    netSettlement: { type: Number, default: 0 },
    payableTo: { type: String, enum: ['EMPLOYEE', 'COMPANY'], default: 'EMPLOYEE' },
    recoverableAmount: { type: Number, default: 0 },

    /* -------------------------------------------------------- workflow -- */
    status: {
      type: String,
      enum: Object.values(SETTLEMENT_STATUS),
      default: SETTLEMENT_STATUS.DRAFT,
      index: true,
    },
    approvals: { type: [approvalSchema], default: [] },

    holdReason: { type: String, trim: true, maxlength: 500, default: null },
    cancelReason: { type: String, trim: true, maxlength: 500, default: null },

    submittedAt: { type: Date, default: null },
    hrApprovedAt: { type: Date, default: null },
    hrApprovedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    financeApprovedAt: { type: Date, default: null },
    financeApprovedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    paidAt: { type: Date, default: null },
    paidBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    paymentReference: { type: String, trim: true, maxlength: 120, default: null },
    paymentMode: { type: String, trim: true, maxlength: 40, default: null },

    remarks: { type: String, trim: true, maxlength: 1000, default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

settlementSchema.index({ tenantId: 1, settlementNumber: 1 }, { unique: true });

// One live settlement per employee. A second one for the same exit would give
// two different final figures, and a rehire's settlement must not collide with
// an abandoned draft from the first stint.
settlementSchema.index(
  { employeeId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: {
        $in: [
          SETTLEMENT_STATUS.DRAFT,
          SETTLEMENT_STATUS.PENDING_HR,
          SETTLEMENT_STATUS.PENDING_FINANCE,
          SETTLEMENT_STATUS.APPROVED,
          SETTLEMENT_STATUS.ON_HOLD,
        ],
      },
    },
  },
);

// An employee's settlement history, including closed ones -- the partial
// unique index above only covers the live statuses.
settlementSchema.index({ employeeId: 1, createdAt: -1 });

// The approval queues and the dashboard.
settlementSchema.index({ tenantId: 1, status: 1, lastWorkingDate: -1 });

settlementSchema.virtual('isEditable').get(function isEditable() {
  return [SETTLEMENT_STATUS.DRAFT, SETTLEMENT_STATUS.PENDING_HR, SETTLEMENT_STATUS.ON_HOLD].includes(
    this.status,
  );
});

/** Days since the last working date -- the ageing figure the dashboard ranks by. */
settlementSchema.virtual('ageDays').get(function ageDays() {
  if (!this.lastWorkingDate) return 0;
  const end = this.paidAt ?? new Date();
  return Math.max(0, Math.floor((end - this.lastWorkingDate) / 86_400_000));
});

export default model('Settlement', settlementSchema);
