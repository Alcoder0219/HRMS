/**
 * Hourly salary and overtime rate.
 *
 * The divisor is the payroll month's own length:
 *
 *   hourly salary = monthly gross / (days in the payroll month x 8)
 *   overtime rate = hourly salary x the selected multiplier
 *
 * It replaces a fixed 240 hours, which quietly overpaid every short month and
 * underpaid every long one -- August and February were priced identically
 * despite being three days apart.
 *
 * Kept in one file because three callers need the same answer: the Employee
 * Master (which shows the figure), the payroll run (which pays it) and the
 * browser form (which previews it as you type). A month-dependent rate is easy
 * to get subtly out of step, so nothing recomputes it locally.
 */

/** A full working day. The one constant in the formula. */
export const STANDARD_DAILY_WORKING_HOURS = 8;

/**
 * How many days the payroll month actually has.
 *
 * Day 0 of the following month is the last day of this one, which is the
 * standard Date trick and handles leap years without a table: February 2027
 * gives 28 and February 2028 gives 29.
 *
 * `month` is 1-12, matching every payroll period in the product.
 */
export const daysInPayrollMonth = (year, month) => {
  const numericYear = Number(year);
  const numericMonth = Number(month);

  if (!Number.isInteger(numericYear) || !Number.isInteger(numericMonth) || numericMonth < 1 || numericMonth > 12) {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  }

  return new Date(numericYear, numericMonth, 0).getDate();
};

/** The month's working hours: its days times a standard eight-hour day. */
export const monthlyWorkingHours = (year, month) =>
  daysInPayrollMonth(year, month) * STANDARD_DAILY_WORKING_HOURS;

/** The period to price against when no payroll month is in hand. */
export const currentPeriod = () => {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
};

/**
 * The divisor for one employee in one month.
 *
 * An employee carrying an explicit `workingHoursPerMonth` keeps it: the field
 * exists for someone who genuinely does not work a standard month, such as a
 * part-timer, and silently overriding a figure an administrator typed would be
 * worse than honouring it. Everyone else -- which is every current employee,
 * the field defaults to null -- is priced on the month's own length.
 */
export const workingHoursFor = (overtime, year, month) =>
  Number(overtime?.workingHoursPerMonth) || monthlyWorkingHours(year, month);

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

/**
 * Hourly salary for a given gross and payroll month.
 *
 * Returns the unrounded figure alongside the rounded one so a caller that
 * needs to explain itself can show the same number it used.
 */
export const hourlySalaryFor = ({ grossSalary, year, month, overtime = null }) => {
  const hours = workingHoursFor(overtime, year, month);
  if (!hours) return { hourlySalary: 0, hours: 0, days: daysInPayrollMonth(year, month) };

  return {
    hourlySalary: round2((Number(grossSalary) || 0) / hours),
    hours,
    days: daysInPayrollMonth(year, month),
  };
};

export default {
  STANDARD_DAILY_WORKING_HOURS,
  daysInPayrollMonth,
  monthlyWorkingHours,
  currentPeriod,
  workingHoursFor,
  hourlySalaryFor,
};
