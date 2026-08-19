import mongoose from 'mongoose';
import { BANK_FILE_FORMATS, CURRENCY, DEFAULT_MONTHLY_WORKING_HOURS } from '../../utils/constants.js';
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

    // The ISO code, not the local symbol -- see CURRENCY in utils/constants.js.
    currency: { type: String, default: CURRENCY.CODE, maxlength: 3 },
    // Tanzania's tax year runs January to December.
    financialYearStartMonth: { type: Number, default: 1, min: 1, max: 12 },

    /* ----------------------------------------------------------- NSSF -- */
    nssf: {
      enabled: { type: Boolean, default: true },
      employeeRate: { type: Number, default: DEFAULT_STATUTORY.nssf.employeeRate },
      employerRate: { type: Number, default: DEFAULT_STATUTORY.nssf.employerRate },
      // The employer's registration with the fund, quoted on the return.
      registrationNumber: { type: String, trim: true, default: null },
    },

    /* ----------------------------------------------------------- NHIF -- */
    nhif: {
      enabled: { type: Boolean, default: true },
      // Flat monthly amounts by salary band; `upTo: null` is the top band.
      slabs: { type: [slabSchema], default: () => DEFAULT_STATUTORY.nhif.slabs },
      registrationNumber: { type: String, trim: true, default: null },
    },

    /* ------------------------------------------------------------ SDL -- */
    // Employer only. There is no employee rate to configure, and adding one
    // would invite somebody to deduct it.
    sdl: {
      enabled: { type: Boolean, default: true },
      rate: { type: Number, default: DEFAULT_STATUTORY.sdl.rate },
    },

    /* ------------------------------------------------------------ WCF -- */
    wcf: {
      enabled: { type: Boolean, default: true },
      rate: { type: Number, default: DEFAULT_STATUTORY.wcf.rate },
    },

    /* ----------------------------------------------------------- PAYE -- */
    paye: {
      enabled: { type: Boolean, default: true },
      // Monthly slabs, assessed month by month. No annual projection.
      slabs: { type: [slabSchema], default: () => DEFAULT_STATUTORY.paye.slabs },
      // The employer's TRA Taxpayer Identification Number.
      tinNumber: { type: String, trim: true, uppercase: true, default: null },
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
      swiftCode: { type: String, trim: true, uppercase: true, default: null },
      debitNarration: { type: String, trim: true, default: 'SALARY' },
    },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

export default model('PayrollSettings', payrollSettingsSchema);
