import { lazy, Suspense } from 'react';
import { Navigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';

import AppLayout from '@layouts/AppLayout.jsx';
import AuthLayout from '@layouts/AuthLayout.jsx';
import RequireAuth from './guards/RequireAuth.jsx';
import RequirePermission from './guards/RequirePermission.jsx';
import RequireScope from './guards/RequireScope.jsx';
import { RESOURCES, ACTIONS } from '@utils/permissions.js';
import { SCOPES } from '@utils/roles.js';
import { PATHS } from './paths.js';

/**
 * The route tree, kept separate from the router it is handed to.
 *
 * `createBrowserRouter` touches the DOM History API at module load, which means
 * importing routes/index.jsx outside a browser fails. Splitting the table out
 * lets a plain Node script import it and assert -- rather than assume -- that
 * every sidebar entry resolves to a real screen. That check is the only honest
 * way to claim "no 404s".
 */

/**
 * Feature screens are lazily imported, so each becomes its own bundle chunk --
 * a user who never opens Payroll never downloads it.
 */
const LoginPage = lazy(() => import('@pages/auth/LoginPage.jsx'));
const ForgotPasswordPage = lazy(() => import('@pages/auth/ForgotPasswordPage.jsx'));
const ResetPasswordPage = lazy(() => import('@pages/auth/ResetPasswordPage.jsx'));
const VerifyEmailPage = lazy(() => import('@pages/auth/VerifyEmailPage.jsx'));
const DashboardPage = lazy(() => import('@pages/dashboard/DashboardPage.jsx'));
const ChangePasswordPage = lazy(() => import('@pages/account/ChangePasswordPage.jsx'));

const EmployeeListPage = lazy(() => import('@pages/employees/EmployeeListPage.jsx'));
const EmployeeFormPage = lazy(() => import('@pages/employees/EmployeeFormPage.jsx'));
const EmployeeDetailPage = lazy(() => import('@pages/employees/EmployeeDetailPage.jsx'));
const EmployeeAssetsPage = lazy(() => import('@pages/employees/EmployeeAssetsPage.jsx'));
const AssetDetailPage = lazy(() => import('@pages/employees/AssetDetailPage.jsx'));
const EmployeeDocumentsPage = lazy(() => import('@pages/employees/EmployeeDocumentsPage.jsx'));
const EmployeeMovementsPage = lazy(() => import('@pages/employees/EmployeeMovementsPage.jsx'));

const MasterListPage = lazy(() => import('@pages/organization/MasterListPage.jsx'));
const MasterDetailPage = lazy(() => import('@pages/organization/MasterDetailPage.jsx'));
const HolidayCalendarPage = lazy(() => import('@pages/organization/HolidayCalendarPage.jsx'));

const MyAttendancePage = lazy(() => import('@pages/attendance/MyAttendancePage.jsx'));
const AttendanceRegisterPage = lazy(() => import('@pages/attendance/AttendanceRegisterPage.jsx'));
const MonthlyAttendancePage = lazy(() => import('@pages/attendance/MonthlyAttendancePage.jsx'));
const RegularizationPage = lazy(() => import('@pages/attendance/RegularizationPage.jsx'));
const AttendanceImportPage = lazy(() => import('@pages/attendance/AttendanceImportPage.jsx'));
const AttendancePolicyPage = lazy(() => import('@pages/attendance/AttendancePolicyPage.jsx'));
const CompOffPage = lazy(() => import('@pages/attendance/CompOffPage.jsx'));
const AttendanceReportsPage = lazy(() => import('@pages/attendance/AttendanceReportsPage.jsx'));
const AttendanceHistoryPage = lazy(() => import('@pages/attendance/AttendanceHistoryPage.jsx'));
const BiometricImportPage = lazy(() => import('@pages/attendance/BiometricImportPage.jsx'));

const SalaryStructuresPage = lazy(() => import('@pages/payroll/SalaryStructuresPage.jsx'));
const SalaryTemplatesPage = lazy(() => import('@pages/payroll/SalaryTemplatesPage.jsx'));
const PayrollRunsPage = lazy(() => import('@pages/payroll/PayrollRunsPage.jsx'));
const PayrollRunDetailPage = lazy(() => import('@pages/payroll/PayrollRunDetailPage.jsx'));
const PayslipsPage = lazy(() => import('@pages/payroll/PayslipsPage.jsx'));
const PayslipDetailPage = lazy(() => import('@pages/payroll/PayslipDetailPage.jsx'));
const LoansPage = lazy(() => import('@pages/payroll/LoansPage.jsx'));
const LoanDetailPage = lazy(() => import('@pages/payroll/LoanDetailPage.jsx'));
const SettlementsPage = lazy(() => import('@pages/payroll/SettlementsPage.jsx'));
const SettlementDetailPage = lazy(() => import('@pages/payroll/SettlementDetailPage.jsx'));
const BonusPage = lazy(() => import('@pages/payroll/BonusPage.jsx'));
const OvertimePage = lazy(() => import('@pages/payroll/OvertimePage.jsx'));

const LeaveRequestsPage = lazy(() => import('@pages/leave/LeaveRequestsPage.jsx'));
const LeaveTypesPage = lazy(() => import('@pages/leave/LeaveTypesPage.jsx'));
const LeaveBalancePage = lazy(() => import('@pages/leave/LeaveBalancePage.jsx'));
const LeaveApprovalPage = lazy(() => import('@pages/leave/LeaveApprovalPage.jsx'));

const JobOpeningsPage = lazy(() => import('@pages/recruitment/JobOpeningsPage.jsx'));
const CandidatesPage = lazy(() => import('@pages/recruitment/CandidatesPage.jsx'));
const InterviewsPage = lazy(() => import('@pages/recruitment/InterviewsPage.jsx'));
const OffersPage = lazy(() => import('@pages/recruitment/OffersPage.jsx'));
const HiringReportsPage = lazy(() => import('@pages/recruitment/HiringReportsPage.jsx'));

const ReportsHubPage = lazy(() => import('@pages/reports/ReportsHubPage.jsx'));
const ReportViewerPage = lazy(() => import('@pages/reports/ReportViewerPage.jsx'));
const PayrollReportsPage = lazy(() => import('@pages/reports/PayrollReportsPage.jsx'));

const RolesPage = lazy(() => import('@pages/admin/RolesPage.jsx'));
const PermissionsPage = lazy(() => import('@pages/admin/PermissionsPage.jsx'));
const LoginHistoryPage = lazy(() => import('@pages/admin/LoginHistoryPage.jsx'));
const SystemSettingsPage = lazy(() => import('@pages/admin/SystemSettingsPage.jsx'));
const UsersPage = lazy(() => import('@pages/admin/UsersPage.jsx'));
const AuditLogsPage = lazy(() => import('@pages/admin/AuditLogsPage.jsx'));
const ActivityLogsPage = lazy(() => import('@pages/admin/ActivityLogsPage.jsx'));
const CompanyProfilePage = lazy(() => import('@pages/admin/CompanyProfilePage.jsx'));
const EmailConfigurationPage = lazy(() => import('@pages/admin/EmailConfigurationPage.jsx'));
const NotificationSettingsPage = lazy(() => import('@pages/admin/NotificationSettingsPage.jsx'));
const BackupRestorePage = lazy(() => import('@pages/admin/BackupRestorePage.jsx'));

const errorPageModule = () => import('@pages/errors/ErrorPage.jsx');

const Fallback = () => (
  <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '50vh' }}>
    <CircularProgress />
  </Box>
);

const load = (Component, props = {}) => (
  <Suspense fallback={<Fallback />}>
    <Component {...props} />
  </Suspense>
);

/**
 * Every navigation entry now resolves to a real screen.
 *
 * There used to be a generated route per PLANNED sidebar item, pointing at a
 * "coming soon" page, so that a menu entry without an API did not fall through
 * to the 404. Nothing is planned any more -- the filter returns an empty list
 * and the page it rendered has been deleted. The invariant it protected is now
 * enforced directly by the route check, which asserts that every sidebar path
 * matches a route and that none of them lands on the catch-all.
 */

export const ROUTES = [
  {
    path: PATHS.root,
    element: <Navigate to={PATHS.dashboard} replace />,
  },

  /* ------------------------------------------------------------- public -- */
  {
    element: <AuthLayout />,
    children: [
      { path: PATHS.auth.login, element: load(LoginPage) },
      // The last three are the targets of links the API emails out. Until they
      // existed, every password-reset and verification link landed on the 404.
      { path: PATHS.auth.forgotPassword, element: load(ForgotPasswordPage) },
      { path: PATHS.auth.resetPassword, element: load(ResetPasswordPage) },
      { path: PATHS.auth.verifyEmail, element: load(VerifyEmailPage) },
    ],
  },

  /* ------------------------------------------------------ authenticated -- */
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: PATHS.dashboard, element: load(DashboardPage) },

          // No permission gate: changing your own password is not a privilege,
          // and an account forced onto this screen holds no grants it could be
          // checked against anyway.
          { path: PATHS.changePassword, element: load(ChangePasswordPage) },

          /* ------------------------------------------------ organization -- */
          {
            element: <RequirePermission resource={RESOURCES.ORGANIZATION} action={ACTIONS.READ} />,
            children: [
              // One list component and one detail component, five
              // configurations. The masters differ only in their columns and
              // their form fields, so they share screens rather than each
              // carrying a near-identical pair of files.
              { path: PATHS.units, element: load(MasterListPage, { master: 'units' }) },
              { path: `${PATHS.units}/:id`, element: load(MasterDetailPage, { master: 'units' }) },

              { path: PATHS.departments, element: load(MasterListPage, { master: 'departments' }) },
              { path: `${PATHS.departments}/:id`, element: load(MasterDetailPage, { master: 'departments' }) },

              { path: PATHS.designations, element: load(MasterListPage, { master: 'designations' }) },
              { path: `${PATHS.designations}/:id`, element: load(MasterDetailPage, { master: 'designations' }) },

              { path: PATHS.grades, element: load(MasterListPage, { master: 'grades' }) },
              { path: `${PATHS.grades}/:id`, element: load(MasterDetailPage, { master: 'grades' }) },

              { path: PATHS.shifts, element: load(MasterListPage, { master: 'shifts' }) },
              { path: `${PATHS.shifts}/:id`, element: load(MasterDetailPage, { master: 'shifts' }) },

              // Payroll arithmetic rather than org structure, and read-only --
              // but it reads from the organization picker endpoint, so it is
              // gated by the same grant.
              { path: PATHS.salaryTemplates, element: load(SalaryTemplatesPage) },
            ],
          },

          /* ---------------------------------------------------- employees -- */
          {
            // The asset register is served by the payroll router, so it is the
            // payroll grant that decides access -- not the employee one.
            //
            // Declared BEFORE the employee branch: React Router ranks static
            // segments above dynamic ones, but keeping the order explicit makes
            // it obvious that "assets" must never be read as an employee id.
            element: <RequirePermission resource={RESOURCES.PAYROLL} action={ACTIONS.READ} />,
            children: [
              { path: PATHS.employeeAssets, element: load(EmployeeAssetsPage) },
              { path: '/employees/assets/:id', element: load(AssetDetailPage) },
            ],
          },

          {
            // Reading the module is gated once, around the whole branch.
            element: <RequirePermission resource={RESOURCES.EMPLOYEE} action={ACTIONS.READ} />,
            children: [
              { path: PATHS.employees, element: load(EmployeeListPage) },

              /**
               * Declared before `/employees/:id`, or each of these literal
               * segments would be read as an employee id.
               *
               * Transfers and promotions are the same screen in two modes:
               * both are a change to where an employee sits, and which one it
               * reads as is decided by the designation levels involved.
               */
              { path: PATHS.employeeDocuments, element: load(EmployeeDocumentsPage) },
              { path: PATHS.employeeTransfers, element: load(EmployeeMovementsPage, { mode: 'transfer' }) },
              { path: PATHS.employeePromotions, element: load(EmployeeMovementsPage, { mode: 'promotion' }) },

              {
                // Create and edit are narrower than read, so they carry their
                // own guard nested inside it.
                element: <RequirePermission resource={RESOURCES.EMPLOYEE} action={ACTIONS.CREATE} />,
                children: [{ path: PATHS.employeeNew, element: load(EmployeeFormPage) }],
              },
              {
                element: <RequirePermission resource={RESOURCES.EMPLOYEE} action={ACTIONS.UPDATE} />,
                children: [{ path: '/employees/:id/edit', element: load(EmployeeFormPage) }],
              },
              { path: '/employees/:id', element: load(EmployeeDetailPage) },
            ],
          },

          /* --------------------------------------------------- attendance -- */
          {
            element: <RequirePermission resource={RESOURCES.ATTENDANCE} action={ACTIONS.READ} />,
            children: [
              { path: PATHS.attendance, element: load(MyAttendancePage) },
              { path: PATHS.attendanceRegister, element: load(AttendanceRegisterPage) },
              { path: PATHS.attendanceRegularization, element: load(RegularizationPage) },
              { path: PATHS.attendancePolicy, element: load(AttendancePolicyPage) },
              { path: PATHS.attendanceCompOff, element: load(CompOffPage) },
              { path: PATHS.attendanceHistory, element: load(AttendanceHistoryPage) },
              { path: PATHS.holidays, element: load(HolidayCalendarPage) },
              {
                element: <RequirePermission resource={RESOURCES.ATTENDANCE} action={ACTIONS.DASHBOARD} />,
                children: [
                  { path: PATHS.attendanceMonthly, element: load(MonthlyAttendancePage) },
                  { path: PATHS.attendanceReports, element: load(AttendanceReportsPage) },
                ],
              },
              {
                // APPROVE, matching the API: `create` is self-service punching,
                // which every employee holds.
                element: <RequirePermission resource={RESOURCES.ATTENDANCE} action={ACTIONS.APPROVE} />,
                children: [
                  { path: PATHS.attendanceImport, element: load(AttendanceImportPage) },
                  { path: PATHS.attendanceBiometric, element: load(BiometricImportPage) },
                ],
              },
            ],
          },

          /* --------------------------------------------------------- leave -- */
          {
            element: <RequirePermission resource={RESOURCES.LEAVE} action={ACTIONS.READ} />,
            children: [
              { path: PATHS.leave, element: load(LeaveRequestsPage) },
              { path: PATHS.leaveTypes, element: load(LeaveTypesPage) },
              { path: PATHS.leaveBalance, element: load(LeaveBalancePage) },
              {
                // Deciding someone else's leave is a narrower right than
                // reading it, and matches what the API demands.
                element: <RequirePermission resource={RESOURCES.LEAVE} action={ACTIONS.APPROVE} />,
                children: [{ path: PATHS.leaveApproval, element: load(LeaveApprovalPage) }],
              },
            ],
          },

          /* ------------------------------------------------------- payroll -- */
          {
            element: <RequirePermission resource={RESOURCES.PAYROLL} action={ACTIONS.READ} />,
            children: [
              { path: PATHS.salaryStructures, element: load(SalaryStructuresPage) },
              {
                // Org-wide figures. The API answers these with TENANT reach on
                // top of `payroll:read`, which every employee holds for their
                // own payslip -- so the same reach is required here.
                element: <RequireScope minimum={SCOPES.TENANT} />,
                children: [
                  { path: PATHS.payrollRuns, element: load(PayrollRunsPage) },
                  { path: '/payroll/runs/:id', element: load(PayrollRunDetailPage) },
                ],
              },
              { path: PATHS.payslips, element: load(PayslipsPage) },
              { path: '/payroll/payslips/:id', element: load(PayslipDetailPage) },
              { path: PATHS.loans, element: load(LoansPage) },
              { path: '/payroll/loans/:id', element: load(LoanDetailPage) },
              { path: PATHS.settlements, element: load(SettlementsPage) },
              { path: '/payroll/settlements/:id', element: load(SettlementDetailPage) },
              { path: PATHS.bonus, element: load(BonusPage) },
              { path: PATHS.overtime, element: load(OvertimePage) },
              { path: PATHS.settings, element: load(SystemSettingsPage) },
            ],
          },

          /* --------------------------------------------------- recruitment -- */
          {
            element: <RequirePermission resource={RESOURCES.RECRUITMENT} action={ACTIONS.READ} />,
            children: [
              { path: PATHS.jobOpenings, element: load(JobOpeningsPage) },
              { path: PATHS.candidates, element: load(CandidatesPage) },
              { path: PATHS.interviews, element: load(InterviewsPage) },
              // Joining and employee conversion are the last step of an offer,
              // so they live here rather than on a screen of their own.
              { path: PATHS.offerLetters, element: load(OffersPage) },
              { path: PATHS.hiringReports, element: load(HiringReportsPage) },
            ],
          },

          /* ------------------------------------------------------- reports -- */
          {
            element: <RequirePermission resource={RESOURCES.REPORT} action={ACTIONS.READ} />,
            children: [
              { path: PATHS.reports, element: load(ReportsHubPage) },
              // One route for all eight reports. The server describes each one,
              // so the named paths in PATHS resolve here rather than to eight
              // near-identical screens.
              { path: '/reports/:slug', element: load(ReportViewerPage) },
            ],
          },
          {
            // The statutory register is a legal document rather than an
            // analytics view, so it keeps its own screen. Two segments, so it
            // is not captured by `/reports/:slug` above.
            element: <RequirePermission resource={RESOURCES.PAYROLL} action={ACTIONS.DASHBOARD} />,
            children: [{ path: PATHS.payrollStatutoryReports, element: load(PayrollReportsPage) }],
          },

          /* ------------------------------------------------ administration -- */
          {
            element: <RequirePermission resource={RESOURCES.ROLE} action={ACTIONS.READ} />,
            children: [
              { path: PATHS.roles, element: load(RolesPage) },
              { path: PATHS.permissions, element: load(PermissionsPage) },
            ],
          },
          {
            // Account management. Separate from the audit trail below: an
            // auditor reads what happened without being able to touch a login.
            element: <RequirePermission resource={RESOURCES.USER} action={ACTIONS.READ} />,
            children: [{ path: PATHS.users, element: load(UsersPage) }],
          },
          {
            element: <RequirePermission resource={RESOURCES.AUDIT} action={ACTIONS.READ} />,
            children: [
              { path: PATHS.auditLogs, element: load(AuditLogsPage) },
              { path: PATHS.activityLogs, element: load(ActivityLogsPage) },
            ],
          },
          {
            element: <RequirePermission resource={RESOURCES.TENANT} action={ACTIONS.READ} />,
            children: [
              { path: PATHS.companyProfile, element: load(CompanyProfilePage) },
              { path: PATHS.emailConfiguration, element: load(EmailConfigurationPage) },
              { path: PATHS.notificationSettings, element: load(NotificationSettingsPage) },
              {
                // A restore can empty collections, so the screen that offers it
                // is gated on the same right the endpoint demands.
                element: <RequirePermission resource={RESOURCES.TENANT} action={ACTIONS.DELETE} />,
                children: [{ path: PATHS.backupRestore, element: load(BackupRestorePage) }],
              },
            ],
          },
          // Login history opens for any signed-in user: the "My account" tab
          // shows only their own. The organisation tab calls an endpoint that
          // enforces `audit:read` on its own.
          { path: PATHS.loginHistory, element: load(LoginHistoryPage) },

          { path: PATHS.errors.forbidden, lazy: async () => ({ Component: (await errorPageModule()).ForbiddenPage }) },
          { path: PATHS.errors.notFound, lazy: async () => ({ Component: (await errorPageModule()).NotFoundPage }) },
          { path: '*', element: <Navigate to={PATHS.errors.notFound} replace /> },
        ],
      },
    ],
  },
];

export default ROUTES;
