import mongoose from 'mongoose';
import { BANK_FILE_FORMATS, TAX_REGIME, DEFAULT_MONTHLY_WORKING_HOURS } from '../../utils/constants.js';
import { DEFAULT_STATUTORY } from '../../helpers/statutory.helper.js';

const { Schema, model } = mongoose;

const slabSchema = new Schema(
  {
    // `null` marks the open-ended top slab.
    upTo: { type: Number, default: null },
    rate: { type: Number, default: 0, min: 0, max: 100 },
    amount: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

/**
 * Tenant payroll configuration.
 *
 * Every statutory rate, ceiling and slab lives here rather than in code:
 * they are set by legislation on its own schedule, and an HRMS that needs a
 * release to follow a budget announcement is broken by design.
 */
const payrollSettingsSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null, unique: true },

    currency: { type: String, default: 'INR', maxlength: 3 },
    // Indian financial year starts in April; configurable for other markets.
    financialYearStartMonth: { type: Number, default: 4, min: 1, max: 12 },

    /* ------------------------------------------------------------- PF -- */
    pf: {
      enabled: { type: Boolean, default: true },
      employeeRate: { type: Number, default: DEFAULT_STATUTORY.pf.employeeRate },
      employerRate: { type: Number, default: DEFAULT_STATUTORY.pf.employerRate },
      pensionRate: { type: Number, default: DEFAULT_STATUTORY.pf.pensionRate },
      wageCeiling: { type: Number, default: DEFAULT_STATUTORY.pf.wageCeiling },
      applyCeiling: { type: Boolean, default: true },
      includeDaInWages: { type: Boolean, default: true },
      establishmentCode: { type: String, trim: true, default: null },
    },

    /* ------------------------------------------------------------ ESI -- */
    esi: {
      enabled: { type: Boolean, default: true },
      employeeRate: { type: Number, default: DEFAULT_STATUTORY.esi.employeeRate },
      employerRate: { type: Number, default: DEFAULT_STATUTORY.esi.employerRate },
      grossCeiling: { type: Number, default: DEFAULT_STATUTORY.esi.grossCeiling },
      establishmentCode: { type: String, trim: true, default: null },
    },

    /* ------------------------------------------- professional tax ------ */
    professionalTax: {
      enabled: { type: Boolean, default: true },
      state: { type: String, trim: true, default: null },
      slabs: { type: [slabSchema], default: () => DEFAULT_STATUTORY.professionalTax.slabs },
      februaryAmount: { type: Number, default: DEFAULT_STATUTORY.professionalTax.februaryAmount },
      annualCap: { type: Number, default: DEFAULT_STATUTORY.professionalTax.annualCap },
    },

    /* ------------------------------------------------------ income tax -- */
    incomeTax: {
      enabled: { type: Boolean, default: true },
      regime: { type: String, enum: Object.values(TAX_REGIME), default: TAX_REGIME.NEW },
      standardDeduction: { type: Number, default: DEFAULT_STATUTORY.incomeTax.standardDeduction },
      slabs: { type: [slabSchema], default: () => DEFAULT_STATUTORY.incomeTax.slabs },
      rebateLimit: { type: Number, default: DEFAULT_STATUTORY.incomeTax.rebateLimit },
      rebateAmount: { type: Number, default: DEFAULT_STATUTORY.incomeTax.rebateAmount },
      cessRate: { type: Number, default: DEFAULT_STATUTORY.incomeTax.cessRate },
      tanNumber: { type: String, trim: true, uppercase: true, default: null },
    },

    /* --------------------------------------------------------- payroll -- */
    // Working days per month: 'CALENDAR' pays on 30/31, 'WORKING' excludes
    // weekly offs. The choice changes every per-day rate in the system.
    payableDaysBasis: { type: String, enum: ['CALENDAR', 'WORKING'], default: 'CALENDAR' },
    overtimeMultiplier: { type: Number, default: 2, min: 1, max: 4 },
    /**
     * Divisor for the salary-based hourly rate: monthly gross / these hours.
     * Company-wide, with a per-employee override for anyone who does not work
     * a standard month.
     */
    monthlyWorkingHours: { type: Number, default: DEFAULT_MONTHLY_WORKING_HOURS, min: 1, max: 744 },
    // Payroll cannot run until attendance for the month is locked.
    requireAttendanceLock: { type: Boolean, default: false },

    /* ------------------------------------------------------------ bank -- */
    bank: {
      format: { type: String, enum: Object.values(BANK_FILE_FORMATS), default: BANK_FILE_FORMATS.GENERIC_CSV },
      companyAccountNumber: { type: String, trim: true, default: null },
      companyName: { type: String, trim: true, default: null },
      ifsc: { type: String, trim: true, uppercase: true, default: null },
      debitNarration: { type: String, trim: true, default: 'SALARY' },
    },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

export default model('PayrollSettings', payrollSettingsSchema);
