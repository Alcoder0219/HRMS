import Department from '../../models/organization/department.model.js';
import Designation from '../../models/organization/designation.model.js';
import Shift from '../../models/organization/shift.model.js';
import Unit from '../../models/organization/unit.model.js';
import Grade from '../../models/organization/grade.model.js';
import SalaryTemplate from '../../models/organization/salaryTemplate.model.js';
import Employee from '../../models/employee/employee.model.js';
import PayrollSettings from '../../models/payroll/payrollSettings.model.js';
import { ACTIVE_EMPLOYEE_STATUSES, CURRENCY, DEFAULT_MONTHLY_WORKING_HOURS } from '../../utils/constants.js';

/**
 * Read-only masters that other modules pick from.
 *
 * Deliberately narrow: the Organization module proper (hierarchy, cost centres,
 * headcount budgets) owns their management. These exist so the Employee screens
 * have something to populate their dropdowns from.
 */

const listActive = (Model, tenantId, projection) =>
  Model.find({ tenantId: tenantId ?? null, isActive: true }).select(projection).sort({ name: 1 }).lean();

export const listDepartments = (tenantId) => listActive(Department, tenantId, 'name code');

export const listDesignations = (tenantId) => listActive(Designation, tenantId, 'name code level');

export const listShifts = (tenantId) =>
  listActive(Shift, tenantId, 'name code startTime endTime isNightShift');

export const listUnits = (tenantId) =>
  listActive(Unit, tenantId, 'name code city state nssfEmployerCode nhifEmployerCode wcfEmployerCode');

export const listGrades = (tenantId) => listActive(Grade, tenantId, 'name code level minGross maxGross');

export const listSalaryTemplates = (tenantId) =>
  listActive(
    SalaryTemplate,
    tenantId,
    'name code hraPercent transportationPercent communicationPercent annualLeavePercent ' +
      'foodAllowanceAmount mediclaimAmount schoolFeesAllowanceAmount ' +
      'nssfApplicable nhifApplicable payeApplicable isDefault',
  );

/**
 * Candidate reporting managers.
 *
 * Currently-employed people only -- offering someone who has left as a manager
 * produces a reporting line that breaks the moment approvals walk it.
 */
export const listReportingManagers = (tenantId) =>
  Employee.find({
    tenantId: tenantId ?? null,
    deletedAt: null,
    status: { $in: ACTIVE_EMPLOYEE_STATUSES },
  })
    .select('employeeCode employeeId firstName middleName lastName designationId')
    .populate({ path: 'designationId', select: 'name' })
    .sort({ employeeCode: 1 })
    .limit(1000)
    .lean();

/**
 * One round trip for a form that needs every picker at once.
 *
 * The original three keys are returned unchanged; the rest are additive, so a
 * client built against the earlier shape keeps working.
 */
export const listAllMasters = async (tenantId) => {
  const [departments, designations, shifts, units, grades, salaryTemplates, reportingManagers, settings] =
    await Promise.all([
      listDepartments(tenantId),
      listDesignations(tenantId),
      listShifts(tenantId),
      listUnits(tenantId),
      listGrades(tenantId),
      listSalaryTemplates(tenantId),
      listReportingManagers(tenantId),
      PayrollSettings.findOne({ tenantId: tenantId ?? null })
        .select('monthlyWorkingHours overtimeMultiplier currency')
        .lean(),
    ]);

  return {
    departments,
    designations,
    shifts,
    units,
    grades,
    salaryTemplates,
    reportingManagers,
    /**
     * A deliberately narrow read-only projection of payroll settings.
     *
     * The Employee Master needs the working-hours divisor to show a live
     * hourly rate. Exposing these three values here avoids making the form
     * call the payroll settings API, which requires `payroll:read` -- a
     * permission an HR user editing an employee should not need.
     */
    payrollDefaults: {
      monthlyWorkingHours: settings?.monthlyWorkingHours ?? DEFAULT_MONTHLY_WORKING_HOURS,
      overtimeMultiplier: settings?.overtimeMultiplier ?? 2,
      currency: settings?.currency ?? CURRENCY.CODE,
    },
  };
};

export default {
  listDepartments,
  listDesignations,
  listShifts,
  listUnits,
  listGrades,
  listSalaryTemplates,
  listReportingManagers,
  listAllMasters,
};
