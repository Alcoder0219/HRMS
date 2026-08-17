import { TAX_REGIME } from '../utils/constants.js';

/**
 * Statutory computation: PF, ESI, professional tax and TDS.
 *
 * Pure functions over an explicit settings object. Every rate, ceiling and slab
 * is passed in rather than hard-coded, because they are set by legislation that
 * changes on its own schedule -- an HRMS that needs a code release to follow a
 * budget announcement is broken by design.
 *
 * The defaults below reflect Indian rules as commonly configured; they are
 * starting values for a tenant to override, not authority.
 */

/** Rupee rounding. Statutory returns and bank files do not carry paise. */
export const roundCurrency = (value) => Math.round((Number(value) || 0) * 100) / 100;
export const roundToRupee = (value) => Math.round(Number(value) || 0);

export const DEFAULT_STATUTORY = {
  pf: {
    enabled: true,
    employeeRate: 12,
    employerRate: 12,
    /**
     * Retained for stored settings and statutory returns, but no longer used
     * to split the employer's share: company policy is that the employer
     * contributes the same amount as the employee, undivided. See calculatePf.
     */
    pensionRate: 8.33,
    // Contribution is capped at this monthly wage unless the tenant opts out.
    // 12% of it is the monthly contribution cap: 12% of 15,000 = 1,800.
    wageCeiling: 15000,
    applyCeiling: true,
    // PF wages are Basic + DA, not gross.
    includeDaInWages: true,
  },
  esi: {
    enabled: true,
    employeeRate: 0.75,
    /**
     * Unused. ESI is an employee-only deduction here -- the company makes no
     * contribution -- so nothing multiplies by this. Kept so stored settings
     * and their validators still load unchanged.
     */
    employerRate: 3.25,
    // The employee's contribution cap follows from this and the employee rate:
    // 0.75% of 21,000, rounded up, is 158.
    grossCeiling: 21000,
  },
  lwf: {
    enabled: true,
    /**
     * Per cent of monthly gross, employee side. 0.20 means 0.20%, i.e. a
     * multiplier of 0.002 -- the same units as the PF and ESI rates beside it.
     *
     * Briefly 0.02 by mistake, which paid 3 rupees on a 13,935 gross instead
     * of 28. The units are the trap: this is a PERCENTAGE, so a rate written
     * as if it were already a multiplier is out by a factor of ten.
     */
    employeeRate: 0.20,
    // The employer contributes twice what the employee does.
    employerMultiplier: 2,

    /**
     * Monthly ceilings, one per side.
     *
     * The employer's is NOT twice the employee's, and cannot be derived from
     * it: 34 doubled is 68, but the employer stops at 64. Two independent
     * limits, so both are stated.
     */
    employeeCap: 34,
    employerCap: 64,
  },
  professionalTax: {
    enabled: true,
    // Monthly slabs on gross. `upTo: null` is the open-ended top slab.
    slabs: [
      { upTo: 7500, amount: 0 },
      { upTo: 10000, amount: 175 },
      { upTo: null, amount: 200 },
    ],
    // Several states levy a higher amount in one month of the year.
    februaryAmount: 300,
    annualCap: 2500,
  },
  incomeTax: {
    enabled: true,
    regime: TAX_REGIME.NEW,
    standardDeduction: 75000,
    // Annual slabs, new regime shape.
    slabs: [
      { upTo: 300000, rate: 0 },
      { upTo: 700000, rate: 5 },
      { upTo: 1000000, rate: 10 },
      { upTo: 1200000, rate: 15 },
      { upTo: 1500000, rate: 20 },
      { upTo: null, rate: 30 },
    ],
    // Rebate: tax falls to zero when taxable income is at or under the limit.
    rebateLimit: 700000,
    rebateAmount: 25000,
    cessRate: 4,
  },
};

/* -------------------------------------------------------------------------- */
/*                            Provident fund (PF)                             */
/* -------------------------------------------------------------------------- */

/**
 * The monthly contribution cap, in rupees.
 *
 * Expressed as a wage ceiling in the settings, because that is how the statute
 * words it, and read back here as the amount it implies: 12% of 15,000 is
 * 1,800. Capping the amount rather than the wage keeps the rule legible at the
 * call site and gives the same figure, while still following a tenant that
 * moves the ceiling.
 */
const monthlyPfCap = (config) =>
  roundToRupee(config.monthlyCap ?? ((Number(config.wageCeiling) || 0) * (Number(config.employeeRate) || 0)) / 100);

/**
 * Employee and employer PF. The one place either is calculated.
 *
 *   employee = MIN(PF wages x 12%, 1,800)
 *   employer = employee
 *
 * The base is the PF wage -- basic, plus DA where the tenant includes it --
 * and never gross, CTC or net. On a prorated month it is the basic actually
 * being paid, so PF follows the salary down rather than being scaled
 * separately from it.
 *
 * The employer contributes exactly what the employee does, as one undivided
 * amount. There is deliberately no EPS split here: company policy is that the
 * two sides match, and deriving the employer's share independently is what
 * lets it drift above the employee's. `pensionRate` remains in settings for
 * statutory reporting but takes no part in what is paid.
 *
 * The cap applies to the FINAL employee amount, so a basic of 27,000 gives
 * 1,800 on both sides rather than 3,240 on either.
 */
export const calculatePf = ({ basic, da = 0, settings, employeeApplicable = true }) => {
  const config = settings?.pf ?? DEFAULT_STATUTORY.pf;

  if (!config.enabled || !employeeApplicable) {
    return { employee: 0, employer: 0, pension: 0, wages: 0, applicable: false };
  }

  const wages = Math.max(0, Number(basic || 0) + (config.includeDaInWages ? Number(da || 0) : 0));
  const contribution = roundToRupee((wages * (Number(config.employeeRate) || 0)) / 100);
  const employee = config.applyCeiling ? Math.min(contribution, monthlyPfCap(config)) : contribution;

  return {
    employee,
    // Never computed from a rate of its own -- it IS the employee's figure.
    employer: employee,
    pension: 0,
    employerTotal: employee,
    wages,
    applicable: true,
  };
};

/* -------------------------------------------------------------------------- */
/*                        Employee state insurance (ESI)                      */
/* -------------------------------------------------------------------------- */

/**
 * The employee's monthly ESI ceiling, in rupees.
 *
 * The gross ceiling and the employee rate already state it between them: 0.75%
 * of 21,000 is 157.50, which rounds to 158. Deriving it rather than writing
 * the constant keeps the cap correct if either setting moves.
 */
const employeeEsiCap = (config) =>
  roundToRupee(((Number(config.grossCeiling) || 0) * (Number(config.employeeRate) || 0)) / 100);

/**
 * The employee's ESI contribution. The one place it is calculated.
 *
 *   employee ESI = MIN(payable basic x 0.75%, 158)
 *
 * On BASIC, not gross: an employee on a 16,780 basic and a 20,500 gross
 * contributes on the basic. Whether they contribute at all is decided by the
 * Employee Master before this is ever called -- this function answers only
 * "how much", never "whether".
 *
 * The 158 is a CEILING, never a flat amount. Most employees are nowhere near
 * it: a payable basic of 2,706 contributes 20, and only a basic above 21,067
 * reaches the cap at all.
 *
 * Rounded to the nearest rupee, the same convention PF and LWF use: 20.295
 * becomes 20, 45.7275 becomes 46.
 */
export const calculateEmployeeEsi = ({ basic, settings }) => {
  const config = settings?.esi ?? DEFAULT_STATUTORY.esi;
  if (!config.enabled) return 0;

  const contribution = roundToRupee((Math.max(0, Number(basic) || 0) * (Number(config.employeeRate) || 0)) / 100);
  return Math.min(contribution, employeeEsiCap(config));
};

/**
 * ESI. An employee-only deduction in this HRMS.
 *
 * The company makes no ESI contribution, so the employer side is always zero
 * and is not derived from any rate. `esi.employerRate` survives in settings
 * only so stored configurations still load; nothing reads it.
 *
 * `forceApplicable` carries a decision made elsewhere: eligibility is normally
 * frozen for a contribution period once someone crosses the ceiling mid-period,
 * rather than re-derived from this month's gross alone.
 */
export const calculateEsi = ({ gross, basic, settings, employeeApplicable = true, forceApplicable = null }) => {
  const config = settings?.esi ?? DEFAULT_STATUTORY.esi;

  const withinCeiling = Number(gross || 0) <= config.grossCeiling;
  const applicable = config.enabled && employeeApplicable && (forceApplicable ?? withinCeiling);

  if (!applicable) return { employee: 0, employer: 0, applicable: false };

  return {
    employee: calculateEmployeeEsi({ basic, settings }),
    // Not a rate on anything. There is no employer ESI in this system.
    employer: 0,
    applicable: true,
  };
};

/* -------------------------------------------------------------------------- */
/*                        Labour welfare fund (LWF)                           */
/* -------------------------------------------------------------------------- */

/**
 * Labour welfare fund, both sides. The one place either is calculated.
 *
 *   employee = MIN(round(gross x 0.20%), 34)
 *   employer = MIN(employee x 2, 64)
 *
 * On GROSS, not basic -- the only statutory line here that is. And the
 * employer's share is taken from the employee's ROUNDED and CAPPED figure, so
 * the doubling holds on the amounts actually shown: 27.87 rounds to 28, and the
 * employer pays 56 rather than the 55.74 that doubling first would give.
 *
 * The two ceilings are separate limits, not one derived from the other. At the
 * employee's cap of 34 the doubling would give 68, but the employer's own cap
 * is 64 -- so above a gross of 17,000 the employee sits at 34 and the employer
 * at 64, and the 2x relationship no longer holds. That is the rule, not a
 * rounding artefact.
 *
 * Whether the employer contributes at all is decided before this is called,
 * from the Employee Master. This answers only "how much".
 */
export const calculateLwf = ({ gross, settings }) => {
  const config = settings?.lwf ?? DEFAULT_STATUTORY.lwf;
  if (!config.enabled) return { employee: 0, employer: 0, applicable: false };

  const contribution = roundToRupee((Math.max(0, Number(gross) || 0) * (Number(config.employeeRate) || 0)) / 100);
  const employee = Math.min(contribution, Number(config.employeeCap) || 0);

  return {
    employee,
    employer: Math.min(
      roundToRupee(employee * (Number(config.employerMultiplier) || 0)),
      Number(config.employerCap) || 0,
    ),
    applicable: true,
  };
};

/* -------------------------------------------------------------------------- */
/*                           Professional tax (PT)                            */
/* -------------------------------------------------------------------------- */

/** Slab lookup on monthly gross, with the higher February amount where set. */
export const calculateProfessionalTax = ({ gross, month, settings }) => {
  const config = settings?.professionalTax ?? DEFAULT_STATUTORY.professionalTax;
  if (!config.enabled) return 0;

  const amount = Number(gross || 0);
  const slab = config.slabs.find((entry) => entry.upTo === null || amount <= entry.upTo);
  if (!slab || slab.amount === 0) return 0;

  // February (month 2) carries the annual top-up in states that levy one.
  if (month === 2 && config.februaryAmount) return config.februaryAmount;

  return slab.amount;
};

/* -------------------------------------------------------------------------- */
/*                                    TDS                                     */
/* -------------------------------------------------------------------------- */

/** Progressive slab tax on an annual figure. */
export const calculateAnnualTax = (taxableIncome, settings) => {
  const config = settings?.incomeTax ?? DEFAULT_STATUTORY.incomeTax;
  if (!config.enabled) return { tax: 0, cess: 0, total: 0 };

  const income = Math.max(0, Number(taxableIncome) || 0);

  let tax = 0;
  let lowerBound = 0;

  for (const slab of config.slabs) {
    const upper = slab.upTo ?? Infinity;
    if (income <= lowerBound) break;

    const slice = Math.min(income, upper) - lowerBound;
    tax += (slice * slab.rate) / 100;
    lowerBound = upper;
  }

  // Rebate wipes the liability entirely below the threshold -- it is not a
  // deduction from income, so it is applied after the slabs.
  if (config.rebateLimit && income <= config.rebateLimit) {
    tax = Math.max(0, tax - config.rebateAmount);
  }

  const cess = (tax * (config.cessRate ?? 0)) / 100;

  return { tax: roundToRupee(tax), cess: roundToRupee(cess), total: roundToRupee(tax + cess) };
};

/**
 * Monthly TDS by annual projection.
 *
 * Projects the year's income from what has been paid so far plus what the
 * current month implies for the rest, computes the annual liability, subtracts
 * what has already been deducted, and spreads the balance over the months that
 * remain. That is how deductions stay even instead of spiking in March.
 *
 * This is a projection, not a filing. It does not model investment
 * declarations, house property, or other income -- those belong to a tax
 * module, and `manualOverride` exists so finance can carry the real figure.
 */
export const calculateMonthlyTds = ({
  monthlyTaxable,
  paidSoFar = 0,
  tdsPaidSoFar = 0,
  monthsRemaining = 12,
  settings,
  manualOverride = null,
}) => {
  const config = settings?.incomeTax ?? DEFAULT_STATUTORY.incomeTax;
  if (!config.enabled) return { monthly: 0, projectedAnnual: 0, annualTax: 0 };

  if (manualOverride !== null && manualOverride !== undefined) {
    return { monthly: roundToRupee(manualOverride), projectedAnnual: 0, annualTax: 0, overridden: true };
  }

  const remaining = Math.max(1, monthsRemaining);
  const projectedAnnual = Number(paidSoFar || 0) + Number(monthlyTaxable || 0) * remaining;
  const taxableAfterDeduction = Math.max(0, projectedAnnual - (config.standardDeduction ?? 0));

  const { total: annualTax } = calculateAnnualTax(taxableAfterDeduction, settings);
  const outstanding = Math.max(0, annualTax - Number(tdsPaidSoFar || 0));

  return {
    monthly: roundToRupee(outstanding / remaining),
    projectedAnnual: roundToRupee(projectedAnnual),
    taxableIncome: roundToRupee(taxableAfterDeduction),
    annualTax,
  };
};

export default {
  DEFAULT_STATUTORY,
  calculatePf,
  calculateEsi,
  calculateEmployeeEsi,
  calculateLwf,
  calculateProfessionalTax,
  calculateAnnualTax,
  calculateMonthlyTds,
  roundCurrency,
  roundToRupee,
};
