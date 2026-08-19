import { COMPONENT_CODE, COMPONENT_TYPE } from '../utils/constants.js';
import {
  calculateNssf,
  calculateNhif,
  calculateSdl,
  calculateWcf,
  calculatePaye,
  DEFAULT_STATUTORY,
  roundToCurrency,
} from './statutory.helper.js';

/**
 * The salary calculation engine.
 *
 * Pure: everything it needs -- structure, attendance, loans, statutory config --
 * is passed in, and it touches no database and no clock. This decides what
 * people are paid, so it has to be testable against fixtures and reproducible
 * months later when someone queries a deduction.
 *
 * Order matters and is not arbitrary:
 *   1. prorate earnings for loss of pay
 *   2. add variable pay (overtime, bonus, incentive, arrears)
 *   3. gross
 *   4. statutory deductions, each on its own base
 *   5. recoveries (loans, advances)
 *   6. net
 *
 * Under Tanzanian rules NSSF, SDL and WCF are all rates on GROSS; NHIF is a
 * flat amount looked up by band; PAYE is a progressive monthly slab on gross
 * less the employee's own NSSF. Using one base for all of them, or annualising
 * PAYE, is how this goes wrong.
 */

const LABELS = {
  [COMPONENT_CODE.BASIC]: 'Basic Salary',
  [COMPONENT_CODE.HRA]: 'House Rent Allowance',
  [COMPONENT_CODE.FOOD_ALLOWANCE]: 'Food Allowance',
  [COMPONENT_CODE.TRANSPORTATION_ALLOWANCE]: 'Transportation Allowance',
  [COMPONENT_CODE.COMMUNICATION_ALLOWANCE]: 'Communication Allowance',
  [COMPONENT_CODE.MEDICLAIM]: 'Mediclaim',
  [COMPONENT_CODE.SCHOOL_FEES_ALLOWANCE]: 'School Fees Allowance',
  [COMPONENT_CODE.ANNUAL_LEAVE_ALLOWANCE]: 'Annual Leave Allowance',
  [COMPONENT_CODE.PERFORMANCE_INCENTIVE]: 'Performance Linked Incentive',
  [COMPONENT_CODE.OTHER_ALLOWANCE]: 'Other Allowance',
  [COMPONENT_CODE.OVERTIME]: 'Overtime',
  [COMPONENT_CODE.BONUS]: 'Bonus',
  [COMPONENT_CODE.INCENTIVE]: 'Incentive',
  [COMPONENT_CODE.ARREARS]: 'Arrears',
  [COMPONENT_CODE.NSSF_EMPLOYEE]: 'NSSF - Employee',
  [COMPONENT_CODE.NHIF]: 'NHIF',
  [COMPONENT_CODE.PAYE]: 'PAYE',
  [COMPONENT_CODE.LOAN_EMI]: 'Loan EMI',
  [COMPONENT_CODE.ADVANCE_RECOVERY]: 'Advance Recovery',
  [COMPONENT_CODE.OTHER_DEDUCTION]: 'Other Deduction',
  [COMPONENT_CODE.NSSF_EMPLOYER]: 'NSSF - Employer',
  [COMPONENT_CODE.SDL]: 'Skills Development Levy',
  [COMPONENT_CODE.WCF]: 'Workers Compensation Fund',
};

/**
 * The structure field each fixed earning code is read from.
 *
 * One list drives the component lines, the proration and the unprorated
 * comparison figure, so an allowance cannot be added to the model and then
 * silently omitted from a payslip.
 */
export const FIXED_EARNINGS = [
  { code: COMPONENT_CODE.BASIC, field: 'basic' },
  { code: COMPONENT_CODE.HRA, field: 'hraAllowance' },
  { code: COMPONENT_CODE.FOOD_ALLOWANCE, field: 'foodAllowance' },
  { code: COMPONENT_CODE.TRANSPORTATION_ALLOWANCE, field: 'transportationAllowance' },
  { code: COMPONENT_CODE.COMMUNICATION_ALLOWANCE, field: 'communicationAllowance' },
  { code: COMPONENT_CODE.MEDICLAIM, field: 'mediclaim' },
  { code: COMPONENT_CODE.SCHOOL_FEES_ALLOWANCE, field: 'schoolFeesAllowance' },
  { code: COMPONENT_CODE.ANNUAL_LEAVE_ALLOWANCE, field: 'annualLeaveAllowance' },
  { code: COMPONENT_CODE.PERFORMANCE_INCENTIVE, field: 'performanceIncentive' },
];

/**
 * The contractual monthly components, as against variable pay.
 *
 * These sum to the month's gross; overtime, bonus, incentive and arrears are
 * earned on top of it and are never part of the salary structure's own figures.
 * Separating them is what lets gross be taken from the Employee Master while
 * still adding whatever was actually earned this month.
 *
 * `OTHER_ALLOWANCE` is in the set because the structure's free-form allowance
 * list is contractual pay too -- it is a named allowance without a dedicated
 * column, not a one-off.
 */
const FIXED_EARNING_CODES = new Set([
  ...FIXED_EARNINGS.map((entry) => entry.code),
  COMPONENT_CODE.OTHER_ALLOWANCE,
]);

const line = (code, amount, extra = {}) => ({
  code,
  label: LABELS[code] ?? code,
  amount: roundToCurrency(amount),
  ...extra,
});

/**
 * THE gross salary calculation. Every caller uses this one.
 *
 *   gross = basic + every allowance on the structure
 *
 * Gross is an earnings figure and is nothing but the sum of what was earned.
 * Nothing is subtracted from it -- not the employee's deductions, and not the
 * employer's NSSF, SDL or WCF, which are a cost to the company rather than
 * something the employee earned and then lost.
 *
 * It sums the component lines themselves rather than scaling a stored total,
 * which is what keeps the register honest: the lines shown to the user ARE the
 * addends, so the column total can never disagree with the figure beside it.
 * Deriving the same number two ways is how the two drift apart -- one path
 * scaling a stored gross by the payable-day ratio while the other sums the
 * individually-scaled components, and the difference gets reported as an
 * unexplained shilling gap.
 *
 * Rounding therefore needs no reconciliation step. Each line is rounded once
 * when it is built, and this adds the rounded values, so the identity
 * `gross === sum(displayed components)` is exact by construction rather than
 * by correction.
 *
 * Variable pay -- overtime, bonus, incentive, arrears -- is deliberately not
 * included. It is earned on top of the structure and is reported in its own
 * columns; callers that want the full month's earnings add it themselves.
 *
 * @param {Array} earnings Component lines, variable pay included or not.
 * @returns {number} The fixed gross, rounded to the shilling.
 */
export const calculateGrossSalary = (earnings = []) =>
  roundToCurrency(
    (earnings ?? [])
      .filter((entry) => FIXED_EARNING_CODES.has(entry?.code))
      .reduce((sum, entry) => sum + (Number(entry?.amount) || 0), 0),
  );

/**
 * The share of the month's salary that has been earned.
 *
 *   factor = payable days / days in the month
 *
 * Payable days are counted from attendance and nowhere else:
 *
 *   present (incl. on duty and work from home)
 *   + weekly off + holiday + paid leave
 *   + half days x 0.5
 *
 * Absences and loss of pay simply are not in that total, so they reduce the
 * factor by omission rather than by a second subtraction.
 *
 * The consequence that matters is that an incomplete month pays an incomplete
 * salary. On the 7th of August only seven days have been attended, so seven
 * days are payable -- payroll must not assume the rest of the month will be
 * worked. It reaches a full month's pay only once the month's attendance is
 * complete, which is the point of running payroll after the period closes.
 *
 * A month with no attendance at all is therefore worth nothing, and that is
 * deliberate. It used to default to a full month, which meant an unprocessed
 * or half-imported month quietly paid in full; a zero is wrong in a way
 * somebody notices before the bank file is generated.
 */
export const lopFactor = ({ payableDays, totalDays }) => {
  const total = Number(totalDays) || 0;
  if (!total) return 1;

  const payable = Number(payableDays);
  if (!Number.isFinite(payable)) return 1;

  return Math.max(0, Math.min(1, payable / total));
};

/**
 * Hourly rate for overtime.
 *
 * Derived from Basic (not gross) over the month's standard hours, then
 * multiplied by the policy rate -- typically 2x. Basing it on gross would let
 * a reimbursement inflate an overtime rate.
 */
export const overtimeAmount = ({
  basic,
  totalDays,
  dailyHours = 8,
  minutes = 0,
  multiplier = 2,
  ratePerHour = null,
}) => {
  if (!minutes) return 0;

  /**
   * An explicit rate from the employee's overtime configuration wins.
   *
   * That figure already carries their method, multiplier and working hours, so
   * recomputing it here from basic would quietly contradict what the Employee
   * Master shows. The derivation below remains for records configured before
   * the overtime section existed.
   */
  if (ratePerHour > 0) return roundToCurrency((minutes / 60) * ratePerHour);

  if (!basic) return 0;

  const monthlyHours = (Number(totalDays) || 30) * dailyHours;
  if (!monthlyHours) return 0;

  const hourlyRate = Number(basic) / monthlyHours;
  return roundToCurrency((minutes / 60) * hourlyRate * multiplier);
};

/**
 * Calculates one payslip.
 *
 * @param {object} input
 * @param {object} input.structure   Basic plus the Tanzanian allowances, and `otherAllowances[]`
 * @param {object} input.attendance  { payableDays, totalDays, lopDays, overtimeMinutes }
 * @param {object} input.variable    { bonus, incentive, arrears, otherEarnings[], otherDeductions[] }
 * @param {Array}  input.loans       [{ loanId, emi, outstanding }]
 * @param {Array}  input.advances    [{ advanceId, recoveryAmount, outstanding }]
 * @param {object} input.statutory   Settings; falls back to DEFAULT_STATUTORY
 * @param {object} input.flags
 *   Statutory eligibility, from the Employee Master:
 *   { nssfApplicable, nhifApplicable, payeApplicable }. Each is enabled only by
 *   an explicit `true`.
 * @param {number} input.payeOverride A figure finance has determined outside the slabs
 * @param {object} input.salarySnapshot
 *   The employee's own salary structure, when one is on file. Present, it
 *   decides whether the company contributes at all -- see `employerContributes`.
 */
export const calculatePayslip = ({
  structure,
  attendance = {},
  variable = {},
  loans = [],
  advances = [],
  statutory = DEFAULT_STATUTORY,
  flags = {},
  overtimeMultiplier = 2,
  payeOverride = null,
  overtimeConfig = null,
  salarySnapshot = null,
}) => {
  const factor = lopFactor(attendance);
  const totalDays = Number(attendance.totalDays) || 30;

  /* ---------------------------------------------------- fixed earnings -- */
  const prorate = (value) => roundToCurrency((Number(value) || 0) * factor);

  const earnings = FIXED_EARNINGS.map(({ code, field }) => line(code, prorate(structure[field])));

  (structure.otherAllowances ?? []).forEach((allowance) => {
    earnings.push({
      code: allowance.code ?? COMPONENT_CODE.OTHER_ALLOWANCE,
      label: allowance.label ?? 'Other Allowance',
      // A fixed allowance is subject to loss of pay; a reimbursement is not,
      // and says so on the component.
      amount: allowance.prorate === false
        ? roundToCurrency(allowance.amount)
        : prorate(allowance.amount),
    });
  });

  /* --------------------------------------------------- variable pay ----- */
  /**
   * Overtime is paid only when the employee is eligible.
   *
   * Attendance records the hours either way; this is where entitlement is
   * applied. `overtimeConfig` is absent for records predating the overtime
   * section, and those keep the previous behaviour.
   */
  const overtimeEligible = overtimeConfig ? overtimeConfig.eligible !== false : true;

  const overtime = overtimeEligible
    ? overtimeAmount({
        basic: structure.basic,
        totalDays,
        minutes: attendance.overtimeMinutes ?? 0,
        multiplier: overtimeMultiplier,
        ratePerHour: overtimeConfig?.overtimeRate ?? null,
      })
    : 0;

  // Variable pay is never prorated: a bonus is an award for a period, not a
  // rate per day, and arrears are already the exact amount owed.
  if (overtime > 0) {
    earnings.push(
      line(COMPONENT_CODE.OVERTIME, overtime, {
        hours: Number(((attendance.overtimeMinutes ?? 0) / 60).toFixed(2)),
      }),
    );
  }
  if (variable.bonus > 0) earnings.push(line(COMPONENT_CODE.BONUS, variable.bonus));
  if (variable.incentive > 0) earnings.push(line(COMPONENT_CODE.INCENTIVE, variable.incentive));
  if (variable.arrears > 0) earnings.push(line(COMPONENT_CODE.ARREARS, variable.arrears));

  (variable.otherEarnings ?? []).forEach((entry) => {
    if (entry.amount > 0) {
      earnings.push({
        // Deliberately not OTHER_ALLOWANCE by default: a one-off payment is not
        // contractual pay, and defaulting it into the fixed set would pull it
        // into gross and therefore into every statutory base.
        code: entry.code ?? COMPONENT_CODE.INCENTIVE,
        label: entry.label ?? 'Other Earning',
        amount: roundToCurrency(entry.amount),
      });
    }
  });

  // The contractual earnings, through the one gross formula. Held apart from
  // variable pay so each can be reported for what it is.
  const fixedTotal = calculateGrossSalary(earnings);

  const variableTotal = roundToCurrency(
    earnings
      .filter((entry) => !FIXED_EARNING_CODES.has(entry.code))
      .reduce((sum, entry) => sum + entry.amount, 0),
  );

  /**
   * Gross is the sum of the earned components, plus whatever variable pay was
   * earned on top.
   *
   * It is deliberately NOT `snapshot.grossSalary * factor`. That would be a
   * second, independent derivation of the same quantity, and on any prorated
   * month the two disagree: scaling a stored gross rounds once at the end,
   * while the component lines are each rounded as they are built.
   *
   * The employer's NSSF, SDL and WCF are not deducted here. They are the
   * company's cost, reported on the employer side and added back for CTC; the
   * employee earned the components, so the components are the gross.
   */
  const fixedGross = fixedTotal;
  const gross = roundToCurrency(fixedGross + variableTotal);

  const snapshot = salarySnapshot ?? null;

  /**
   * Statutory eligibility is opt-in, and strictly so.
   *
   * Only an explicit `true` enables a deduction. Absent, null and false all
   * mean no, because the caller is stating who this person IS enrolled in, and
   * a missing answer is not consent to deduct from somebody's salary.
   */
  const eligible = (flag) => flag === true;

  /**
   * Whether the company contributes at all, per employee.
   *
   * The employee's own deductions are rates on a wage, but an employer
   * contribution is something the company has agreed to make for that person,
   * and the Employee Master records it as an amount. A zero or absent amount
   * there means no contribution -- so the AMOUNT is read as a switch, while the
   * rate that computes it is left alone.
   *
   * `Number(x) || 0` collapses 0, "0", "", null, undefined and any unparseable
   * value to zero, so none of them can enable a contribution and none can
   * produce NaN. With no snapshot on file at all the contribution applies, as
   * it must for a payroll-only structure.
   */
  const employerContributes = (configured) => !snapshot || (Number(configured) || 0) > 0;

  /**
   * NSSF, on the month's GROSS -- both sides, calculated rather than copied.
   *
   * `gross` here is already prorated and already includes whatever variable
   * pay was earned, so the contribution follows the salary in both directions
   * without needing a proration rule of its own. Copying a configured amount
   * from the structure and scaling it by the loss-of-pay factor would give a
   * different answer, and would carry whatever employer figure happened to be
   * stored -- which is how the two sides drift apart.
   */
  const calculatedNssf = calculateNssf({
    gross,
    settings: statutory,
    employeeApplicable: eligible(flags.nssfApplicable),
  });

  const nssf = {
    ...calculatedNssf,
    employer: employerContributes(snapshot?.nssfEmployer) ? calculatedNssf.employer : 0,
  };

  /**
   * NHIF: a flat monthly amount for the band the gross falls in.
   *
   * Not scaled by loss of pay -- it is a fixed monthly charge rather than a
   * rate per day, and is due in full whenever any salary is paid at all. A
   * month with no pay yields nothing because the band lookup on a zero gross
   * returns nothing.
   */
  const nhif = calculateNhif({
    gross,
    settings: statutory,
    employeeApplicable: eligible(flags.nhifApplicable),
  });

  /**
   * SDL and WCF: employer-only levies on the same gross.
   *
   * Neither has an employee half in any circumstance, so neither is ever
   * consulted when net pay is computed. They exist on the payslip only so the
   * cost of the person for the month is complete and the monthly returns can
   * be prepared from stored slips.
   */
  const sdl = employerContributes(snapshot?.sdl) ? calculateSdl({ gross, settings: statutory }) : 0;
  const wcf = employerContributes(snapshot?.wcf) ? calculateWcf({ gross, settings: statutory }) : 0;

  /**
   * PAYE, on gross less the employee's own NSSF.
   *
   * The employee's social security contribution is a deductible expense, so it
   * comes off before the slabs are applied. The employer's does not -- it was
   * never the employee's income.
   *
   * Monthly and final. There is no annual projection and no year-end catch-up:
   * Tanzanian PAYE is assessed on the month, so a projection would invent a
   * liability that the tax authority never assesses.
   */
  const monthlyTaxable = Math.max(0, roundToCurrency(gross - nssf.employee));

  const paye = calculatePaye({
    monthlyTaxable,
    settings: statutory,
    employeeApplicable: eligible(flags.payeApplicable),
    manualOverride: payeOverride,
  });

  /* ------------------------------------------------------ deductions ---- */
  const deductions = [];
  if (nssf.employee > 0) {
    deductions.push(line(COMPONENT_CODE.NSSF_EMPLOYEE, nssf.employee, { wages: nssf.wages }));
  }
  if (nhif > 0) deductions.push(line(COMPONENT_CODE.NHIF, nhif));
  if (paye.monthly > 0) deductions.push(line(COMPONENT_CODE.PAYE, paye.monthly, { taxable: monthlyTaxable }));

  /* ------------------------------------------------------ recoveries ---- */
  // Never recover more than is outstanding: the final instalment of a loan is
  // usually smaller than the EMI, and over-recovering creates a refund case.
  let loanTotal = 0;
  const loanBreakup = [];

  loans.forEach((loan) => {
    const due = Math.min(roundToCurrency(loan.emi), roundToCurrency(loan.outstanding ?? loan.emi));
    if (due > 0) {
      loanTotal += due;
      loanBreakup.push({ loanId: loan.loanId, amount: due, closing: roundToCurrency((loan.outstanding ?? 0) - due) });
    }
  });

  let advanceTotal = 0;
  const advanceBreakup = [];

  advances.forEach((advance) => {
    const due = Math.min(
      roundToCurrency(advance.recoveryAmount),
      roundToCurrency(advance.outstanding ?? advance.recoveryAmount),
    );
    if (due > 0) {
      advanceTotal += due;
      advanceBreakup.push({
        advanceId: advance.advanceId,
        amount: due,
        closing: roundToCurrency((advance.outstanding ?? 0) - due),
      });
    }
  });

  if (loanTotal > 0) deductions.push(line(COMPONENT_CODE.LOAN_EMI, loanTotal, { breakup: loanBreakup }));
  if (advanceTotal > 0) {
    deductions.push(line(COMPONENT_CODE.ADVANCE_RECOVERY, advanceTotal, { breakup: advanceBreakup }));
  }

  (variable.otherDeductions ?? []).forEach((entry) => {
    if (entry.amount > 0) {
      deductions.push({
        code: entry.code ?? COMPONENT_CODE.OTHER_DEDUCTION,
        label: entry.label ?? 'Other Deduction',
        amount: roundToCurrency(entry.amount),
      });
    }
  });

  const totalDeductions = roundToCurrency(deductions.reduce((sum, entry) => sum + entry.amount, 0));

  /* ----------------------------------------------- employer side -------- */
  /**
   * Reported for cost to company and the statutory returns; never subtracted
   * from take-home. A contribution that is zero writes no line at all rather
   * than a zero one, so it stays out of every downstream total that sums this
   * array.
   */
  const employerContributions = [];
  if (nssf.employer > 0) employerContributions.push(line(COMPONENT_CODE.NSSF_EMPLOYER, nssf.employer));
  if (sdl > 0) employerContributions.push(line(COMPONENT_CODE.SDL, sdl));
  if (wcf > 0) employerContributions.push(line(COMPONENT_CODE.WCF, wcf));

  const employerTotal = roundToCurrency(
    employerContributions.reduce((sum, entry) => sum + entry.amount, 0),
  );

  /* ------------------------------------------------------------ net ----- */
  // Floored at zero: deductions exceeding gross is a real situation (a long
  // unpaid absence with an active loan), but a negative payslip is not a
  // payment instruction. The excess is reported so it can be carried forward.
  const rawNet = gross - totalDeductions;
  const netPayable = Math.max(0, roundToCurrency(rawNet));

  return {
    lopFactor: Number(factor.toFixed(4)),
    payableDays: Number(attendance.payableDays ?? totalDays),
    totalDays,
    lopDays: roundToCurrency(attendance.lopDays ?? Math.max(0, totalDays - (attendance.payableDays ?? totalDays))),

    earnings,
    deductions,
    employerContributions,

    grossEarnings: gross,
    totalDeductions,
    employerContributionTotal: employerTotal,
    netPayable,
    // Non-zero when deductions could not be fully recovered this month.
    unrecovered: rawNet < 0 ? roundToCurrency(Math.abs(rawNet)) : 0,

    // Cost to company for the month: what the employee is paid plus what the
    // company pays alongside it.
    ctcForMonth: roundToCurrency(gross + employerTotal),

    /**
     * Whether the fixed figures came from the Employee Master, and whether any
     * of it was scaled away. `prorated` false means the payslip carries the
     * salary structure's figures unchanged, which is the normal case.
     */
    salarySource: snapshot ? 'EMPLOYEE_SALARY_STRUCTURE' : 'COMPONENTS',
    prorated: factor !== 1,
    fixedGross,

    /**
     * The unprorated figure, so a log or a query can show what the full month
     * would have been beside what was actually paid.
     *
     * Through the same formula on the same components, unscaled -- reading a
     * stored gross here would reintroduce the very disagreement this function
     * exists to prevent, just on the comparison figure instead of the paid one.
     */
    salaryStructureGross: calculateGrossSalary([
      ...FIXED_EARNINGS.map(({ code, field }) => line(code, structure[field])),
      ...(structure.otherAllowances ?? []).map((allowance) =>
        line(allowance.code ?? COMPONENT_CODE.OTHER_ALLOWANCE, allowance.amount)),
    ]),

    statutoryDetail: {
      nssf: { ...nssf },
      nhif,
      sdl,
      wcf,
      paye: { ...paye },
      taxableIncome: monthlyTaxable,
    },

    recoveries: { loans: loanBreakup, advances: advanceBreakup },
  };
};

/**
 * Derives a monthly structure from an annual CTC using a conventional split.
 *
 * A convenience for onboarding, not a rule -- the returned figures are a
 * starting point an HR user is expected to adjust.
 *
 * Basic is the ANCHOR and the allowances sit on top of it, which is the
 * Tanzanian convention and the opposite of the Indian split this replaces.
 * There, special allowance was the balancing figure that absorbed whatever the
 * named components left over; here the named allowances are stated as their own
 * percentages of basic and basic is solved for, so that the components still
 * total the monthly CTC exactly and no residual component has to exist to
 * make the arithmetic close.
 *
 * The annual leave allowance is one month's basic by convention, held -- like
 * the field it fills -- as its monthly twelfth.
 */
export const deriveStructureFromCtc = (
  annualCtc,
  {
    hraPercent = 0,
    transportationPercent = 10,
    communicationPercent = 5,
    annualLeavePercent = 100,
    foodAllowanceAmount = 0,
    mediclaimAmount = 0,
    schoolFeesAllowanceAmount = 0,
  } = {},
) => {
  const monthly = roundToCurrency(Number(annualCtc || 0) / 12);

  // Fixed shilling allowances come off the top; what remains is shared between
  // basic and the allowances expressed against it.
  const fixed =
    (Number(foodAllowanceAmount) || 0) +
    (Number(mediclaimAmount) || 0) +
    (Number(schoolFeesAllowanceAmount) || 0);

  const remaining = Math.max(0, monthly - fixed);

  /**
   * basic x (1 + every percentage of basic) = remaining
   *
   * Solved rather than guessed at, so the components add up to the monthly CTC
   * by construction instead of needing a residual component to absorb the
   * difference.
   */
  const multiplier =
    1 +
    (Number(hraPercent) || 0) / 100 +
    (Number(transportationPercent) || 0) / 100 +
    (Number(communicationPercent) || 0) / 100 +
    // Per annum, so its monthly share is a twelfth.
    (Number(annualLeavePercent) || 0) / 100 / 12;

  const basic = roundToCurrency(remaining / (multiplier || 1));

  const hraAllowance = roundToCurrency((basic * (Number(hraPercent) || 0)) / 100);
  const transportationAllowance = roundToCurrency((basic * (Number(transportationPercent) || 0)) / 100);
  const communicationAllowance = roundToCurrency((basic * (Number(communicationPercent) || 0)) / 100);
  const annualLeaveAllowance = roundToCurrency((basic * (Number(annualLeavePercent) || 0)) / 100 / 12);

  return {
    basic,
    hraAllowance,
    foodAllowance: roundToCurrency(foodAllowanceAmount),
    transportationAllowance,
    communicationAllowance,
    mediclaim: roundToCurrency(mediclaimAmount),
    schoolFeesAllowance: roundToCurrency(schoolFeesAllowanceAmount),
    annualLeaveAllowance,
    performanceIncentive: 0,
    monthlyCtc: monthly,
    annualCtc: Number(annualCtc) || 0,
  };
};

export default {
  calculatePayslip,
  calculateGrossSalary,
  deriveStructureFromCtc,
  lopFactor,
  overtimeAmount,
  FIXED_EARNINGS,
  COMPONENT_TYPE,
};
