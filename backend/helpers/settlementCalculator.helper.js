import { SETTLEMENT_COMPONENT, SETTLEMENT_TRIGGER } from '../utils/constants.js';
import { roundToRupee } from './statutory.helper.js';

/**
 * Full and final settlement calculation.
 *
 * Pure, like the payroll and attendance engines: everything it needs is passed
 * in, so a settlement can be recomputed from its stored inputs years later and
 * produce the same figure. Exit money is disputed more often than monthly pay,
 * and "show me how you arrived at that" has to be answerable.
 */

export const DEFAULT_SETTLEMENT_RULES = {
  gratuity: {
    enabled: true,
    // Payment of Gratuity Act: five years' continuous service.
    minimumYears: 5,
    // 15 days' wages for every completed year, on a 26-day month.
    daysPerYear: 15,
    monthDays: 26,
    // Statutory ceiling; configurable because it is revised periodically.
    maxAmount: 2_000_000,
    // Service beyond six months in the final year counts as a full year.
    roundUpFromMonths: 6,
    // Wages for gratuity are Basic + DA, not gross.
    includeDaInWages: true,
    // Death and permanent disability are payable regardless of tenure.
    waiveMinimumOnDeath: true,
  },
  notice: {
    // Per-day basis for both pay in lieu and shortfall recovery.
    perDayBasis: 'GROSS', // 'GROSS' | 'BASIC_DA'
    monthDays: 30,
  },
  leaveEncashment: {
    enabled: true,
    perDayBasis: 'BASIC_DA',
    monthDays: 30,
    maxDays: 60,
  },
};

const line = (code, label, amount, meta = null) => ({
  code,
  label,
  amount: roundToRupee(amount),
  ...(meta ? { meta } : {}),
});

/* -------------------------------------------------------------------------- */
/*                                  Service                                   */
/* -------------------------------------------------------------------------- */

/**
 * Completed years of service, with the part-year rounded per policy.
 *
 * Returns the raw figures too, because a gratuity dispute is almost always
 * about the boundary -- "four years and seven months" either is or is not five
 * years depending on a rule the employee is entitled to see.
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
    // The figure gratuity multiplies by.
    completedYears: months >= roundUpFromMonths ? years + 1 : years,
  };
};

/* -------------------------------------------------------------------------- */
/*                                  Gratuity                                  */
/* -------------------------------------------------------------------------- */

/**
 * Gratuity: (Basic + DA) x 15/26 x completed years.
 *
 * The 26 is not a mistake -- the Act treats a month as 26 working days, so the
 * daily wage is deliberately higher than a calendar-day rate. Using 30 here is
 * a common and expensive error.
 */
export const calculateGratuity = ({ basic, da = 0, service, trigger, rules = DEFAULT_SETTLEMENT_RULES }) => {
  const config = rules.gratuity ?? DEFAULT_SETTLEMENT_RULES.gratuity;

  const result = {
    eligible: false,
    amount: 0,
    completedYears: service.completedYears,
    wages: 0,
    reason: null,
  };

  if (!config.enabled) {
    result.reason = 'Gratuity is disabled in settlement rules';
    return result;
  }

  const waived = config.waiveMinimumOnDeath && trigger === SETTLEMENT_TRIGGER.DEATH;

  if (!waived && service.completedYears < config.minimumYears) {
    result.reason = `Requires ${config.minimumYears} years of service; completed ${service.years}y ${service.months}m`;
    return result;
  }

  const wages = Number(basic || 0) + (config.includeDaInWages ? Number(da || 0) : 0);
  const raw = (wages * config.daysPerYear * service.completedYears) / config.monthDays;

  result.eligible = true;
  result.wages = roundToRupee(wages);
  result.amount = roundToRupee(Math.min(raw, config.maxAmount));
  result.cappedAt = raw > config.maxAmount ? config.maxAmount : null;
  result.reason = waived ? 'Minimum service waived (death in service)' : null;

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
  basicDa,
  trigger,
  employerWaived = false,
  rules = DEFAULT_SETTLEMENT_RULES,
}) => {
  const config = rules.notice ?? DEFAULT_SETTLEMENT_RULES.notice;
  const base = config.perDayBasis === 'BASIC_DA' ? Number(basicDa || 0) : Number(monthlyGross || 0);
  const perDay = base / (config.monthDays || 30);

  const shortfall = Math.max(0, Number(requiredDays) - Number(servedDays) - Number(waivedDays));

  // Termination and death are the employer's decision or nobody's; recovering
  // notice from either is not defensible.
  const employerInitiated = [SETTLEMENT_TRIGGER.TERMINATION, SETTLEMENT_TRIGGER.DEATH].includes(trigger);

  if (employerInitiated && shortfall > 0) {
    return {
      direction: 'PAYABLE',
      days: shortfall,
      perDay: roundToRupee(perDay),
      amount: roundToRupee(perDay * shortfall),
      reason: 'Pay in lieu of notice (employer-initiated exit)',
    };
  }

  if (employerWaived || shortfall === 0) {
    return {
      direction: 'NONE',
      days: 0,
      perDay: roundToRupee(perDay),
      amount: 0,
      reason: employerWaived ? 'Notice period waived by the employer' : 'Full notice served',
    };
  }

  return {
    direction: 'RECOVERABLE',
    days: shortfall,
    perDay: roundToRupee(perDay),
    amount: roundToRupee(perDay * shortfall),
    reason: `${shortfall} day(s) of notice not served`,
  };
};

/* -------------------------------------------------------------------------- */
/*                              Leave encashment                              */
/* -------------------------------------------------------------------------- */

export const calculateLeaveEncashment = ({
  encashableDays = 0,
  basicDa,
  monthlyGross,
  rules = DEFAULT_SETTLEMENT_RULES,
}) => {
  const config = rules.leaveEncashment ?? DEFAULT_SETTLEMENT_RULES.leaveEncashment;

  if (!config.enabled || encashableDays <= 0) {
    return { days: 0, perDay: 0, amount: 0 };
  }

  const base = config.perDayBasis === 'GROSS' ? Number(monthlyGross || 0) : Number(basicDa || 0);
  const perDay = base / (config.monthDays || 30);
  const days = Math.min(Number(encashableDays), config.maxDays ?? Number(encashableDays));

  return {
    days,
    perDay: roundToRupee(perDay),
    amount: roundToRupee(perDay * days),
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
 * @param {object} input.structure   { basic, da, hra, specialAllowance, monthlyGross }
 * @param {object} input.service     From calculateService
 * @param {string} input.trigger
 * @param {object} input.pendingSalary { days, perDay, amount } - unpaid days to LWD
 * @param {object} input.notice
 * @param {object} input.leave       { encashableDays, excessDays }
 * @param {Array}  input.loans       [{ loanId, loanNumber, outstanding }]
 * @param {Array}  input.advances    [{ advanceId, reference, outstanding }]
 * @param {Array}  input.assets      [{ assetId, assetCode, name, recoveryAmount }]
 * @param {object} input.extras      { bonus, incentive, arrears, reimbursement, otherEarnings[], otherDeductions[], tds }
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
  const da = Number(structure.da || 0);
  const basicDa = basic + da;
  const monthlyGross =
    Number(structure.monthlyGross ?? basic + da + Number(structure.hra || 0) + Number(structure.specialAllowance || 0));

  /* --------------------------------------------------------- earnings -- */
  const earnings = [];

  const pendingDays = Number(pendingSalary.days || 0);
  const pendingPerDay = pendingSalary.perDay ?? monthlyGross / 30;
  const pendingAmount = pendingSalary.amount ?? pendingPerDay * pendingDays;

  if (pendingAmount > 0) {
    earnings.push(
      line(SETTLEMENT_COMPONENT.PENDING_SALARY, 'Pending salary', pendingAmount, {
        days: pendingDays,
        perDay: roundToRupee(pendingPerDay),
      }),
    );
  }

  const encashment = calculateLeaveEncashment({
    encashableDays: leave.encashableDays ?? 0,
    basicDa,
    monthlyGross,
    rules,
  });

  if (encashment.amount > 0) {
    earnings.push(
      line(SETTLEMENT_COMPONENT.LEAVE_ENCASHMENT, 'Leave encashment', encashment.amount, encashment),
    );
  }

  const gratuity = calculateGratuity({ basic, da, service, trigger, rules });
  if (gratuity.amount > 0) {
    earnings.push(line(SETTLEMENT_COMPONENT.GRATUITY, 'Gratuity', gratuity.amount, gratuity));
  }

  const noticeResult = calculateNotice({
    ...notice,
    monthlyGross,
    basicDa,
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
          amount: roundToRupee(loan.outstanding),
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
          amount: roundToRupee(advance.outstanding),
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
          amount: roundToRupee(asset.recoveryAmount),
        })),
      }),
    );
  }

  const excessDays = Number(leave.excessDays || 0);
  if (excessDays > 0) {
    const perDay = basicDa / 30;
    deductions.push(
      line(SETTLEMENT_COMPONENT.EXCESS_LEAVE, 'Excess leave taken', perDay * excessDays, {
        days: excessDays,
        perDay: roundToRupee(perDay),
      }),
    );
  }

  if (extras.tds > 0) deductions.push(line(SETTLEMENT_COMPONENT.TDS, 'Income tax (TDS)', extras.tds));

  (extras.otherDeductions ?? []).forEach((entry) => {
    if (entry.amount > 0) {
      deductions.push(line(SETTLEMENT_COMPONENT.OTHER_DEDUCTION, entry.label ?? 'Other deduction', entry.amount));
    }
  });

  /* ------------------------------------------------------------ totals -- */
  const totalEarnings = roundToRupee(earnings.reduce((sum, entry) => sum + entry.amount, 0));
  const totalDeductions = roundToRupee(deductions.reduce((sum, entry) => sum + entry.amount, 0));
  const net = roundToRupee(totalEarnings - totalDeductions);

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
      gratuity,
      notice: noticeResult,
      leaveEncashment: encashment,
      monthlyGross: roundToRupee(monthlyGross),
      basicDa: roundToRupee(basicDa),
    },
  };
};

export default {
  DEFAULT_SETTLEMENT_RULES,
  calculateService,
  calculateGratuity,
  calculateNotice,
  calculateLeaveEncashment,
  buildSettlementSheet,
};
