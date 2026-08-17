import mongoose from 'mongoose';
import { PAYSLIP_STATUS } from '../../utils/constants.js';

const { Schema, model } = mongoose;

const componentSchema = new Schema(
  {
    code: { type: String, required: true },
    label: { type: String, required: true },
    amount: { type: Number, required: true },
    // Free-form context: PF wage base, overtime hours, loan breakup.
    meta: { type: Schema.Types.Mixed, default: null },
  },
  { _id: false },
);

/**
 * One employee's pay for one run.
 *
 * Everything needed to reproduce and explain the figure is stored on the slip
 * itself -- the structure it was priced from, the attendance it was prorated
 * by, the statutory bases used. Recomputing a historical payslip from live
 * masters would produce a different number the moment anything upstream
 * changes, which is precisely what must never happen.
 */
const payslipSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null, index: true },
    payrollRunId: { type: Schema.Types.ObjectId, ref: 'PayrollRun', required: true, index: true },
    employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },

    year: { type: Number, required: true },
    month: { type: Number, required: true },
    period: { type: String, required: true },

    /* ------------------------------------------------------- snapshots -- */
    employeeSnapshot: {
      type: new Schema(
        {
          employeeCode: String,
          /**
           * The business-facing employee ID, captured with the rest of the
           * snapshot so a reissued payslip quotes the identifier the employee
           * actually had. Distinct from the sibling `employeeId` on the payslip
           * itself, which is the Mongo reference.
           *
           * Payslips written before this field existed simply have none, so
           * readers must tolerate its absence.
           */
          employeeId: String,
          fullName: String,
          designation: String,
          department: String,
          joiningDate: Date,
          pan: String,
          uan: String,
          pfNumber: String,
          esiNumber: String,
          bankName: String,
          // Masked for display; the bank file reads the live record.
          accountNumberMasked: String,
          ifsc: String,
        },
        { _id: false },
      ),
      default: null,
    },

    structureId: { type: Schema.Types.ObjectId, ref: 'SalaryStructure', default: null },
    structureSnapshot: { type: Schema.Types.Mixed, default: null },

    attendance: {
      type: new Schema(
        {
          totalDays: Number,
          payableDays: Number,
          lopDays: Number,
          presentDays: Number,
          overtimeMinutes: Number,
        },
        { _id: false },
      ),
      default: null,
    },

    /* ------------------------------------------------------ components -- */
    earnings: { type: [componentSchema], default: [] },
    deductions: { type: [componentSchema], default: [] },
    employerContributions: { type: [componentSchema], default: [] },

    grossEarnings: { type: Number, default: 0 },
    totalDeductions: { type: Number, default: 0 },
    employerContributionTotal: { type: Number, default: 0 },
    netPayable: { type: Number, default: 0 },
    // Deductions that exceeded gross and could not be taken this month.
    unrecovered: { type: Number, default: 0 },

    statutoryDetail: { type: Schema.Types.Mixed, default: null },
    recoveries: { type: Schema.Types.Mixed, default: null },

    /* ---------------------------------------------------- year to date -- */
    // Stamped at generation so a payslip reprint shows the same YTD figures it
    // was issued with.
    ytd: {
      type: new Schema(
        { gross: Number, deductions: Number, net: Number, pf: Number, tds: Number },
        { _id: false },
      ),
      default: null,
    },

    status: {
      type: String,
      enum: Object.values(PAYSLIP_STATUS),
      default: PAYSLIP_STATUS.DRAFT,
      index: true,
    },
    // Held slips stay in the register but are excluded from the bank file.
    holdReason: { type: String, trim: true, maxlength: 300, default: null },

    publishedAt: { type: Date, default: null },
    remarks: { type: String, trim: true, maxlength: 500, default: null },

    generatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

// One slip per employee per run -- the invariant regeneration upserts against.
payslipSchema.index({ payrollRunId: 1, employeeId: 1 }, { unique: true });
// An employee's own payslip history, and the YTD walk.
payslipSchema.index({ employeeId: 1, year: -1, month: -1 });
payslipSchema.index({ tenantId: 1, year: 1, month: 1, status: 1 });

export default model('Payslip', payslipSchema);
