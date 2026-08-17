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
 * Percentages are of gross, so one template fits every salary level.
 */
const salaryTemplateSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null, index: true },

    name: { type: String, required: true, trim: true, maxlength: 100 },
    code: { type: String, required: true, trim: true, uppercase: true, maxlength: 20 },
    description: { type: String, trim: true, maxlength: 250, default: null },

    /* ------------------------------------------- component percentages -- */
    basicPercent: { type: Number, default: 40, min: 1, max: 100 },
    // Of basic, not of gross -- HRA is conventionally expressed against basic.
    hraPercentOfBasic: { type: Number, default: 50, min: 0, max: 100 },
    conveyanceAmount: { type: Number, default: 0, min: 0 },
    medicalAmount: { type: Number, default: 0, min: 0 },
    otherAllowanceAmount: { type: Number, default: 0, min: 0 },

    /* ------------------------------------------------ statutory flags -- */
    // Defaults applied to a new employee on selection; each stays editable.
    pfApplicable: { type: Boolean, default: true },
    esiApplicable: { type: Boolean, default: true },
    lwfApplicable: { type: Boolean, default: false },
    professionalTaxApplicable: { type: Boolean, default: true },

    isDefault: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

salaryTemplateSchema.index({ tenantId: 1, code: 1 }, { unique: true });

// Special allowance is the balancing figure, so basic + HRA must leave room
// for it. Above 100% of gross the arithmetic has no solution.
salaryTemplateSchema.pre('validate', function validateSplit(next) {
  const hraShare = (this.basicPercent * this.hraPercentOfBasic) / 100;
  if (this.basicPercent + hraShare > 100) {
    return next(new Error('basic plus HRA cannot exceed 100% of gross'));
  }
  return next();
});

export default model('SalaryTemplate', salaryTemplateSchema);
