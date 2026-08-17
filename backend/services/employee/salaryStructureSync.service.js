import logger from '../../config/logger.js';
import SalaryStructure from '../../models/payroll/salaryStructure.model.js';
import { resolveMultiplier } from '../../models/employee/employee.model.js';
import { COMPONENT_CODE } from '../../utils/constants.js';

/**
 * Projects an employee's salary onto the effective-dated row payroll reads.
 *
 * The Employee Master stores pay as an embedded `salaryStructure` sub-document
 * on the employee. Payroll reads a separate `salarystructures` collection,
 * because a payslip has to name the exact figures it was priced from years
 * later and an embedded document only ever holds today's. Nothing connected
 * the two, so an employee could have a complete salary on screen and payroll
 * would report "no salary structure in force" -- and where both existed they
 * had drifted apart, which is worse, because two answers were on file and
 * nothing said which was authoritative.
 *
 * The Employee Master is the source of truth. This runs on every save and
 * writes the projection; nothing is entered twice and no screen needs a manual
 * step.
 *
 * Deliberately update-in-place rather than a new revision per edit. Correcting
 * a typo in an allowance is not a pay revision, and a row per keystroke would
 * bury the real revisions. Historical payslips are unaffected either way: each
 * one stores its own `structureSnapshot` at the moment it was generated, so
 * they remain reproducible without depending on this row.
 */

/** Zero rather than NaN, so a blank component can never poison a total. */
const amount = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : 0;
};

/**
 * Midnight UTC, which is how every effective date in payroll is stored.
 *
 * Normalising in local time instead walked dates backwards: a 1 June effective
 * date arrives as `2025-06-01T00:00:00Z`, and local midnight in a +05:30 zone
 * is `2025-05-31T18:30:00Z` -- a day earlier, every time the record was saved.
 * Reading and writing in UTC makes this idempotent, which matters because it
 * runs on every employee update.
 */
const atUtcMidnight = (value) => {
  const date = new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
};

/**
 * The employee's six earning components mapped onto the payroll structure's
 * four plus a list.
 *
 * Conveyance, medical and other have no dedicated column on the payroll side,
 * so they become `otherAllowances` entries. That is what keeps the two grosses
 * identical: the structure's `grossMonthly` virtual sums basic, hra, da,
 * special and every allowance in the list, which is exactly the employee's
 * gross once these three are carried across. Dropping them would have
 * under-priced every payslip by their total.
 */
const componentsOf = (salary) => {
  const otherAllowances = [
    { label: 'Conveyance Allowance', amount: amount(salary.conveyanceAllowance) },
    { label: 'Medical Allowance', amount: amount(salary.medicalAllowance) },
    { label: 'Other Allowance', amount: amount(salary.otherAllowance) },
  ]
    .filter((entry) => entry.amount > 0)
    .map((entry) => ({ ...entry, code: COMPONENT_CODE.OTHER_ALLOWANCE, prorate: true, taxable: true }));

  return {
    basic: amount(salary.basic),
    hra: amount(salary.hra),
    // The Employee Master has no dearness allowance field. Left at zero rather
    // than invented, and it is not part of its gross either.
    da: 0,
    specialAllowance: amount(salary.specialAllowance),
    otherAllowances,
  };
};

/**
 * Whether this employee has enough of a salary to project at all.
 *
 * `basic` is required on the payroll structure, and a row with a zero basic
 * would be a structure that pays nothing -- worse than none, because payroll
 * would include the person and issue an empty payslip instead of reporting
 * them as unpriced.
 */
export const hasSalary = (employee) => amount(employee?.salaryStructure?.basic) > 0;

/**
 * Finds the row this employee's salary already maps to.
 *
 * Three ways in, most specific first: the explicit back-reference, then the
 * row with the same effective date, then whichever revision is currently open.
 * Anything less and a second save would create a duplicate revision rather
 * than update the first.
 */
const findExisting = async (employee, effectiveFrom) => {
  const linkedId = employee.salaryStructure?.structureId;
  if (linkedId) {
    const linked = await SalaryStructure.findById(linkedId);
    if (linked && String(linked.employeeId) === String(employee._id)) return linked;
  }

  const sameDate = await SalaryStructure.findOne({ employeeId: employee._id, effectiveFrom });
  if (sameDate) return sameDate;

  return SalaryStructure.findOne({ employeeId: employee._id, effectiveTo: null }).sort({ effectiveFrom: -1 });
};

/**
 * Creates or updates the employee's salary structure from their master record.
 *
 * Returns the structure, or null when there is nothing to project. Never
 * throws into the caller's path: a projection failure must not lose an
 * employee edit that has already been accepted and audited.
 */
export const syncSalaryStructure = async (employee, req = null) => {
  try {
    if (!employee || !hasSalary(employee)) return null;

    const salary = employee.salaryStructure ?? {};
    const components = componentsOf(salary);

    /**
     * Monthly CTC is the components' own total.
     *
     * That is the payroll module's existing invariant -- `createStructure`
     * refuses a structure whose components disagree with its CTC by more than
     * a rupee -- and it is also the Employee Master's definition: the six
     * earning components sum to the cost to company, from which the employer's
     * own PF, ESI and LWF are removed to state gross. The two modules agree on
     * this figure, so a structure projected from an employee needs no
     * reconciliation.
     */
    const monthlyCtc = Math.round(
      components.basic +
        components.hra +
        components.da +
        components.specialAllowance +
        components.otherAllowances.reduce((sum, entry) => sum + entry.amount, 0),
    );

    const existing = await findExisting(
      employee,
      atUtcMidnight(salary.effectiveFrom ?? employee.joiningDate ?? new Date()),
    );

    /**
     * An existing row keeps its own effective date, byte for byte.
     *
     * Normalising it would re-interpret a stored UTC midnight as a local one
     * and walk the date backwards a day on the first save -- a revision dated
     * 1 January would start showing as 31 December, and the row payroll picks
     * for a period boundary would change underneath it. Only a date the
     * Employee Master actually supplies, or a fresh one, is normalised.
     */
    const effectiveFrom = salary.effectiveFrom
      ? atUtcMidnight(salary.effectiveFrom)
      : (existing?.effectiveFrom ?? atUtcMidnight(employee.joiningDate ?? new Date()));

    const multiplier = resolveMultiplier(
      employee.overtime?.multiplier,
      employee.overtime?.customMultiplier,
      2,
    );

    const projection = {
      ...components,
      tenantId: employee.tenantId ?? null,
      employeeId: employee._id,
      effectiveFrom,
      monthlyCtc,
      annualCtc: monthlyCtc * 12,
      overtimeEligible: Boolean(employee.overtimeEligible ?? employee.overtime?.eligible),
      // The schema bounds this at 4; a custom multiplier above that would fail
      // validation and take the whole employee save down with it.
      overtimeMultiplier: Math.min(Math.max(Number(multiplier) || 2, 1), 4),
      isActive: true,
      updatedBy: req?.user?.id ?? null,
    };

    let structure;

    if (existing) {
      // Statutory applicability is a payroll decision, not an Employee Master
      // one, so whatever finance set on the row stays set.
      Object.assign(existing, projection);
      structure = await existing.save();
    } else {
      structure = await SalaryStructure.create({
        ...projection,
        revisionReason: 'Created from the Employee Master salary',
        createdBy: req?.user?.id ?? null,
      });
    }

    // The back-reference, so the next save finds this row rather than guessing
    // at it. Written straight to the collection to avoid re-entering the
    // employee save that called us.
    if (String(employee.salaryStructure?.structureId ?? '') !== String(structure._id)) {
      await employee.constructor.updateOne(
        { _id: employee._id },
        { $set: { 'salaryStructure.structureId': structure._id } },
      );
    }

    logger.info('Salary structure synced from the Employee Master', {
      employeeId: String(employee._id),
      structureId: String(structure._id),
      monthlyCtc,
      created: !existing,
    });

    return structure;
  } catch (error) {
    logger.error('Could not sync the salary structure from the Employee Master', {
      employeeId: String(employee?._id),
      error: error.message,
    });
    return null;
  }
};

export default { syncSalaryStructure, hasSalary };
