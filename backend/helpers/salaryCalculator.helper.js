import { COMPONENT_CODE, COMPONENT_TYPE } from '../utils/constants.js';
import {
  calculatePf,
  calculateEsi,
  calculateEmployeeEsi,
  calculateLwf,
  calculateProfessionalTax,
  calculateMonthlyTds,
  DEFAULT_STATUTORY,
  roundToRupee,
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
 * PF is computed on Basic+DA, ESI on gross, PT on gross, TDS on annual
 * projection. Using one base for all of them is the classic payroll bug.
 */

const LABELS = {
  [COMPONENT_CODE.BASIC]: 'Basic',
  [COMPONENT_CODE.HRA]: 'House Rent Allowance',
  [COMPONENT_CODE.DA]: 'Dearness Allowance',
  [COMPONENT_CODE.SPECIAL_ALLOWANCE]: 'Special Allowance',
  [COMPONENT_CODE.OTHER_ALLOWANCE]: 'Other Allowance',
  [COMPONENT_CODE.OVERTIME]: 'Overtime',
  [COMPONENT_CODE.BONUS]: 'Bonus',
  [COMPONENT_CODE.INCENTIVE]: 'Incentive',
  [COMPONENT_CODE.ARREARS]: 'Arrears',
  [COMPONENT_CODE.PF]: 'Provident Fund',
  [COMPONENT_CODE.ESI]: 'ESI',
  [COMPONENT_CODE.PT]: 'Professional Tax',
  [COMPONENT_CODE.TDS]: 'Income Tax (TDS)',
  [COMPONENT_CODE.LOAN_EMI]: 'Loan EMI',
  [COMPONENT_CODE.ADVANCE_RECOVERY]: 'Advance Recovery',
  [COMPONENT_CODE.OTHER_DEDUCTION]: 'Other Deduction',
  [COMPONENT_CODE.EMPLOYER_PF]: 'Employer PF',
  [COMPONENT_CODE.EMPLOYER_EPS]: 'Employer Pension (EPS)',
  [COMPONENT_CODE.EMPLOYER_ESI]: 'Employer ESI',
  [COMPONENT_CODE.LWF]: 'Labour Welfare Fund',
  [COMPONENT_CODE.EMPLOYER_LWF]: 'Employer Labour Welfare Fund',
};

/**
 * The contractual monthly components, as against variable pay.
 *
 * These sum to the month's cost to company; overtime, bonus, incentive and
 * arrears are earned on top of it and are never part of the salary structure's
 * own figures. Separating them is what lets gross be taken from the Employee
 * Master while still adding whatever was actually earned this month.
 */
const FIXED_EARNING_CODES = new Set([
  COMPONENT_CODE.BASIC,
  COMPONENT_CODE.HRA,
  COMPONENT_CODE.DA,
  COMPONENT_CODE.SPECIAL_ALLOWANCE,
  COMPONENT_CODE.OTHER_ALLOWANCE,
]);

const line = (code, amount, extra = {}) => ({
  code,
  label: LABELS[code] ?? code,
  amount: roundToRupee(amount),
  ...extra,
});

/**
 * THE gross salary calculation. Every caller uses this one.
 *
 *   gross = basic + hra + da + conveyance + medical + special + other
 *
 * Gross is an earnings figure and is nothing but the sum of what was earned.
 * Nothing is subtracted from it -- not the employee's deductions, and not the
 * employer's own PF, ESI or LWF, which are a cost to the company rather than
 * something the employee earned and then lost.
 *
 * It sums the component lines themselves rather than scaling a stored total,
 * which is what keeps the register honest: the lines shown to the user ARE the
 * addends, so the column total can never disagree with the figure beside it.
 * Deriving the same number two ways is how the two drifted apart before -- one
 * path scaled a stored gross by the payable-day ratio while the other summed
 * the individually-scaled components, and the difference was reported as an
 * unexplained rupee gap.
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
 * @returns {number} The fixed gross, rounded to the rupee.
 */
export const calculateGrossSalary = (earnings = []) =>
  roundToRupee(
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
  if (ratePerHour > 0) return roundToRupee((minutes / 60) * ratePerHour);

  if (!basic) return 0;

  const monthlyHours = (Number(totalDays) || 30) * dailyHours;
  if (!monthlyHours) return 0;

  const hourlyRate = Number(basic) / monthlyHours;
  return roundToRupee((minutes / 60) * hourlyRate * multiplier);
};

/**
 * Calculates one payslip.
 *
 * @param {object} input
 * @param {object} input.structure   { basic, hra, da, specialAllowance, otherAllowances[] }
 * @param {object} input.attendance  { payableDays, totalDays, lopDays, overtimeMinutes }
 * @param {object} input.variable    { bonus, incentive, arrears, otherEarnings[], otherDeductions[] }
 * @param {Array}  input.loans       [{ loanId, emi, outstanding }]
 * @param {Array}  input.advances    [{ advanceId, recoveryAmount, outstanding }]
 * @param {object} input.statutory   Settings; falls back to DEFAULT_STATUTORY
 * @param {object} input.flags
 *   Statutory eligibility, from the Employee Master and opt-in:
 *   { pfApplicable, esiApplicable, lwfApplicable, ptApplicable, tdsApplicable }.
 *   Each is enabled only by an explicit `true`.
 * @param {object} input.ytd         { grossPaid, tdsPaid, monthsRemaining }
 * @param {number} input.month       1-12, for the February PT top-up
 * @param {object} input.salarySnapshot
 *   The employee's own salary structure, when one is on file. Present, it is
 *   AUTHORITATIVE: gross, the statutory employee deductions and the employer
 *   contribution are taken from it rather than re-derived here. See below.
 */
export const calculatePayslip = ({
  structure,
  attendance = {},
  variable = {},
  loans = [],
  advances = [],
  statutory = DEFAULT_STATUTORY,
  flags = {},
  ytd = {},
  month = 1,
  overtimeMultiplier = 2,
  tdsOverride = null,
  overtimeConfig = null,
  salarySnapshot = null,
}) => {
  const factor = lopFactor(attendance);
  const totalDays = Number(attendance.totalDays) || 30;

  /* ---------------------------------------------------- fixed earnings -- */
  const prorate = (value) => roundToRupee((Number(value) || 0) * factor);

  const basic = prorate(structure.basic);
  const hra = prorate(structure.hra);
  const da = prorate(structure.da);
  const special = prorate(structure.specialAllowance);

  const earnings = [
    line(COMPONENT_CODE.BASIC, basic),
    line(COMPONENT_CODE.HRA, hra),
    line(COMPONENT_CODE.DA, da),
    line(COMPONENT_CODE.SPECIAL_ALLOWANCE, special),
  ];

  (structure.otherAllowances ?? []).forEach((allowance) => {
    earnings.push({
      code: allowance.code ?? COMPONENT_CODE.OTHER_ALLOWANCE,
      label: allowance.label ?? 'Other Allowance',
      // A fixed allowance is subject to loss of pay; a reimbursement is not,
      // and says so on the component.
      amount: allowance.prorate === false
        ? roundToRupee(allowance.amount)
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
  if (overtime > 0) earnings.push(line(COMPONENT_CODE.OVERTIME, overtime, { hours: Number(((attendance.overtimeMinutes ?? 0) / 60).toFixed(2)) }));
  if (variable.bonus > 0) earnings.push(line(COMPONENT_CODE.BONUS, variable.bonus));
  if (variable.incentive > 0) earnings.push(line(COMPONENT_CODE.INCENTIVE, variable.incentive));
  if (variable.arrears > 0) earnings.push(line(COMPONENT_CODE.ARREARS, variable.arrears));

  (variable.otherEarnings ?? []).forEach((entry) => {
    if (entry.amount > 0) {
      earnings.push({
        code: entry.code ?? COMPONENT_CODE.OTHER_ALLOWANCE,
        label: entry.label ?? 'Other Earning',
        amount: roundToRupee(entry.amount),
      });
    }
  });

  // The contractual earnings, through the one gross formula. Held apart from
  // variable pay so each can be reported for what it is.
  const fixedTotal = calculateGrossSalary(earnings);

  const variableTotal = roundToRupee(
    earnings
      .filter((entry) => !FIXED_EARNING_CODES.has(entry.code))
      .reduce((sum, entry) => sum + entry.amount, 0),
  );

  /**
   * The employee's stored salary structure decides the statutory figures --
   * with the exception of provident fund, which is calculated. See below.
   *
   * Payroll used to re-derive every deduction from the statutory engine, and
   * the results disagreed with the Employee Master: the engine's own PT rather
   * than the amount configured for the person. ESI, LWF and professional tax
   * are therefore taken from the structure verbatim, scaled only by the
   * loss-of-pay factor.
   *
   * Wage-linked amounts scale with loss of pay; the flat monthly levies do
   * not. Professional tax and labour welfare fund are fixed statutory charges
   * for the month rather than a rate per day, and are due in full whenever any
   * salary is paid at all.
   */
  const snapshot = salarySnapshot ?? null;
  const scaled = (value) => roundToRupee((Number(value) || 0) * factor);
  const flat = (value) => (factor > 0 ? roundToRupee(Number(value) || 0) : 0);

  /**
   * Statutory eligibility is opt-in, and strictly so.
   *
   * Only an explicit `true` enables a deduction. Absent, null and false all
   * mean no, because the caller is stating who this person IS enrolled in, and
   * a missing answer is not consent to deduct from somebody's salary. The
   * looser `!== false` this replaced turned every unset flag into an
   * enrolment.
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
   * Without this the employer side was derived purely from the statutory flag:
   * an employee with `pfEmployer: 0` on file still had 12% of basic attributed
   * to the company, because nothing ever consulted the figure the Employee
   * Master held.
   *
   * `Number(x) || 0` collapses 0, "0", "", null, undefined and any unparseable
   * value to zero, so none of them can enable a contribution and none can
   * produce NaN.
   */
  const employerContributes = (configured) => (Number(configured) || 0) > 0;

  /**
   * PF is calculated, not copied.
   *
   * Every other statutory figure below still comes from the salary structure,
   * but provident fund is a rate on a wage, and the wage is the basic actually
   * being paid this month. Scaling the structure's configured amount by the
   * loss-of-pay factor gave a different answer: on eight payable days of
   * thirty-one it produced 1,800 x 8/31 = 465, where 12% of the 6,968 of basic
   * actually paid is 836. It also carried whatever employer figure happened to
   * be stored, which is how the employer's share could differ from the
   * employee's.
   *
   * `basic` and `da` here are already prorated, so the cap is applied to the
   * month's real contribution rather than to a full month's.
   */
  const calculatedPf = calculatePf({
    basic,
    da,
    settings: statutory,
    employeeApplicable: eligible(flags.pfApplicable),
  });

  /**
   * The employee's side is untouched; the employer's applies only where the
   * Employee Master carries a figure for it. The formula and its cap are
   * exactly as calculated above -- this only decides whether it is applied.
   */
  const pf = {
    ...calculatedPf,
    employer: employerContributes(snapshot?.pfEmployer) ? calculatedPf.employer : 0,
  };

  /**
   * ESI. The employee's side is calculated; the employer's is not touched.
   *
   * The employee used to be whatever amount sat on the salary structure,
   * scaled by loss of pay -- so an employee with ESI switched on but no figure
   * entered contributed nothing, and one with a stale figure contributed that.
   * It is now a rate on basic with its own cap, from the statutory helper.
   *
   * The base is `basic`, the PAYABLE basic -- already reduced for loss of pay
   * -- and not `structure.basic`, the full month's. Someone who was paid for
   * five days of August contributes on the 2,706 they actually earned, not on
   * the 16,780 they would have earned in a whole month. ESI therefore follows
   * the salary down without needing a proration rule of its own, and a month
   * with no pay yields nothing because the payable basic is nothing.
   *
   * There is no employer side. ESI is an employee-only deduction in this
   * system, so the employer contributes nothing regardless of what the salary
   * structure carries in `esiEmployer` -- that field no longer reaches
   * payroll at all.
   */
  const esiEmployee = calculateEmployeeEsi({ basic, settings: statutory });

  const esi = !eligible(flags.esiApplicable)
    ? { employee: 0, employer: 0, applicable: false }
    : snapshot
      ? {
          employee: esiEmployee,
          employer: 0,
          applicable: true,
          fromSalaryStructure: true,
        }
      : {
          ...calculateEsi({
            gross: fixedTotal + variableTotal,
            // The payable basic here too, so both paths contribute alike.
            basic,
            settings: statutory,
            employeeApplicable: true,
            forceApplicable: flags.esiForced ?? null,
          }),
        };

  /**
   * Labour welfare fund, calculated rather than copied.
   *
   * `fixedTotal` is this month's gross -- the earned components, before
   * overtime and bonus, which is the figure the register prints as Gross
   * Salary. It is already prorated, so LWF follows the salary down without
   * needing a proration rule of its own, and a month with no pay yields
   * nothing because the gross itself is nothing.
   *
   * Variable pay is deliberately outside the base: a one-off bonus should not
   * move a welfare-fund contribution.
   */
  const lwf = eligible(flags.lwfApplicable)
    ? calculateLwf({ gross: fixedTotal, settings: statutory })
    : { employee: 0, employer: 0 };

  const lwfEmployee = lwf.employee;
  // As with PF: the employee's side stands, the employer's applies only where
  // the Employee Master carries a figure for it. The doubling is unchanged.
  const lwfEmployer = employerContributes(snapshot?.lwfEmployer) ? lwf.employer : 0;

  // Provident fund and labour welfare fund only. ESI has no employer side.
  const employerContributionTotalFromStructure = snapshot
    ? roundToRupee(pf.employer + lwfEmployer)
    : null;

  /**
   * Gross is the sum of the earned components, plus whatever variable pay was
   * earned on top.
   *
   * It is deliberately NOT `snapshot.grossSalary * factor`. That was a second,
   * independent derivation of the same quantity, and on any prorated month the
   * two disagreed: scaling a stored gross rounds once at the end, while the
   * component lines are each rounded as they are built, and the stored gross
   * had the employer's contribution already netted out of it. For eight payable
   * days of thirty-one that produced a gross 482 rupees below the components
   * printed directly above it on the same register.
   *
   * The employer's PF, ESI and LWF are not deducted here. They are the
   * company's cost, reported on the employer side and added back for CTC; the
   * employee earned the components, so the components are the gross.
   */
  const fixedGross = fixedTotal;
  const gross = roundToRupee(fixedGross + variableTotal);

  const pt = !eligible(flags.ptApplicable)
    ? 0
    : snapshot
      ? flat(snapshot.professionalTax)
      : calculateProfessionalTax({ gross, month, settings: statutory });

  // TDS base excludes the employee's own PF, which is an eligible deduction.
  const monthlyTaxable = Math.max(0, gross - pf.employee);

  const tds =
    flags.tdsApplicable === false
      ? { monthly: 0 }
      : calculateMonthlyTds({
          monthlyTaxable,
          paidSoFar: ytd.grossPaid ?? 0,
          tdsPaidSoFar: ytd.tdsPaid ?? 0,
          monthsRemaining: ytd.monthsRemaining ?? 12,
          settings: statutory,
          manualOverride: tdsOverride,
        });

  /* ------------------------------------------------------ deductions ---- */
  const deductions = [];
  if (pf.employee > 0) deductions.push(line(COMPONENT_CODE.PF, pf.employee, { wages: pf.wages }));
  if (esi.employee > 0) deductions.push(line(COMPONENT_CODE.ESI, esi.employee));
  if (lwfEmployee > 0) deductions.push(line(COMPONENT_CODE.LWF, lwfEmployee));
  if (pt > 0) deductions.push(line(COMPONENT_CODE.PT, pt));
  if (tds.monthly > 0) deductions.push(line(COMPONENT_CODE.TDS, tds.monthly));

  /* ------------------------------------------------------ recoveries ---- */
  // Never recover more than is outstanding: the final instalment of a loan is
  // usually smaller than the EMI, and over-recovering creates a refund case.
  let loanTotal = 0;
  const loanBreakup = [];

  loans.forEach((loan) => {
    const due = Math.min(roundToRupee(loan.emi), roundToRupee(loan.outstanding ?? loan.emi));
    if (due > 0) {
      loanTotal += due;
      loanBreakup.push({ loanId: loan.loanId, amount: due, closing: roundToRupee((loan.outstanding ?? 0) - due) });
    }
  });

  let advanceTotal = 0;
  const advanceBreakup = [];

  advances.forEach((advance) => {
    const due = Math.min(
      roundToRupee(advance.recoveryAmount),
      roundToRupee(advance.outstanding ?? advance.recoveryAmount),
    );
    if (due > 0) {
      advanceTotal += due;
      advanceBreakup.push({
        advanceId: advance.advanceId,
        amount: due,
        closing: roundToRupee((advance.outstanding ?? 0) - due),
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
        amount: roundToRupee(entry.amount),
      });
    }
  });

  const totalDeductions = roundToRupee(deductions.reduce((sum, entry) => sum + entry.amount, 0));

  /* ----------------------------------------------- employer side -------- */
  /**
   * Reported for CTC and statutory returns; never subtracted from take-home.
   *
   * No employer ESI line is written, in any circumstance. The company does not
   * contribute to ESI here, so there is nothing to report -- and an absent
   * line rather than a zero one keeps it out of every downstream total that
   * sums this array.
   */
  const employerContributions = [];
  if (pf.employer > 0) employerContributions.push(line(COMPONENT_CODE.EMPLOYER_PF, pf.employer));
  if (pf.pension > 0) employerContributions.push(line(COMPONENT_CODE.EMPLOYER_EPS, pf.pension));
  if (lwfEmployer > 0) employerContributions.push(line(COMPONENT_CODE.EMPLOYER_LWF, lwfEmployer));

  const employerTotal =
    employerContributionTotalFromStructure ??
    roundToRupee(employerContributions.reduce((sum, entry) => sum + entry.amount, 0));

  /* ------------------------------------------------------------ net ----- */
  // Floored at zero: deductions exceeding gross is a real situation (a long
  // unpaid absence with an active loan), but a negative payslip is not a
  // payment instruction. The excess is reported so it can be carried forward.
  const rawNet = gross - totalDeductions;
  const netPayable = Math.max(0, roundToRupee(rawNet));

  return {
    lopFactor: Number(factor.toFixed(4)),
    payableDays: Number(attendance.payableDays ?? totalDays),
    totalDays,
    lopDays: roundToRupee(attendance.lopDays ?? Math.max(0, totalDays - (attendance.payableDays ?? totalDays))),

    earnings,
    deductions,
    employerContributions,

    grossEarnings: gross,
    totalDeductions,
    employerContributionTotal: employerTotal,
    netPayable,
    // Non-zero when deductions could not be fully recovered this month.
    unrecovered: rawNet < 0 ? roundToRupee(Math.abs(rawNet)) : 0,

    ctcForMonth: roundToRupee(gross + employerTotal),

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
      line(COMPONENT_CODE.BASIC, structure.basic),
      line(COMPONENT_CODE.HRA, structure.hra),
      line(COMPONENT_CODE.DA, structure.da),
      line(COMPONENT_CODE.SPECIAL_ALLOWANCE, structure.specialAllowance),
      ...(structure.otherAllowances ?? []).map((allowance) =>
        line(allowance.code ?? COMPONENT_CODE.OTHER_ALLOWANCE, allowance.amount)),
    ]),

    statutoryDetail: {
      pf: { ...pf },
      esi: { ...esi },
      professionalTax: pt,
      tds: { ...tds },
      taxableIncome: monthlyTaxable,
    },

    recoveries: { loans: loanBreakup, advances: advanceBreakup },
  };
};

/**
 * Derives a monthly structure from an annual CTC using a conventional split.
 *
 * A convenience for onboarding, not a rule -- the returned figures are a
 * starting point an HR user is expected to adjust. Special allowance is the
 * balancing figure so the components always sum exactly to the monthly CTC.
 */
export const deriveStructureFromCtc = (annualCtc, { basicPercent = 40, hraPercent = 50, daPercent = 0 } = {}) => {
  const monthly = roundToRupee(Number(annualCtc || 0) / 12);
  const basic = roundToRupee((monthly * basicPercent) / 100);
  const da = roundToRupee((basic * daPercent) / 100);
  const hra = roundToRupee((basic * hraPercent) / 100);
  const specialAllowance = Math.max(0, roundToRupee(monthly - basic - da - hra));

  return { basic, da, hra, specialAllowance, monthlyCtc: monthly, annualCtc: Number(annualCtc) || 0 };
};

export default {
  calculatePayslip,
  calculateGrossSalary,
  deriveStructureFromCtc,
  lopFactor,
  overtimeAmount,
  COMPONENT_TYPE,
};
