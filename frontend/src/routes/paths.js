/**
 * Canonical route table. Nothing in the app writes a URL string literally --
 * navigation, breadcrumbs, sidebar items and guards all resolve through here,
 * so a renamed path cannot leave dead links behind.
 *
 * The original flat keys are kept exactly as they were. Everything added for
 * the full module map is additive, so no existing screen had to be touched.
 */
export const PATHS = {
  root: '/',

  auth: {
    root: '/auth',
    login: '/auth/login',
    forgotPassword: '/auth/forgot-password',
    resetPassword: '/auth/reset-password',
    verifyEmail: '/auth/verify-email',
  },

  dashboard: '/dashboard',

  // The one authenticated screen an account on a temporary password may open.
  changePassword: '/account/password',

  employees: '/employees',
  employeeNew: '/employees/new',
  // Functions rather than template literals at the call site: the id is
  // interpolated in exactly one place, so an encoding change lands once.
  employeeDetail: (id) => `/employees/${id}`,
  employeeEdit: (id) => `/employees/${id}/edit`,
  employeeAssets: '/employees/assets',
  employeeDocuments: '/employees/documents',
  employeeTransfers: '/employees/transfers',
  employeePromotions: '/employees/promotions',

  organization: '/organization',
  units: '/organization/units',
  departments: '/organization/departments',
  designations: '/organization/designations',
  grades: '/organization/grades',
  shifts: '/organization/shifts',
  holidays: '/organization/holidays',

  attendance: '/attendance',
  attendanceRegister: '/attendance/register',
  attendanceMonthly: '/attendance/monthly',
  attendanceRegularization: '/attendance/regularization',
  attendanceImport: '/attendance/import',
  attendancePolicy: '/attendance/policy',
  attendanceCompOff: '/attendance/comp-off',
  attendanceReports: '/attendance/reports',
  attendanceBiometric: '/attendance/biometric',
  attendanceHistory: '/attendance/history',

  leave: '/leave',
  leaveTypes: '/leave/types',
  leaveBalance: '/leave/balance',
  leaveApproval: '/leave/approval',

  payroll: '/payroll',
  salaryStructures: '/payroll/structures',
  salaryTemplates: '/payroll/templates',
  payrollRuns: '/payroll/runs',
  payrollRunDetail: (id) => `/payroll/runs/${id}`,
  payslips: '/payroll/payslips',
  settlements: '/payroll/settlements',
  loans: '/payroll/loans',
  bonus: '/payroll/bonus',
  overtime: '/payroll/overtime',

  recruitment: '/recruitment',
  jobOpenings: '/recruitment/jobs',
  candidates: '/recruitment/candidates',
  interviews: '/recruitment/interviews',
  offerLetters: '/recruitment/offers',
  hiringReports: '/recruitment/reports',

  performance: '/performance',
  documents: '/documents',

  reports: '/reports',
  // Every report is the same screen driven by a server-side descriptor, so one
  // parameterised path covers all of them. The named entries below are what the
  // sidebar links to; they are the same route.
  report: (slug) => `/reports/${slug}`,
  employeeReports: '/reports/employees',
  attendanceModuleReports: '/reports/attendance',
  leaveReports: '/reports/leave',
  payrollReports: '/reports/payroll',
  recruitmentReports: '/reports/recruitment',
  assetReports: '/reports/assets',
  loanReports: '/reports/loans',
  settlementReports: '/reports/settlements',
  // The PF/ESI register and cost analysis: a legal document rather than an
  // analytics view, so it keeps a screen of its own.
  payrollStatutoryReports: '/reports/payroll/statutory',

  admin: '/administration',
  users: '/administration/users',
  roles: '/administration/roles',
  permissions: '/administration/permissions',
  loginHistory: '/administration/login-history',
  auditLogs: '/administration/audit-logs',
  activityLogs: '/administration/activity',
  settings: '/administration/settings',
  companyProfile: '/administration/company',
  emailConfiguration: '/administration/email',
  notificationSettings: '/administration/notifications',
  backupRestore: '/administration/backup',

  errors: {
    forbidden: '/403',
    notFound: '/404',
  },
};

export default PATHS;
