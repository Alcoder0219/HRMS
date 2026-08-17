import mongoose from 'mongoose';
import { LEAVE_LEDGER_ACTIONS } from '../../utils/constants.js';

const { Schema, model } = mongoose;

/**
 * One movement against a balance.
 *
 * The ledger is why the balance is explainable. A single `available` number can
 * say what someone has left but never why -- and "why is my balance 12 and not
 * 15" is the only question anyone actually asks about leave.
 */
const ledgerEntrySchema = new Schema(
  {
    action: { type: String, enum: Object.values(LEAVE_LEDGER_ACTIONS), required: true },
    days: { type: Number, required: true },
    note: { type: String, trim: true, maxlength: 250, default: null },
    leaveRequestId: { type: Schema.Types.ObjectId, ref: 'LeaveRequest', default: null },
    at: { type: Date, default: Date.now },
    by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { _id: true },
);

/**
 * An employee's entitlement for one leave type in one year.
 *
 * Balances are per-year rather than a running total so a year can be closed and
 * still be readable afterwards: what was granted, what was carried in, what was
 * taken, and what lapsed.
 */
const leaveBalanceSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null, index: true },
    employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    leaveTypeId: { type: Schema.Types.ObjectId, ref: 'LeaveType', required: true, index: true },
    year: { type: Number, required: true, min: 2000, max: 2100, index: true },

    /* ------------------------------------------------------------ credits */

    // The entitlement granted for this year.
    entitled: { type: Number, default: 0, min: 0 },
    // Granted so far when the type accrues monthly rather than up front.
    accrued: { type: Number, default: 0, min: 0 },
    carriedForward: { type: Number, default: 0, min: 0 },
    // Manual correction, positive or negative.
    adjusted: { type: Number, default: 0 },

    /* ------------------------------------------------------------- debits */

    taken: { type: Number, default: 0, min: 0 },
    /**
     * Approved-but-not-yet-started plus awaiting-approval days.
     *
     * Held separately from `taken` so a stack of speculative requests cannot
     * over-commit the same entitlement, while an unapproved request does not
     * yet count as consumed.
     */
    pending: { type: Number, default: 0, min: 0 },
    encashed: { type: Number, default: 0, min: 0 },
    lapsed: { type: Number, default: 0, min: 0 },

    ledger: { type: [ledgerEntrySchema], default: [] },

    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

// One balance per employee, per type, per year.
leaveBalanceSchema.index({ tenantId: 1, employeeId: 1, leaveTypeId: 1, year: 1 }, { unique: true });

/**
 * Credits minus debits.
 *
 * A virtual rather than a stored column: a stored total is a second source of
 * truth that drifts the moment one write updates a component and forgets the
 * total. `.lean()` reads must ask for virtuals or compute it themselves --
 * `deriveAvailable` below exists for exactly that.
 */
leaveBalanceSchema.virtual('available').get(function available() {
  return (
    (this.entitled ?? 0) +
    (this.carriedForward ?? 0) +
    (this.adjusted ?? 0) -
    (this.taken ?? 0) -
    (this.encashed ?? 0) -
    (this.lapsed ?? 0)
  );
});

/** What can still be applied for, once pending requests are set aside. */
leaveBalanceSchema.virtual('usable').get(function usable() {
  return this.available - (this.pending ?? 0);
});

/**
 * The same arithmetic for lean documents, which carry no virtuals.
 *
 * Exported so list endpoints can project it without re-hydrating every row --
 * the `.lean({ virtuals: true })` trap this codebase has been bitten by before.
 */
export const deriveAvailable = (balance = {}) => {
  const available =
    (balance.entitled ?? 0) +
    (balance.carriedForward ?? 0) +
    (balance.adjusted ?? 0) -
    (balance.taken ?? 0) -
    (balance.encashed ?? 0) -
    (balance.lapsed ?? 0);

  return { ...balance, available, usable: available - (balance.pending ?? 0) };
};

export default model('LeaveBalance', leaveBalanceSchema);
