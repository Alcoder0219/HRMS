/**
 * Statutory computation: NSSF, NHIF, SDL, WCF and PAYE.
 *
 * Pure functions over an explicit settings object. Every rate, ceiling and slab
 * is passed in rather than hard-coded, because they are set by legislation that
 * changes on its own schedule -- an HRMS that needs a code release to follow a
 * Finance Act is broken by design.
 *
 * The defaults below reflect Tanzanian rules as commonly configured; they are
 * starting values for a tenant to override, not authority.
 *
 * Two of the five have no employee half at all. The Skills Development Levy and
 * the Workers Compensation Fund are levies ON THE EMPLOYER's payroll, so they
 * are a cost to the company and never appear as a deduction from anyone's pay.
 */

/** Shilling rounding. Statutory returns and bank files do not carry cents. */
export const roundCurrency = (value) => Math.round((Number(value) || 0) * 100) / 100;

/**
 * The whole-shilling rounding every statutory figure and payslip line uses.
 *
 * Named for the operation rather than for the currency: it was `roundToRupee`
 * while this was an Indian payroll, and a name that states the jurisdiction is
 * a name that has to be chased through forty files the next time the product
 * moves. `roundToTsh` is kept as an alias for readability at Tanzania-specific
 * call sites.
 */
export const roundToCurrency = (value) => Math.round(Number(value) || 0);
export const roundToTsh = roundToCurrency;

export const DEFAULT_STATUTORY = {
  /**
   * National Social Security Fund.
   *
   * Ten per cent from each side of GROSS, not of basic -- which is the single
   * most important difference from the provident fund this replaced. There is
   * no wage ceiling: the contribution scales all the way up.
   */
  nssf: {
    enabled: true,
    employeeRate: 10,
    employerRate: 10,
  },

  /**
   * National Health Insurance Fund.
   *
   * A flat monthly amount looked up by salary band, not a percentage. The
   * figures below are placeholders in the shape the fund publishes -- a tenant
   * is expected to replace them with the current schedule, which is why they
   * live in settings rather than in code.
   */
  nhif: {
    enabled: true,
    slabs: [
      { upTo: 150000, amount: 0 },
      { upTo: 250000, amount: 5000 },
      { upTo: 450000, amount: 10000 },
      { upTo: 600000, amount: 15000 },
      { upTo: 800000, amount: 20000 },
      { upTo: 1000000, amount: 25000 },
      { upTo: 1500000, amount: 30000 },
      { upTo: 2000000, amount: 40000 },
      { upTo: 3000000, amount: 50000 },
      // `upTo: null` is the open-ended top band.
      { upTo: null, amount: 60000 },
    ],
  },

  /** Skills Development Levy. Employer only, on gross. */
  sdl: {
    enabled: true,
    rate: 4.5,
  },

  /** Workers Compensation Fund. Employer only, on gross. */
  wcf: {
    enabled: true,
    rate: 1.0,
  },

  /**
   * Pay As You Earn.
   *
   * Progressive MONTHLY slabs, unlike the annual projection this replaced.
   * Tanzanian PAYE is assessed and remitted month by month, so there is no
   * year-end reconciliation to spread across the remaining months and no
   * projection to get wrong.
   */
  paye: {
    enabled: true,
    slabs: [
      { upTo: 270000, rate: 0 },
      { upTo: 520000, rate: 8 },
      { upTo: 760000, rate: 20 },
      { upTo: 1000000, rate: 25 },
      { upTo: null, rate: 30 },
    ],
  },
};

/* -------------------------------------------------------------------------- */
/*                  National Social Security Fund (NSSF)                      */
/* -------------------------------------------------------------------------- */

/**
 * NSSF, both sides. The one place either is calculated.
 *
 *   employee = gross x 10%
 *   employer = gross x 10%
 *
 * The base is GROSS -- every earning component together -- and never basic.
 * On a prorated month it is the gross actually being paid, so the contribution
 * follows the salary down without needing a proration rule of its own, and a
 * month with no pay yields nothing because the gross itself is nothing.
 *
 * The two rates are stated separately rather than one derived from the other:
 * they happen to be equal today, and a tenant that moves one must be able to
 * move it without silently moving the other.
 *
 * Whether the employee is enrolled at all is decided before this is called,
 * from the Employee Master. This answers only "how much".
 */
export const calculateNssf = ({ gross, settings, employeeApplicable = true }) => {
  const config = settings?.nssf ?? DEFAULT_STATUTORY.nssf;

  if (!config.enabled || !employeeApplicable) {
    return { employee: 0, employer: 0, wages: 0, applicable: false };
  }

  const wages = Math.max(0, Number(gross) || 0);

  return {
    employee: roundToCurrency((wages * (Number(config.employeeRate) || 0)) / 100),
    employer: roundToCurrency((wages * (Number(config.employerRate) || 0)) / 100),
    wages,
    applicable: true,
  };
};

/* -------------------------------------------------------------------------- */
/*                 National Health Insurance Fund (NHIF)                      */
/* -------------------------------------------------------------------------- */

/**
 * NHIF: a flat monthly amount for the band the salary falls in.
 *
 * A LOOKUP, not a rate. The first band matching the gross wins, and the band
 * with a null ceiling is the open-ended top. Because it is a flat monthly
 * charge rather than a rate per day, callers do not prorate it -- it is due in
 * full whenever any salary is paid at all, and zero when none is.
 */
export const calculateNhif = ({ gross, settings, employeeApplicable = true }) => {
  const config = settings?.nhif ?? DEFAULT_STATUTORY.nhif;
  if (!config.enabled || !employeeApplicable) return 0;

  const amount = Math.max(0, Number(gross) || 0);
  if (amount <= 0) return 0;

  const slabs = config.slabs?.length ? config.slabs : DEFAULT_STATUTORY.nhif.slabs;
  const band = slabs.find((entry) => entry.upTo === null || entry.upTo === undefined || amount <= entry.upTo);

  return roundToCurrency(band?.amount ?? 0);
};

/* -------------------------------------------------------------------------- */
/*                     Skills Development Levy (SDL)                          */
/* -------------------------------------------------------------------------- */

/**
 * SDL: 4.5% of gross, employer only.
 *
 * Returns a bare number rather than an { employee, employer } pair, because
 * there is no employee side to be confused about. Nothing may ever deduct this
 * from a salary.
 */
export const calculateSdl = ({ gross, settings }) => {
  const config = settings?.sdl ?? DEFAULT_STATUTORY.sdl;
  if (!config.enabled) return 0;

  return roundToCurrency((Math.max(0, Number(gross) || 0) * (Number(config.rate) || 0)) / 100);
};

/* -------------------------------------------------------------------------- */
/*                   Workers Compensation Fund (WCF)                          */
/* -------------------------------------------------------------------------- */

/** WCF: 1% of gross, employer only. Employee-side, like SDL, there is none. */
export const calculateWcf = ({ gross, settings }) => {
  const config = settings?.wcf ?? DEFAULT_STATUTORY.wcf;
  if (!config.enabled) return 0;

  return roundToCurrency((Math.max(0, Number(gross) || 0) * (Number(config.rate) || 0)) / 100);
};

/* -------------------------------------------------------------------------- */
/*                          Pay As You Earn (PAYE)                            */
/* -------------------------------------------------------------------------- */

/**
 * Progressive monthly income tax.
 *
 * Each band taxes only the SLICE of income that falls inside it, never the
 * whole amount. On 600,000 that is nothing on the first 270,000, 8% on the
 * next 250,000 and 20% on the remaining 80,000 -- not 20% of 600,000, which is
 * the classic and expensive way to get this wrong.
 *
 * The taxable base excludes the employee's own NSSF contribution, which is a
 * deductible expense; the caller subtracts it before calling.
 *
 * `manualOverride` carries a figure finance has determined outside this
 * calculation -- a TRA assessment, a directive -- and short-circuits the slabs
 * entirely rather than adjusting them.
 */
export const calculatePaye = ({ monthlyTaxable, settings, employeeApplicable = true, manualOverride = null }) => {
  const config = settings?.paye ?? DEFAULT_STATUTORY.paye;

  if (!config.enabled || !employeeApplicable) {
    return { monthly: 0, taxableIncome: 0, applicable: false };
  }

  if (manualOverride !== null && manualOverride !== undefined) {
    return {
      monthly: roundToCurrency(manualOverride),
      taxableIncome: roundToCurrency(Math.max(0, Number(monthlyTaxable) || 0)),
      applicable: true,
      overridden: true,
    };
  }

  const income = Math.max(0, Number(monthlyTaxable) || 0);
  const slabs = config.slabs?.length ? config.slabs : DEFAULT_STATUTORY.paye.slabs;

  let tax = 0;
  let lowerBound = 0;

  for (const slab of slabs) {
    const upper = slab.upTo ?? Infinity;
    if (income <= lowerBound) break;

    const slice = Math.min(income, upper) - lowerBound;
    tax += (slice * (Number(slab.rate) || 0)) / 100;
    lowerBound = upper;
  }

  return {
    monthly: roundToCurrency(tax),
    taxableIncome: roundToCurrency(income),
    applicable: true,
  };
};

export default {
  DEFAULT_STATUTORY,
  calculateNssf,
  calculateNhif,
  calculateSdl,
  calculateWcf,
  calculatePaye,
  roundCurrency,
  roundToCurrency,
  roundToTsh,
};
