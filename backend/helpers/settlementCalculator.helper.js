import { SETTLEMENT_COMPONENT, SETTLEMENT_TRIGGER } from '../utils/constants.js';
import { roundToCurrency } from './statutory.helper.js';

/**
 * Full and final settlement calculation.
 *
 * Pure, like the payroll and attendance engines: everything it needs is passed
 * in, so a settlement can be recomputed from its stored inputs years later and
 * produce the same figure. Exit money is disputed more often than monthly pay,
 * and "show me how you arrived at that" has to be answerable.
 */

export const DEFAULT_SETTLEMENT_RULES = {
  /**
   * Severance pay, under the Employment and Labour Relations Act.
   *
   * Deliberately NOT gratuity, which this replaced. The two are different
   * entitlements with different triggers, and carrying the Indian rule over
   * under a new name would have paid the wrong people the wrong amounts:
   *
   *   - Severance is owed on TERMINATION by the employer, and on redundancy.
   *     A resignation earns none of it, where gratuity was payable on any exit
   *     once the service bar was met.
   *   - The qualifying period is twelve months' continuous service, not five
   *     years.
   *   - The formula is seven days' basic wage for each completed year, capped
   *     at ten years of service -- so the entitlement stops growing after a
   *     decade rather than continuing indefinitely under a shilling ceiling.
   *
   * The daily wage divides a month by 30, not by the 26 the Gratuity Act used;
   * there is no statutory working-day fiction here to reproduce.
   */
  severance: {
    enabled: true,
    minimumMonths: 12,
    daysPerYear: 7,
    monthDays: 30,
    // Service beyond this many completed years earns no further severance.
    maxYears: 10,
    // Part-years do not count towards severance, so no rounding-up rule.
    roundUpFromMonths: 6,
    // Death in service and retirement are settled as if terminated.
    payableOnTriggers: [
      SETTLEMENT_TRIGGER.TERMINATION,
      SETTLEMENT_TRIGGER.END_OF_CONTRACT,
      SETTLEMENT_TRIGGER.DEATH,
      SETTLEMENT_TRIGGER.RETIREMENT,
    ],
  },
  notice: {
    // Per-day basis for both pay in lieu and shortfall recovery.
    perDayBasis: 'GROSS', // 'GROSS' | 'BASIC'
    monthDays: 30,
  },
  /**
   * Leave encashment.
   *
   * Capped at 28 days: the Act entitles an employee to 28 consecutive days of
   * paid annual leave in each leave cycle, so that is the most that can be
   * accrued and therefore the most that can be cashed out at exit. It was 60
   * under the Indian rules, which would have paid out more than a Tanzanian
   * employee can ever have earned.
   *
   * Priced on GROSS rather than on basic, because annual leave here is paid
   * leave at the employee's ordinary remuneration -- a leave day is worth what
   * a working day is worth.
   */
  leaveEncashment: {
    enabled: true,
    perDayBasis: 'GROSS',
    monthDays: 30,
    maxDays: 28,
  },
};

/** Statutory annual leave entitlement, in days per leave cycle. */
export const ANNUAL_LEAVE_ENTITLEMENT_DAYS = 28;

const line = (code, label, amount, meta = null) => ({
  code,
  label,
  amount: roundToCurrency(amount),
  ...(meta ? { meta } : {}),
});

/* -------------------------------------------------------------------------- */
/*                                  Service                                   */
/* -------------------------------------------------------------------------- */

/**
 * Completed years of service, with the part-year rounded per policy.
 *
 * Returns the raw figures too, because a severance dispute is almost always
 * about the boundary -- "eleven months and three weeks" either does or does not
 * clear the twelve-month bar, depending on a rule the employee is entitled to
 * see.
 */
export const calculateService = (joiningDate, lastWorkingDate, { roundUpFromMonths = 6 } = {}) => {
  if (!joiningDate || !lastWorkingDate) {
    return { years: 0, months: 0, days: 0, completedYears: 0, totalDays: 0 };
  }

  const from = new Date(joiningDate);
  const to = new Date(lastWorkingDate);
  const totalDays = Math.max(0, Math.floor((to - from) / 86_400_000));

  let years = to.getFullYear() - from.getFullYear();
  let months = to.getMonth() - from.getMonth();
  let days = to.getDate() - from.getDate();

  if (days < 0) {
    months -= 1;
    // Days in the month preceding the last working date.
    days += new Date(to.getFullYear(), to.getMonth(), 0).getDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }

  years = Math.max(0, years);

  return {
    years,
    months,
    days,
    totalDays,
    /**
     * Service with the part-year rounded up, for rules that grant credit for
     * most of a final year.
     *
     * Severance deliberately does NOT use this -- it counts whole years only,
     * and reads `years` instead. Kept because the notice and encashment rules a
     * tenant may configure are free to round, and because a settlement sheet
     * should show both figures when the two differ.
     */
    completedYears: months >= roundUpFromMonths ? years + 1 : years,
  };
};

/* -------------------------------------------------------------------------- */
/*                                Severance pay                               */
/* -------------------------------------------------------------------------- */

/**
 * Severance: basic x 7/30 x completed years, capped at ten years of service.
 *
 * Two gates rather than one, and the trigger gate comes first. An employee who
 * resigns is owed no severance however long they served, so a rule that
 * checked only the service period would pay out on every voluntary exit. That
 * is the substantive difference from the gratuity calculation this replaces,
 * which was payable on any exit once the five-year bar was cleared.
 *
 * WHOLE years only. The Act speaks of each completed year of continuous
 * service, so eleven months of a final year adds nothing -- which is why
 * `service.years` is used here and not the rounded-up `completedYears` the
 * gratuity rule needed.
 *
 * The base is basic wage, not gross: allowances are reimbursements of a cost of
 * working, and they stop when the work does.
 */
export const calculateSeverance = ({ basic, service, trigger, rules = DEFAULT_SETTLEMENT_RULES }) => {
  const config = rules.severance ?? DEFAULT_SETTLEMENT_RULES.severance;

  const result = {
    eligible: false,
    amount: 0,
    years: service.years,
    countedYears: 0,
    wages: 0,
    reason: null,
  };

  if (!config.enabled) {
    result.reason = 'Severance is disabled in settlement rules';
    return result;
  }

  const payableTriggers = config.payableOnTriggers ?? DEFAULT_SETTLEMENT_RULES.severance.payableOnTriggers;

  if (trigger && !payableTriggers.includes(trigger)) {
    result.reason = `Severance is not payable on ${String(trigger).toLowerCase().replace(/_/g, ' ')}`;
    return result;
  }

  const servedMonths = service.years * 12 + service.months;
  if (servedMonths < config.minimumMonths) {
    result.reason = `Requires ${config.minimumMonths} months of continuous service; completed ${service.years}y ${service.months}m`;
    return result;
  }

  // Service beyond the ceiling earns nothing further; it is a cap on the
  // YEARS counted, not a cap on the shillings paid.
  const countedYears = Math.min(service.years, config.maxYears ?? service.years);
  const wages = Math.max(0, Number(basic || 0));
  const amount = (wages * config.daysPerYear * countedYears) / config.monthDays;

  result.eligible = countedYears > 0;
  result.wages = roundToCurrency(wages);
  result.countedYears = countedYears;
  result.amount = roundToCurrency(amount);
  result.cappedAt = service.years > countedYears ? config.maxYears : null;

  return result;
};

/* -------------------------------------------------------------------------- */
/*                               Notice period                                */
/* -------------------------------------------------------------------------- */

/**
 * Notice shortfall or pay in lieu.
 *
 * Direction depends on who ended the employment. An employee who leaves early
 * owes the balance; an employer who releases someone without notice pays it.
 * Returning a signed figure would blur that distinction, so the outcome is
 * explicit.
 */
export const calculateNotice = ({
  requiredDays = 0,
  servedDays = 0,
  waivedDays = 0,
  monthlyGross,
  basic,
  trigger,
  employerWaived = false,
  rules = DEFAULT_SETTLEMENT_RULES,
}) => {
  const config = rules.notice ?? DEFAULT_SETTLEMENT_RULES.notice;
  const base = config.perDayBasis === 'BASIC' ? Number(basic || 0) : Number(monthlyGross || 0);
  const perDay = base / (config.monthDays || 30);

  const shortfall = Math.max(0, Number(requiredDays) - Number(servedDays) - Number(waivedDays));

  // Termination and death are the employer's decision or nobody's; recovering
  // notice from either is not defensible.
  const employerInitiated = [SETTLEMENT_TRIGGER.TERMINATION, SETTLEMENT_TRIGGER.DEATH].includes(trigger);

  if (employerInitiated && shortfall > 0) {
    return {
      direction: 'PAYABLE',
      days: shortfall,
      perDay: roundToCurrency(perDay),
      amount: roundToCurrency(perDay * shortfall),
      reason: 'Pay in lieu of notice (employer-initiated exit)',
    };
  }

  if (employerWaived || shortfall === 0) {
    return {
      direction: 'NONE',
      days: 0,
      perDay: roundToCurrency(perDay),
      amount: 0,
      reason: employerWaived ? 'Notice period waived by the employer' : 'Full notice served',
    };
  }

  return {
    direction: 'RECOVERABLE',
    days: shortfall,
    perDay: roundToCurrency(perDay),
    amount: roundToCurrency(perDay * shortfall),
    reason: `${shortfall} day(s) of notice not served`,
  };
};

/* -------------------------------------------------------------------------- */
/*                              Leave encashment                              */
/* -------------------------------------------------------------------------- */

/**
 * Accrued annual leave, paid out at exit.
 *
 * Capped at the statutory 28-day cycle entitlement -- an employee cannot have
 * accrued more than one cycle's worth, so a larger figure arriving here is a
 * leave-balance error rather than a larger payout. The cap is reported so the
 * sheet can say it was applied instead of silently paying less than was asked
 * for.
 */
export const calculateLeaveEncashment = ({
  encashableDays = 0,
  basic,
  monthlyGross,
  rules = DEFAULT_SETTLEMENT_RULES,
}) => {
  const config = rules.leaveEncashment ?? DEFAULT_SETTLEMENT_RULES.leaveEncashment;

  if (!config.enabled || encashableDays <= 0) {
    return { days: 0, perDay: 0, amount: 0 };
  }

  const base = config.perDayBasis === 'BASIC' ? Number(basic || 0) : Number(monthlyGross || 0);
  const perDay = base / (config.monthDays || 30);
  const days = Math.min(Number(encashableDays), config.maxDays ?? Number(encashableDays));

  return {
    days,
    perDay: roundToCurrency(perDay),
    amount: roundToCurrency(perDay * days),
    cappedAt: encashableDays > (config.maxDays ?? Infinity) ? config.maxDays : null,
  };
};

/* -------------------------------------------------------------------------- */
/*                             Settlement sheet                               */
/* -------------------------------------------------------------------------- */

/**
 * Assembles the full settlement sheet.
 *
 * @param {object} input
 * @param {object} input.structure   Basic, the allowances, and `monthlyGross`
 * @param {object} input.service     From calculateService
 * @param {string} input.trigger
 * @param {object} input.pendingSalary { days, perDay, amount } - unpaid days to LWD
 * @param {object} input.notice
 * @param {object} input.leave       { encashableDays, excessDays }
 * @param {Array}  input.loans       [{ loanId, loanNumber, outstanding }]
 * @param {Array}  input.advances    [{ advanceId, reference, outstanding }]
 * @param {Array}  input.assets      [{ assetId, assetCode, name, recoveryAmount }]
 * @param {object} input.extras      { bonus, incentive, arrears, reimbursement, otherEarnings[], otherDeductions[], paye }
 */
export const buildSettlementSheet = ({
  structure,
  service,
  trigger,
  pendingSalary = {},
  notice = {},
  leave = {},
  loans = [],
  advances = [],
  assets = [],
  extras = {},
  rules = DEFAULT_SETTLEMENT_RULES,
}) => {
  const basic = Number(structure.basic || 0);
  // The caller supplies the gross; the fallback sums whatever named allowances
  // are on the structure, so a partially-populated one still prices.
  const monthlyGross = Number(
    structure.monthlyGross ??
      basic +
        Number(structure.hraAllowance || 0) +
        Number(structure.foodAllowance || 0) +
        Number(structure.transportationAllowance || 0) +
        Number(structure.communicationAllowance || 0) +
        Number(structure.mediclaim || 0) +
        Number(structure.schoolFeesAllowance || 0) +
        Number(structure.annualLeaveAllowance || 0) +
        Number(structure.performanceIncentive || 0),
  );

  /* --------------------------------------------------------- earnings -- */
  const earnings = [];

  const pendingDays = Number(pendingSalary.days || 0);
  const pendingPerDay = pendingSalary.perDay ?? monthlyGross / 30;
  const pendingAmount = pendingSalary.amount ?? pendingPerDay * pendingDays;

  if (pendingAmount > 0) {
    earnings.push(
      line(SETTLEMENT_COMPONENT.PENDING_SALARY, 'Pending salary', pendingAmount, {
        days: pendingDays,
        perDay: roundToCurrency(pendingPerDay),
      }),
    );
  }

  const encashment = calculateLeaveEncashment({
    encashableDays: leave.encashableDays ?? 0,
    basic,
    monthlyGross,
    rules,
  });

  if (encashment.amount > 0) {
    earnings.push(
      line(SETTLEMENT_COMPONENT.LEAVE_ENCASHMENT, 'Leave encashment', encashment.amount, encashment),
    );
  }

  const severance = calculateSeverance({ basic, service, trigger, rules });
  if (severance.amount > 0) {
    earnings.push(line(SETTLEMENT_COMPONENT.SEVERANCE_PAY, 'Severance pay', severance.amount, severance));
  }

  const noticeResult = calculateNotice({
    ...notice,
    monthlyGross,
    basic,
    trigger,
    rules,
  });

  if (noticeResult.direction === 'PAYABLE') {
    earnings.push(
      line(SETTLEMENT_COMPONENT.NOTICE_PAY, 'Notice pay in lieu', noticeResult.amount, noticeResult),
    );
  }

  if (extras.bonus > 0) earnings.push(line(SETTLEMENT_COMPONENT.BONUS, 'Bonus', extras.bonus));
  if (extras.incentive > 0) earnings.push(line(SETTLEMENT_COMPONENT.INCENTIVE, 'Incentive', extras.incentive));
  if (extras.arrears > 0) earnings.push(line(SETTLEMENT_COMPONENT.ARREARS, 'Arrears', extras.arrears));
  if (extras.reimbursement > 0) {
    earnings.push(line(SETTLEMENT_COMPONENT.REIMBURSEMENT, 'Reimbursements', extras.reimbursement));
  }

  (extras.otherEarnings ?? []).forEach((entry) => {
    if (entry.amount > 0) {
      earnings.push(line(SETTLEMENT_COMPONENT.OTHER_EARNING, entry.label ?? 'Other earning', entry.amount));
    }
  });

  /* ------------------------------------------------------- deductions -- */
  const deductions = [];

  if (noticeResult.direction === 'RECOVERABLE') {
    deductions.push(
      line(SETTLEMENT_COMPONENT.NOTICE_RECOVERY, 'Notice period recovery', noticeResult.amount, noticeResult),
    );
  }

  const loanTotal = loans.reduce((sum, loan) => sum + Number(loan.outstanding || 0), 0);
  if (loanTotal > 0) {
    // The whole outstanding balance falls due at exit -- there are no further
    // payslips to recover an EMI from.
    deductions.push(
      line(SETTLEMENT_COMPONENT.LOAN_RECOVERY, 'Loan recovery', loanTotal, {
        breakup: loans.map((loan) => ({
          loanId: loan.loanId,
          loanNumber: loan.loanNumber,
          amount: roundToCurrency(loan.outstanding),
        })),
      }),
    );
  }

  const advanceTotal = advances.reduce((sum, advance) => sum + Number(advance.outstanding || 0), 0);
  if (advanceTotal > 0) {
    deductions.push(
      line(SETTLEMENT_COMPONENT.ADVANCE_RECOVERY, 'Advance recovery', advanceTotal, {
        breakup: advances.map((advance) => ({
          advanceId: advance.advanceId,
          reference: advance.reference,
          amount: roundToCurrency(advance.outstanding),
        })),
      }),
    );
  }

  const assetTotal = assets.reduce((sum, asset) => sum + Number(asset.recoveryAmount || 0), 0);
  if (assetTotal > 0) {
    deductions.push(
      line(SETTLEMENT_COMPONENT.ASSET_RECOVERY, 'Unreturned asset recovery', assetTotal, {
        breakup: assets.map((asset) => ({
          assetId: asset.assetId,
          assetCode: asset.assetCode,
          name: asset.name,
          amount: roundToCurrency(asset.recoveryAmount),
        })),
      }),
    );
  }

  const excessDays = Number(leave.excessDays || 0);
  if (excessDays > 0) {
    // Recovered at the same daily rate leave is paid at, so taking a day and
    // cashing a day are worth the same amount rather than one being cheaper.
    const perDay = monthlyGross / 30;
    deductions.push(
      line(SETTLEMENT_COMPONENT.EXCESS_LEAVE, 'Excess leave taken', perDay * excessDays, {
        days: excessDays,
        perDay: roundToCurrency(perDay),
      }),
    );
  }

  if (extras.paye > 0) deductions.push(line(SETTLEMENT_COMPONENT.PAYE, 'PAYE', extras.paye));

  (extras.otherDeductions ?? []).forEach((entry) => {
    if (entry.amount > 0) {
      deductions.push(line(SETTLEMENT_COMPONENT.OTHER_DEDUCTION, entry.label ?? 'Other deduction', entry.amount));
    }
  });

  /* ------------------------------------------------------------ totals -- */
  const totalEarnings = roundToCurrency(earnings.reduce((sum, entry) => sum + entry.amount, 0));
  const totalDeductions = roundToCurrency(deductions.reduce((sum, entry) => sum + entry.amount, 0));
  const net = roundToCurrency(totalEarnings - totalDeductions);

  return {
    earnings,
    deductions,
    totalEarnings,
    totalDeductions,
    // Signed on purpose. Unlike a payslip, a settlement legitimately goes
    // negative -- an employee leaving with an outstanding loan owes the
    // company, and flooring that to zero would silently forgive the debt.
    netSettlement: net,
    payableTo: net >= 0 ? 'EMPLOYEE' : 'COMPANY',
    recoverableAmount: net < 0 ? Math.abs(net) : 0,

    breakdown: {
      service,
      severance,
      notice: noticeResult,
      leaveEncashment: encashment,
      monthlyGross: roundToCurrency(monthlyGross),
      basic: roundToCurrency(basic),
    },
  };
};

export default {
  DEFAULT_SETTLEMENT_RULES,
  ANNUAL_LEAVE_ENTITLEMENT_DAYS,
  calculateService,
  calculateSeverance,
  calculateNotice,
  calculateLeaveEncashment,
  buildSettlementSheet,
};
