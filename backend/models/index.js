/**
 * Model registry.
 *
 * Mongoose resolves `ref` strings against a global registry, and a schema is
 * only added to it when its module is first imported. A model that nothing
 * imports directly -- Shift, referenced only through `populate` -- would
 * therefore fail at runtime with "Schema hasn't been registered".
 *
 * Importing this barrel once at boot registers everything up front, so
 * population never depends on which module happened to be loaded first.
 */

export { default as User } from './auth/user.model.js';
export { default as RefreshToken } from './auth/refreshToken.model.js';
export { default as LoginHistory } from './auth/loginHistory.model.js';
export { default as VerificationToken } from './auth/verificationToken.model.js';

export { default as Department } from './organization/department.model.js';
export { default as Designation } from './organization/designation.model.js';
export { default as Shift } from './organization/shift.model.js';
export { default as Unit } from './organization/unit.model.js';
export { default as Grade } from './organization/grade.model.js';
export { default as SalaryTemplate } from './organization/salaryTemplate.model.js';

export { default as Employee } from './employee/employee.model.js';
export { default as Asset } from './employee/asset.model.js';

export { default as Attendance } from './attendance/attendance.model.js';
export { default as AttendanceSheet } from './attendance/attendanceSheet.model.js';
export { default as AttendancePolicy } from './attendance/attendancePolicy.model.js';
export { default as Holiday } from './attendance/holiday.model.js';
export { default as Regularization } from './attendance/regularization.model.js';
export { default as CompOff } from './attendance/compOff.model.js';

/**
 * Registered here as much as anywhere: `compOff.leaveRequestId` has carried a
 * `ref: 'LeaveRequest'` since the attendance module was built, pointing at a
 * model that did not exist. Populating it would have thrown.
 */
export { default as JobOpening } from './recruitment/jobOpening.model.js';
export { default as Candidate } from './recruitment/candidate.model.js';
export { default as Interview } from './recruitment/interview.model.js';
export { default as Offer } from './recruitment/offer.model.js';

export { default as LeaveType } from './leave/leaveType.model.js';
export { default as LeaveBalance } from './leave/leaveBalance.model.js';
export { default as LeaveRequest } from './leave/leaveRequest.model.js';

export { default as SalaryStructure } from './payroll/salaryStructure.model.js';
export { default as PayrollSettings } from './payroll/payrollSettings.model.js';
export { default as PayrollRun } from './payroll/payrollRun.model.js';
export { default as Payslip } from './payroll/payslip.model.js';
export { default as Loan } from './payroll/loan.model.js';
export { default as Settlement } from './payroll/settlement.model.js';

export { default as AuditLog } from './audit/auditLog.model.js';

export { default as AppSettings } from './admin/appSettings.model.js';
