import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * Named salary structure template.
 *
 * Deliberately NOT the payroll `SalaryStructure` model, which is a per-employee
 * effective-dated revision. This is the reusable pattern an HR user picks on
 * the Employee Master to prefill the salary components -- "Staff Grade B",
 * "Contract Hourly" -- after which the amounts belong to the employee and can
 * be adjusted independently.
 *
 * Basic is the ANCHOR, and every percentage below is expressed against it
 * rather than against gross -- which is how a Tanzanian salary is quoted, and
 * the opposite of the Indian convention this replaced. One template therefore
 * still fits every salary level, and the components always add up because
 * basic is solved for rather than guessed at. See `deriveStructureFromCtc`.
 */
const salaryTemplateSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null, index: true },

    name: { type: String, required: true, trim: true, maxlength: 100 },
    code: { type: String, required: true, trim: true, uppercase: true, maxlength: 20 },
    description: { type: String, trim: true, maxlength: 250, default: null },

    /* --------------------------------------- percentages, all of basic -- */
    // Optional in Tanzania -- many packages carry no housing allowance at all,
    // so this defaults to nothing rather than to a conventional share.
    hraPercent: { type: Number, default: 0, min: 0, max: 200 },
    transportationPercent: { type: Number, default: 10, min: 0, max: 200 },
    communicationPercent: { type: Number, default: 5, min: 0, max: 200 },
    /**
     * Annual leave allowance, as a percentage of basic PER ANNUM.
     *
     * 100 means one month's basic a year, which is the usual entitlement. The
     * monthly figure it produces is a twelfth of that, because every other
     * amount in a structure is a month's worth.
     */
    annualLeavePercent: { type: Number, default: 100, min: 0, max: 200 },

    /* ------------------------------------------- flat monthly amounts -- */
    foodAllowanceAmount: { type: Number, default: 0, min: 0 },
    mediclaimAmount: { type: Number, default: 0, min: 0 },
    schoolFeesAllowanceAmount: { type: Number, default: 0, min: 0 },

    /* ------------------------------------------------ statutory flags -- */
    // Defaults applied to a new employee on selection; each stays editable.
    // All three are on, because all three apply to almost everyone here.
    nssfApplicable: { type: Boolean, default: true },
    nhifApplicable: { type: Boolean, default: true },
    payeApplicable: { type: Boolean, default: true },

    isDefault: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

salaryTemplateSchema.index({ tenantId: 1, code: 1 }, { unique: true });

export default model('SalaryTemplate', salaryTemplateSchema);
