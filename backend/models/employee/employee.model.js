import mongoose from 'mongoose';
import {
  GENDER,
  BLOOD_GROUPS,
  MARITAL_STATUS,
  EMPLOYMENT_TYPE,
  EMPLOYEE_CATEGORY,
  EMPLOYEE_STATUS,
  ACTIVE_EMPLOYEE_STATUSES,
  OVERTIME_CALCULATION_METHOD,
  OVERTIME_MULTIPLIERS,
  PREMIUM_MULTIPLIERS,
  DOCUMENT_TYPES,
  BANK_ACCOUNT_TYPES,
  PAY_FREQUENCY,
} from '../../utils/constants.js';
// The hourly divisor is the payroll month's own length, never a fixed figure.
import { currentPeriod, hourlySalaryFor } from '../../helpers/overtimeRate.helper.js';

const { Schema, model } = mongoose;

const trimmed = (max) => ({ type: String, trim: true, maxlength: max, default: null });

/* -------------------------------------------------------------------------- */
/*                               Sub-documents                                */
/* -------------------------------------------------------------------------- */

const addressSchema = new Schema(
  {
    line1: trimmed(200),
    line2: trimmed(200),
    city: trimmed(80),
    state: trimmed(80),
    country: { type: String, trim: true, maxlength: 80, default: 'India' },
    postalCode: { type: String, trim: true, maxlength: 12, default: null },
    landmark: trimmed(120),
  },
  { _id: false },
);

const bankDetailsSchema = new Schema(
  {
    accountHolderName: trimmed(120),
    accountNumber: trimmed(30),
    bankName: trimmed(120),
    branch: trimmed(120),
    ifsc: { type: String, trim: true, uppercase: true, maxlength: 11, default: null },
    accountType: { type: String, enum: [...Object.values(BANK_ACCOUNT_TYPES), null], default: null },
  },
  { _id: false },
);

const emergencyContactSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    relationship: { type: String, required: true, trim: true, maxlength: 60 },
    phone: { type: String, required: true, trim: true, maxlength: 20 },
    alternatePhone: trimmed(20),
    address: trimmed(250),
    isPrimary: { type: Boolean, default: false },
  },
  { _id: true },
);

const documentSchema = new Schema(
  {
    type: { type: String, enum: Object.values(DOCUMENT_TYPES), required: true },
    title: { type: String, required: true, trim: true, maxlength: 150 },
    fileName: { type: String, required: true },
    filePath: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    // Drives the expiring-documents report: passports, visas and licences all
    // lapse, and an HRMS that cannot warn about it is not doing its job.
    expiresAt: { type: Date, default: null },
    isVerified: { type: Boolean, default: false },
    verifiedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    verifiedAt: { type: Date, default: null },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

const statutorySchema = new Schema(
  {
    pfApplicable: { type: Boolean, default: false },
    pfNumber: { type: String, trim: true, uppercase: true, maxlength: 30, default: null },
    esiApplicable: { type: Boolean, default: false },
    esiNumber: { type: String, trim: true, maxlength: 20, default: null },
    // Universal Account Number - 12 digits, portable across employers.
    uan: { type: String, trim: true, maxlength: 12, default: null },
    pan: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 10,
      default: null,
      match: [/^[A-Z]{5}\d{4}[A-Z]$/, 'Invalid PAN format'],
    },
    aadhaar: { type: String, trim: true, maxlength: 12, default: null },
    passportNumber: { type: String, trim: true, uppercase: true, maxlength: 20, default: null },
    passportExpiry: { type: Date, default: null },
    drivingLicense: { type: String, trim: true, uppercase: true, maxlength: 25, default: null },
    drivingLicenseExpiry: { type: Date, default: null },

    /**
     * Labour Welfare Fund and Professional Tax applicability.
     *
     * Both are state levies with their own eligibility rules, so they are
     * per-employee switches rather than a company-wide setting -- a contractor
     * and a workman at the same site are not treated alike.
     */
    lwfApplicable: { type: Boolean, default: false },
    professionalTaxApplicable: { type: Boolean, default: true },
  },
  { _id: false },
);

const money = () => ({ type: Number, min: 0, default: 0 });

const salaryStructureSchema = new Schema(
  {
    // Cost to company, the annual figure the offer was made on.
    ctc: { type: Number, min: 0, default: null },
    grade: trimmed(20),
    band: trimmed(20),
    payFrequency: { type: String, enum: Object.values(PAY_FREQUENCY), default: PAY_FREQUENCY.MONTHLY },
    effectiveFrom: { type: Date, default: null },
    // Set once the Payroll module owns the component breakdown; the summary
    // above stays denormalised here so the employee master is self-contained.
    structureId: { type: Schema.Types.ObjectId, ref: 'SalaryStructure', default: null },

    /* ------------------------------------------ monthly components ----- */
    // Added alongside the existing fields rather than replacing them, so
    // records created before this extension remain valid and readable.
    basic: money(),
    hra: money(),
    conveyanceAllowance: money(),
    specialAllowance: money(),
    medicalAllowance: money(),
    otherAllowance: money(),

    /* ------------------------------------------------- contributions --- */
    pfEmployee: money(),
    pfEmployer: money(),
    esiEmployee: money(),
    esiEmployer: money(),
    lwfEmployee: money(),
    lwfEmployer: money(),
    professionalTax: money(),

    /**
     * Derived totals, recomputed server-side on every save.
     *
     * Stored rather than calculated on read so a payslip, a report and the
     * screen all quote the same number, and so the figure the approver saw is
     * the figure that was saved.
     */
    grossSalary: money(),
    totalDeductions: money(),
    netSalary: money(),
  },
  { _id: false },
);

/**
 * Per-employee overtime rules.
 *
 * Held on the employee rather than only on a company policy because
 * entitlement is individual: a workman and an executive on the same site are
 * treated differently, and a part-timer's hourly base is not the company's.
 *
 * Attendance reads the caps to bound what it records; payroll reads the rate to
 * price it. Both consume the derived fields, so the rule lives in one place.
 */
const overtimeSchema = new Schema(
  {
    // Mirrors the top-level `overtimeEligible` flag, which predates this
    // section and is kept so existing readers do not break. The pre-validate
    // hook keeps the two in step.
    eligible: { type: Boolean, default: false },

    calculationMethod: {
      type: String,
      enum: Object.values(OVERTIME_CALCULATION_METHOD),
      default: OVERTIME_CALCULATION_METHOD.SALARY_BASED,
    },

    /** Used only when calculationMethod is FIXED_HOURLY_RATE. */
    fixedHourlyRate: { type: Number, min: 0, default: null },

    /**
     * Overrides the company figure for someone who does not work a standard
     * month -- a part-timer's hourly rate must divide by their own hours, not
     * everyone else's.
     */
    workingHoursPerMonth: { type: Number, min: 1, max: 744, default: null },

    multiplier: { type: String, enum: OVERTIME_MULTIPLIERS, default: '1.5' },
    customMultiplier: { type: Number, min: 1, max: 10, default: null },

    /* --------------------------------------------------------- limits -- */
    // Statutory caps in most jurisdictions. Zero means "no cap configured",
    // which is why they default to null rather than 0.
    maxDailyOT: { type: Number, min: 0, max: 24, default: null },
    maxMonthlyOT: { type: Number, min: 0, max: 400, default: null },

    /* ------------------------------------------------------- premiums -- */
    weeklyHolidayMultiplier: { type: String, enum: PREMIUM_MULTIPLIERS, default: '2' },
    weeklyHolidayCustomMultiplier: { type: Number, min: 1, max: 10, default: null },

    publicHolidayMultiplier: { type: String, enum: PREMIUM_MULTIPLIERS, default: '2' },
    publicHolidayCustomMultiplier: { type: Number, min: 1, max: 10, default: null },

    nightShiftMultiplier: { type: String, enum: PREMIUM_MULTIPLIERS, default: '1.5' },
    nightShiftCustomMultiplier: { type: Number, min: 1, max: 10, default: null },

    /* -------------------------------------------------------- derived -- */
    // Recomputed server-side on every save, exactly like the salary totals, so
    // the stored rate always agrees with the inputs it came from.
    hourlySalary: { type: Number, min: 0, default: 0 },
    overtimeRate: { type: Number, min: 0, default: 0 },
    effectiveMultiplier: { type: Number, min: 0, default: 0 },
  },
  { _id: false },
);

/**
 * Exit details. Kept in one sub-document rather than as loose top-level fields
 * so a lifecycle change writes atomically and an exit can be cleared in one
 * operation if it was recorded in error.
 */
const lifecycleSchema = new Schema(
  {
    noticeStartDate: { type: Date, default: null },
    noticePeriodDays: { type: Number, min: 0, max: 365, default: null },
    resignationDate: { type: Date, default: null },
    lastWorkingDate: { type: Date, default: null },
    exitReason: { type: String, trim: true, maxlength: 500, default: null },
    terminationDate: { type: Date, default: null },
    retirementDate: { type: Date, default: null },
    exitInterviewDone: { type: Boolean, default: false },
    // Set at exit; the single most useful field when the same CV arrives again.
    rehireEligible: { type: Boolean, default: true },
  },
  { _id: false },
);

/* -------------------------------------------------------------------------- */
/*                                  Employee                                  */
/* -------------------------------------------------------------------------- */

const employeeSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null, index: true },

    /** System-generated, sequential per tenant. Never reused, never edited. */
    employeeCode: { type: String, required: true, trim: true, uppercase: true, maxlength: 20 },

    /**
     * The organisation's own identifier -- a legacy payroll number, a badge id.
     * Separate from `employeeCode` because customers migrating from another
     * system need to keep their existing numbering alongside ours.
     */
    employeeId: { type: String, trim: true, maxlength: 30, default: null },

    /** Link to the login account. Null for staff without system access. */
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },

    /* --------------------------------------------------------- personal -- */
    firstName: { type: String, required: [true, 'First name is required'], trim: true, maxlength: 60 },
    middleName: trimmed(60),
    /**
     * Optional: a mononym is a real name, not a missing one.
     *
     * Defaults to an empty string rather than being left unset, because a
     * number of payload builders compose `${firstName} ${lastName}` without
     * guarding the halves. An absent field renders "Ravi undefined" on those
     * screens and a null renders "Ravi null"; an empty string renders the name
     * itself, and the `filter(Boolean)` paths already drop it.
     */
    lastName: { type: String, trim: true, maxlength: 60, default: '' },
    fatherName: trimmed(120),
    motherName: trimmed(120),

    gender: { type: String, enum: Object.values(GENDER), default: GENDER.UNDISCLOSED },
    dateOfBirth: { type: Date, default: null },
    bloodGroup: { type: String, enum: [...BLOOD_GROUPS, null], default: null },
    maritalStatus: {
      type: String,
      enum: [...Object.values(MARITAL_STATUS), null],
      default: null,
    },

    personalEmail: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 255,
      default: null,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, 'Invalid email address'],
    },
    mobile: { type: String, trim: true, maxlength: 20, default: null },
    alternateMobile: trimmed(20),

    /* ------------------------------------------------------- employment -- */
    workEmail: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 255,
      default: null,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, 'Invalid email address'],
    },
    joiningDate: { type: Date, required: [true, 'Joining date is required'], index: true },
    confirmationDate: { type: Date, default: null },
    probationMonths: { type: Number, min: 0, max: 24, default: null },

    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', default: null, index: true },
    designationId: { type: Schema.Types.ObjectId, ref: 'Designation', default: null, index: true },
    shiftId: { type: Schema.Types.ObjectId, ref: 'Shift', default: null },
    reportingManagerId: { type: Schema.Types.ObjectId, ref: 'Employee', default: null, index: true },

    /** Site the employee belongs to. Drives statutory registration and location. */
    unitId: { type: Schema.Types.ObjectId, ref: 'Unit', default: null, index: true },
    /** Pay grade. Coexists with the free-text `salaryStructure.grade`. */
    gradeId: { type: Schema.Types.ObjectId, ref: 'Grade', default: null },
    /** Template the salary components were prefilled from, for traceability. */
    salaryTemplateId: { type: Schema.Types.ObjectId, ref: 'SalaryTemplate', default: null },

    employmentType: {
      type: String,
      enum: Object.values(EMPLOYMENT_TYPE),
      default: EMPLOYMENT_TYPE.FULL_TIME,
      index: true,
    },
    /** Workforce class. Statutory treatment differs from employment type. */
    employeeCategory: {
      type: String,
      enum: [...Object.values(EMPLOYEE_CATEGORY), null],
      default: null,
      index: true,
    },
    // Held here as well as on the payroll structure: eligibility is a property
    // of the person's terms, and attendance reads it without a payroll lookup.
    overtimeEligible: { type: Boolean, default: false },
    /**
     * The employee's own full working day, in minutes. Defaults to 08:30.
     *
     * Attendance subtracts this from the hours actually worked to get overtime,
     * so it is the one figure that decides an individual's overtime -- not a
     * shift, not a policy. It is held per employee because a workman on eight
     * hours and an executive on nine are both correct at the same site, and
     * neither should have to be modelled as a separate roster to say so.
     *
     * Minutes rather than a "HH:MM" string so that arithmetic never has to
     * parse, and so a half-hour duty day cannot be lost to rounding.
     */
    standardDutyMinutes: { type: Number, min: 0, max: 1440, default: 510 },
    /** Full overtime rule set. See overtimeSchema. */
    overtime: { type: overtimeSchema, default: () => ({}) },
    workLocation: trimmed(120),

    salaryStructure: { type: salaryStructureSchema, default: () => ({}) },
    statutory: { type: statutorySchema, default: () => ({}) },
    bankDetails: { type: bankDetailsSchema, default: () => ({}) },

    emergencyContacts: { type: [emergencyContactSchema], default: [] },

    currentAddress: { type: addressSchema, default: () => ({}) },
    permanentAddress: { type: addressSchema, default: () => ({}) },
    sameAsCurrentAddress: { type: Boolean, default: false },

    documents: { type: [documentSchema], default: [] },
    photo: {
      type: new Schema(
        {
          fileName: String,
          filePath: String,
          mimeType: String,
          size: Number,
          uploadedAt: { type: Date, default: Date.now },
        },
        { _id: false },
      ),
      default: null,
    },

    /* -------------------------------------------------------- lifecycle -- */
    status: {
      type: String,
      enum: Object.values(EMPLOYEE_STATUS),
      default: EMPLOYEE_STATUS.PROBATION,
      index: true,
    },
    lifecycle: { type: lifecycleSchema, default: () => ({}) },

    /* ----------------------------------------------------- soft delete -- */
    /**
     * Soft delete, not a boolean flag. An employee record is referenced by
     * payroll, attendance and statutory filings for years after they leave --
     * a hard delete would orphan all of it and break legal retention.
     */
    deletedAt: { type: Date, default: null, index: true },
    deletedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    deleteReason: { type: String, trim: true, maxlength: 500, default: null },

    /* ------------------------------------------------------ additional -- */
    // `remarks` is the HR-facing note that appears on the profile; `notes` is
    // longer-form internal commentary. Kept separate because they have
    // different audiences and the first is quoted in exports.
    remarks: { type: String, trim: true, maxlength: 1000, default: null },
    notes: { type: String, trim: true, maxlength: 4000, default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

/* ------------------------------------------------------ derived totals -- */

const round = (value) => Math.round((Number(value) || 0) * 100) / 100;

/**
 * Recomputes gross, total deductions and net from the components.
 *
 * Server-side and unconditional: the client shows the same arithmetic live for
 * feedback, but a total arriving in a request body is attacker-supplied.
 * Deriving it here means the stored figure always matches its own components,
 * whatever was posted.
 */
/**
 * Coerces a component to a usable number.
 *
 * Every input on the salary screen is a text field, so a component can arrive
 * as `''`, `null`, `'12,000'` or `undefined`. `Number('')` is 0 but
 * `Number(undefined)` is NaN, and one NaN anywhere turns every total into NaN
 * -- which is how a payslip ends up reading "NaN" instead of a figure.
 */
const component = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Recomputes every salary total from the components.
 *
 * The formulas follow the company's stated payroll policy:
 *
 *   Monthly CTC      = basic + HRA + conveyance + medical + other + special
 *   Employer contrib = PF(er) + ESI(er) + LWF(er)
 *   Gross            = Monthly CTC − employer contributions
 *   Employee ded.    = PF(ee) + ESI(ee) + LWF(ee) + professional tax
 *   Net              = Gross − employee deductions
 *   Annual CTC       = Monthly CTC × 12
 *   Total amount     = Net + bonus
 *
 * The six earning components sum to the COST TO COMPANY, not to gross. The
 * employer's own PF, ESI and LWF are already inside that figure, so they are
 * removed before gross is stated -- an employer contribution is a cost the
 * company carries, never something the employee earns, and reporting it as
 * part of gross overstates earnings on every payslip, Form 16 and loan letter
 * the figure reaches.
 *
 * Take-home does not move: the previous formulas reached the same net by
 * subtracting the employer contribution from a gross that had it included.
 * What changes is where the subtraction happens, and therefore what "gross"
 * and "monthly CTC" mean -- which is the part that was wrong.
 *
 * Bonus is deliberately outside gross and outside CTC: it is a separate
 * payable, added only at the final total.
 *
 * Only `grossSalary`, `totalDeductions` and `netSalary` exist on the schema and
 * are persisted. The rest are returned for display and are recomputed wherever
 * they are needed, so no collection or field had to change.
 */
export const deriveSalaryTotals = (salary = {}) => {
  const monthlyCtc = round(
    component(salary.basic) +
      component(salary.hra) +
      component(salary.conveyanceAllowance) +
      component(salary.medicalAllowance) +
      component(salary.otherAllowance) +
      component(salary.specialAllowance),
  );

  const employerContribution = round(
    component(salary.pfEmployer) + component(salary.esiEmployer) + component(salary.lwfEmployer),
  );

  const totalDeductions = round(
    component(salary.pfEmployee) +
      component(salary.esiEmployee) +
      component(salary.lwfEmployee) +
      component(salary.professionalTax),
  );

  // Floored at zero throughout: contributions or deductions that exceed the
  // cost to company are a data-entry error, and a negative salary is not a
  // meaningful figure to store or show.
  const grossSalary = Math.max(0, round(monthlyCtc - employerContribution));
  const netSalary = Math.max(0, round(grossSalary - totalDeductions));

  const bonus = Math.max(0, round(component(salary.bonus)));

  return {
    // Persisted.
    grossSalary,
    totalDeductions,
    netSalary,

    // Derived for display. Not on the schema, so Mongoose drops them on save.
    employerContribution,
    monthlyCtc,
    annualCtc: round(monthlyCtc * 12),
    bonus,
    totalAmount: Math.max(0, round(netSalary + bonus)),
  };
};

/**
 * Resolves a multiplier selection to a number.
 *
 * `CUSTOM` without a value falls back to 1 rather than 0 -- paying nothing for
 * overtime worked is a worse failure than paying the plain rate, and the gap
 * is visible on the payslip either way.
 */
export const resolveMultiplier = (selection, customValue, fallback = 1) => {
  if (selection === 'CUSTOM') return Number(customValue) > 0 ? Number(customValue) : fallback;
  const parsed = Number(selection);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * Derives the hourly salary and overtime rate from the configuration.
 *
 * The divisor is the payroll month's own length -- its days times an
 * eight-hour day -- so August (248 hours) and February (224) price differently,
 * as they should. It replaced a flat 240.
 *
 * That makes the rate a function of a MONTH, which a single stored field
 * cannot express. The value written to the employee record is therefore the
 * figure for the period passed in, and callers that care about a specific
 * month must say so: the payroll run passes the month it is paying, and the
 * Employee Master passes the current one so the screen shows something true
 * today. Payroll never relies on the stored figure.
 *
 * @param overtime     the employee's overtime sub-document
 * @param grossSalary  monthly gross, for the salary-based method
 * @param period       { year, month, companyMultiplier }; defaults to this month
 */
export const deriveOvertimeRate = (overtime = {}, grossSalary = 0, period = {}) => {
  if (!overtime.eligible) {
    // An ineligible employee carries no rate at all, so nothing downstream can
    // accidentally price their hours.
    return { hourlySalary: 0, overtimeRate: 0, effectiveMultiplier: 0 };
  }

  const { year, month } = period.year && period.month ? period : currentPeriod();
  const companyMultiplier = period.companyMultiplier ?? 2;

  const effectiveMultiplier =
    overtime.calculationMethod === OVERTIME_CALCULATION_METHOD.COMPANY_POLICY
      ? Number(companyMultiplier) || 2
      : resolveMultiplier(overtime.multiplier, overtime.customMultiplier);

  // A fixed rate is the hourly figure itself and ignores gross entirely; that
  // is the whole point of choosing it -- and it is the one method a month
  // length cannot affect.
  const hourlySalary =
    overtime.calculationMethod === OVERTIME_CALCULATION_METHOD.FIXED_HOURLY_RATE
      ? round(Number(overtime.fixedHourlyRate) || 0)
      : hourlySalaryFor({ grossSalary, year, month, overtime }).hourlySalary;

  return {
    hourlySalary: round(hourlySalary),
    effectiveMultiplier,
    overtimeRate: round(hourlySalary * effectiveMultiplier),
  };
};

employeeSchema.pre('validate', function computeDerivedFigures(next) {
  if (this.salaryStructure) {
    Object.assign(this.salaryStructure, deriveSalaryTotals(this.salaryStructure));
  }

  if (this.overtime) {
    // The section's own toggle is authoritative; the pre-existing top-level
    // flag is kept in step so older readers stay correct.
    if (this.isModified('overtimeEligible') && !this.isModified('overtime.eligible')) {
      this.overtime.eligible = this.overtimeEligible;
    } else {
      this.overtimeEligible = this.overtime.eligible;
    }

    Object.assign(
      this.overtime,
      deriveOvertimeRate(this.overtime, this.salaryStructure?.grossSalary ?? 0),
    );
  }

  next();
});

/* -------------------------------------------------------------- indexes -- */

// Partial unique indexes: uniqueness must not be blocked by soft-deleted rows,
// otherwise a code could never be freed and a deleted employee would forever
// reserve their identifiers.
employeeSchema.index(
  { tenantId: 1, employeeCode: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } },
);
employeeSchema.index(
  { tenantId: 1, employeeId: 1 },
  { unique: true, partialFilterExpression: { employeeId: { $type: 'string' }, deletedAt: null } },
);
employeeSchema.index(
  { tenantId: 1, workEmail: 1 },
  { unique: true, partialFilterExpression: { workEmail: { $type: 'string' }, deletedAt: null } },
);

// Listing and filtering: the list screen always filters by tenant and
// excludes deleted rows, so both lead every compound index.
employeeSchema.index({ tenantId: 1, deletedAt: 1, status: 1 });
employeeSchema.index({ tenantId: 1, deletedAt: 1, departmentId: 1 });
employeeSchema.index({ tenantId: 1, deletedAt: 1, reportingManagerId: 1 });
employeeSchema.index({ tenantId: 1, deletedAt: 1, joiningDate: -1 });
employeeSchema.index({ tenantId: 1, deletedAt: 1, lastName: 1, firstName: 1 });

/* ------------------------------------------------------------- virtuals -- */

employeeSchema.virtual('fullName').get(function fullName() {
  return [this.firstName, this.middleName, this.lastName].filter(Boolean).join(' ');
});

employeeSchema.virtual('isEmployed').get(function isEmployed() {
  return ACTIVE_EMPLOYEE_STATUSES.includes(this.status);
});

employeeSchema.virtual('isDeleted').get(function isDeleted() {
  return this.deletedAt !== null;
});

/** Whole years of service, measured to the exit date once they have left. */
employeeSchema.virtual('tenureYears').get(function tenureYears() {
  if (!this.joiningDate) return null;
  const end = this.lifecycle?.lastWorkingDate ?? new Date();
  return Math.max(0, Math.floor((end - this.joiningDate) / 31_557_600_000));
});

export default model('Employee', employeeSchema);
