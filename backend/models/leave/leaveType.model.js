import mongoose from 'mongoose';
import { LEAVE_ACCRUAL } from '../../utils/constants.js';

const { Schema, model } = mongoose;

/**
 * A category of leave and the rules that govern it.
 *
 * Everything about how a leave behaves lives here rather than in code: the
 * entitlement, whether it accrues monthly, whether unused days survive the year
 * end, whether they can be paid out. Those are customer policy decisions that
 * differ per organisation and change without a release.
 */
const leaveTypeSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null, index: true },

    name: { type: String, required: true, trim: true, maxlength: 80 },
    code: { type: String, required: true, trim: true, uppercase: true, maxlength: 20 },
    description: { type: String, trim: true, maxlength: 300, default: null },

    /* ------------------------------------------------------ entitlement -- */

    daysPerYear: { type: Number, default: 0, min: 0, max: 365 },
    accrual: { type: String, enum: Object.values(LEAVE_ACCRUAL), default: LEAVE_ACCRUAL.ANNUAL },

    /**
     * Unpaid leave still consumes a balance and still needs approving, but it
     * reaches payroll as a loss of pay rather than a paid day.
     */
    isPaid: { type: Boolean, default: true },

    /* --------------------------------------------------------- eligibility */

    // Probationers usually cannot draw the full entitlement on day one.
    applicableAfterMonths: { type: Number, default: 0, min: 0, max: 60 },
    // null means every gender; maternity and paternity are the reason this exists.
    applicableGender: { type: String, enum: ['MALE', 'FEMALE', 'OTHER', null], default: null },

    /* -------------------------------------------------------------- rules */

    allowHalfDay: { type: Boolean, default: true },
    // Applying the morning of is how leave calendars become fiction.
    minNoticeDays: { type: Number, default: 0, min: 0, max: 90 },
    maxConsecutiveDays: { type: Number, default: 0, min: 0, max: 365 },
    // Beyond this many days a medical certificate is expected.
    requiresDocumentAfterDays: { type: Number, default: 0, min: 0, max: 365 },
    requiresApproval: { type: Boolean, default: true },
    // Weekly offs and holidays inside a long leave: counted, or skipped.
    countsHolidays: { type: Boolean, default: false },
    allowNegativeBalance: { type: Boolean, default: false },

    /* ------------------------------------------------------ carry forward */

    carryForward: {
      enabled: { type: Boolean, default: false },
      maxDays: { type: Number, default: 0, min: 0, max: 365 },
      // Carried days that are not used within this many months lapse.
      expiryMonths: { type: Number, default: 12, min: 1, max: 60 },
    },

    /* --------------------------------------------------------- encashment */

    encashment: {
      enabled: { type: Boolean, default: false },
      maxDays: { type: Number, default: 0, min: 0, max: 365 },
      // Only balance above this floor may be paid out.
      minBalanceToRetain: { type: Number, default: 0, min: 0, max: 365 },
    },

    colour: { type: String, trim: true, maxlength: 20, default: null },
    isActive: { type: Boolean, default: true, index: true },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

leaveTypeSchema.index({ tenantId: 1, code: 1 }, { unique: true });

/**
 * A carry-forward cap above the annual entitlement is meaningless, and a
 * silently ignored setting is worse than a rejected one.
 */
leaveTypeSchema.pre('validate', function validateRules(next) {
  if (this.carryForward?.enabled && this.carryForward.maxDays > this.daysPerYear && this.daysPerYear > 0) {
    return next(new Error('Carry-forward days cannot exceed the annual entitlement'));
  }

  if (this.encashment?.enabled && this.encashment.maxDays > this.daysPerYear && this.daysPerYear > 0) {
    return next(new Error('Encashable days cannot exceed the annual entitlement'));
  }

  return next();
});

export default model('LeaveType', leaveTypeSchema);
