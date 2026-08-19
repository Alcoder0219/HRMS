import DashboardIcon from '@mui/icons-material/SpaceDashboardOutlined';
import BusinessIcon from '@mui/icons-material/BusinessOutlined';
import ApartmentIcon from '@mui/icons-material/ApartmentOutlined';
import AccountTreeIcon from '@mui/icons-material/AccountTreeOutlined';
import BadgeIcon from '@mui/icons-material/BadgeOutlined';
import MedalIcon from '@mui/icons-material/MilitaryTechOutlined';
import ScheduleIcon from '@mui/icons-material/ScheduleOutlined';
import EventNoteIcon from '@mui/icons-material/EventNoteOutlined';
import PeopleIcon from '@mui/icons-material/PeopleAltOutlined';
import GroupsIcon from '@mui/icons-material/GroupsOutlined';
import DescriptionIcon from '@mui/icons-material/DescriptionOutlined';
import DevicesIcon from '@mui/icons-material/DevicesOutlined';
import SwapHorizIcon from '@mui/icons-material/SwapHorizOutlined';
import TrendingUpIcon from '@mui/icons-material/TrendingUpOutlined';
import EventIcon from '@mui/icons-material/EventAvailableOutlined';
import FactCheckIcon from '@mui/icons-material/FactCheckOutlined';
import CalendarIcon from '@mui/icons-material/CalendarMonthOutlined';
import UploadFileIcon from '@mui/icons-material/UploadFileOutlined';
import RuleIcon from '@mui/icons-material/RuleOutlined';
import EditCalendarIcon from '@mui/icons-material/EditCalendarOutlined';
import MoreTimeIcon from '@mui/icons-material/MoreTimeOutlined';
import FingerprintIcon from '@mui/icons-material/FingerprintOutlined';
import AssessmentIcon from '@mui/icons-material/AssessmentOutlined';
import BeachIcon from '@mui/icons-material/BeachAccessOutlined';
import CategoryIcon from '@mui/icons-material/CategoryOutlined';
import WalletIcon from '@mui/icons-material/AccountBalanceWalletOutlined';
import HowToRegIcon from '@mui/icons-material/HowToRegOutlined';
import PaymentsIcon from '@mui/icons-material/PaymentsOutlined';
import ReceiptIcon from '@mui/icons-material/ReceiptLongOutlined';
import PlayCircleIcon from '@mui/icons-material/PlayCircleOutlined';
import SavingsIcon from '@mui/icons-material/SavingsOutlined';
import LogoutIcon from '@mui/icons-material/LogoutOutlined';
import CardGiftcardIcon from '@mui/icons-material/CardGiftcardOutlined';
import PaidIcon from '@mui/icons-material/PaidOutlined';
import WorkIcon from '@mui/icons-material/WorkOutlineOutlined';
import PersonSearchIcon from '@mui/icons-material/PersonSearchOutlined';
import EventSeatIcon from '@mui/icons-material/EventSeatOutlined';
import MailIcon from '@mui/icons-material/MailOutlineOutlined';
import InsightsIcon from '@mui/icons-material/InsightsOutlined';
import SummarizeIcon from '@mui/icons-material/SummarizeOutlined';
import QueryStatsIcon from '@mui/icons-material/QueryStatsOutlined';
import AccountBalanceIcon from '@mui/icons-material/AccountBalanceOutlined';
import NotificationsIcon from '@mui/icons-material/NotificationsOutlined';
import BackupIcon from '@mui/icons-material/BackupOutlined';
import AdminIcon from '@mui/icons-material/AdminPanelSettingsOutlined';
import VpnKeyIcon from '@mui/icons-material/VpnKeyOutlined';
import HistoryIcon from '@mui/icons-material/HistoryOutlined';
import SettingsIcon from '@mui/icons-material/SettingsOutlined';

import { RESOURCES, ACTIONS } from '@utils/permissions.js';
import { SCOPES } from '@utils/roles.js';
import { PATHS } from '@routes/paths.js';

/**
 * The one description of the application's module map.
 *
 * The sidebar renders from it and the router registers from it, so a module
 * cannot be linked without a route or routed without a link -- the exact split
 * that left Leave, Payroll, Recruitment and Reports pointing at 404s.
 *
 * Every entry names the grant it needs. Navigation stays permission-driven
 * rather than role-driven, so a new role gets a correct menu without this file
 * being edited.
 *
 * `minScope` is for the handful of endpoints where the permission alone is too
 * coarse. `payroll:read` is held by every employee so they can open their own
 * payslip, so the API demands TENANT reach on top of it for anything org-wide.
 * Without the same rule here the menu offers a screen that can only ever 403.
 *
 * There used to be a second status, `planned`, for entries whose API did not
 * exist -- they rendered a placeholder rather than a dead link. Every module
 * now has a backend, so the status is uniformly `live` and the placeholder is
 * gone. The field is kept because the route check reads it to assert exactly
 * that: an entry that is not live has nowhere to go.
 */
export const MODULE_STATUS = {
  LIVE: 'live',
};

const live = (item) => ({ status: MODULE_STATUS.LIVE, ...item });

export const NAV_GROUPS = [
  {
    id: 'overview',
    items: [
      live({
        label: 'Dashboard',
        to: PATHS.dashboard,
        icon: DashboardIcon,
        resource: RESOURCES.DASHBOARD,
        action: ACTIONS.READ,
        end: true,
      }),
    ],
  },

  {
    id: 'organization',
    label: 'Organization',
    icon: BusinessIcon,
    items: [
      live({ label: 'Units', to: PATHS.units, icon: ApartmentIcon, resource: RESOURCES.ORGANIZATION, action: ACTIONS.READ }),
      live({ label: 'Departments', to: PATHS.departments, icon: AccountTreeIcon, resource: RESOURCES.ORGANIZATION, action: ACTIONS.READ }),
      live({ label: 'Designations', to: PATHS.designations, icon: BadgeIcon, resource: RESOURCES.ORGANIZATION, action: ACTIONS.READ }),
      live({ label: 'Grades', to: PATHS.grades, icon: MedalIcon, resource: RESOURCES.ORGANIZATION, action: ACTIONS.READ }),
      live({ label: 'Shifts', to: PATHS.shifts, icon: ScheduleIcon, resource: RESOURCES.ORGANIZATION, action: ACTIONS.READ }),
      live({ label: 'Holiday Calendar', to: PATHS.holidays, icon: EventNoteIcon, resource: RESOURCES.ATTENDANCE, action: ACTIONS.READ }),
    ],
  },

  {
    id: 'employees',
    label: 'Employee Management',
    icon: PeopleIcon,
    items: [
      live({ label: 'Employees', to: PATHS.employees, icon: PeopleIcon, resource: RESOURCES.EMPLOYEE, action: ACTIONS.READ, end: true }),
      // Documents live on the employee record, so the employee grant governs
      // them -- there is no separate documents collection to gate.
      live({ label: 'Employee Documents', to: PATHS.employeeDocuments, icon: DescriptionIcon, resource: RESOURCES.EMPLOYEE, action: ACTIONS.READ }),
      live({ label: 'Employee Assets', to: PATHS.employeeAssets, icon: DevicesIcon, resource: RESOURCES.PAYROLL, action: ACTIONS.READ }),
      live({ label: 'Employee Transfers', to: PATHS.employeeTransfers, icon: SwapHorizIcon, resource: RESOURCES.EMPLOYEE, action: ACTIONS.READ }),
      live({ label: 'Employee Promotions', to: PATHS.employeePromotions, icon: TrendingUpIcon, resource: RESOURCES.EMPLOYEE, action: ACTIONS.READ }),
    ],
  },

  {
    id: 'attendance',
    label: 'Attendance',
    icon: EventIcon,
    items: [
      live({ label: 'My Attendance', to: PATHS.attendance, icon: EventIcon, resource: RESOURCES.ATTENDANCE, action: ACTIONS.READ, end: true }),
      live({ label: 'Attendance Register', to: PATHS.attendanceRegister, icon: FactCheckIcon, resource: RESOURCES.ATTENDANCE, action: ACTIONS.READ }),
      live({ label: 'Monthly Attendance', to: PATHS.attendanceMonthly, icon: CalendarIcon, resource: RESOURCES.ATTENDANCE, action: ACTIONS.DASHBOARD }),
      live({ label: 'Import Attendance', to: PATHS.attendanceImport, icon: UploadFileIcon, resource: RESOURCES.ATTENDANCE, action: ACTIONS.APPROVE }),
      // Ingesting raw device punches rewrites whole days, so it sits with the
      // other approval-grade attendance actions rather than with self-service.
      live({ label: 'Biometric Import', to: PATHS.attendanceBiometric, icon: FingerprintIcon, resource: RESOURCES.ATTENDANCE, action: ACTIONS.APPROVE }),
      live({ label: 'Attendance History', to: PATHS.attendanceHistory, icon: HistoryIcon, resource: RESOURCES.ATTENDANCE, action: ACTIONS.READ }),
      // Kept in the map, kept out of the menu. `hidden` suppresses the sidebar
      // entry and nothing else: the route, the page, the API and the permission
      // are untouched, so /attendance/policy, /attendance/regularization and
      // /attendance/comp-off still open and still work when reached directly or
      // linked to -- the dashboard links to regularization, and that link is
      // unaffected. Deleting these three lines instead would also have taken
      // them out of NAV_ITEMS, which is the lookup other code resolves a path
      // back to its module through. Remove the flag to show an item again.
      live({ label: 'Attendance Policies', to: PATHS.attendancePolicy, icon: RuleIcon, resource: RESOURCES.ATTENDANCE, action: ACTIONS.READ, hidden: true }),
      live({ label: 'Regularization', to: PATHS.attendanceRegularization, icon: EditCalendarIcon, resource: RESOURCES.ATTENDANCE, action: ACTIONS.READ, hidden: true }),
      live({ label: 'Comp Off', to: PATHS.attendanceCompOff, icon: MoreTimeIcon, resource: RESOURCES.ATTENDANCE, action: ACTIONS.READ, hidden: true }),
      live({ label: 'Attendance Reports', to: PATHS.attendanceReports, icon: AssessmentIcon, resource: RESOURCES.ATTENDANCE, action: ACTIONS.DASHBOARD }),
    ],
  },

  {
    id: 'leave',
    label: 'Leave',
    icon: BeachIcon,
    items: [
      live({ label: 'Leave Requests', to: PATHS.leave, icon: BeachIcon, resource: RESOURCES.LEAVE, action: ACTIONS.READ, end: true }),
      live({ label: 'Leave Types', to: PATHS.leaveTypes, icon: CategoryIcon, resource: RESOURCES.LEAVE, action: ACTIONS.READ }),
      live({ label: 'Leave Balance', to: PATHS.leaveBalance, icon: WalletIcon, resource: RESOURCES.LEAVE, action: ACTIONS.READ }),
      live({ label: 'Leave Approval', to: PATHS.leaveApproval, icon: HowToRegIcon, resource: RESOURCES.LEAVE, action: ACTIONS.APPROVE }),
    ],
  },

  {
    id: 'payroll',
    label: 'Payroll',
    icon: PaymentsIcon,
    items: [
      // Kept in the map, kept out of the menu -- the same `hidden` flag used
      // elsewhere in this file. Routes, pages, components, APIs and permissions
      // are untouched, so /payroll/structures and /payroll/templates still open
      // and still work when reached directly or linked to, and the structures
      // they hold still drive every payroll calculation. Remove the flag to
      // show an item again.
      live({ label: 'Salary Structures', to: PATHS.salaryStructures, icon: PaymentsIcon, resource: RESOURCES.PAYROLL, action: ACTIONS.READ, hidden: true }),
      live({ label: 'Salary Templates', to: PATHS.salaryTemplates, icon: ReceiptIcon, resource: RESOURCES.ORGANIZATION, action: ACTIONS.READ, hidden: true }),
      live({
        label: 'Payroll Runs',
        to: PATHS.payrollRuns,
        icon: PlayCircleIcon,
        resource: RESOURCES.PAYROLL,
        action: ACTIONS.READ,
        // The run list and its salary register are org-wide figures. Verified
        // against the API: a SELF-scoped employee is refused with 403.
        minScope: SCOPES.TENANT,
      }),
      live({ label: 'Payslips', to: PATHS.payslips, icon: DescriptionIcon, resource: RESOURCES.PAYROLL, action: ACTIONS.READ }),
      live({ label: 'Settlements', to: PATHS.settlements, icon: LogoutIcon, resource: RESOURCES.PAYROLL, action: ACTIONS.READ }),
      live({ label: 'Loans', to: PATHS.loans, icon: SavingsIcon, resource: RESOURCES.PAYROLL, action: ACTIONS.READ }),
      // Both read from payslips rather than a collection of their own: a bonus
      // and an overtime payment are payslip lines, and the payslip is the record.
      live({ label: 'Bonus', to: PATHS.bonus, icon: CardGiftcardIcon, resource: RESOURCES.PAYROLL, action: ACTIONS.READ }),
      live({ label: 'Overtime', to: PATHS.overtime, icon: PaidIcon, resource: RESOURCES.PAYROLL, action: ACTIONS.READ }),
    ],
  },

  {
    // Kept in the map, kept out of the menu -- the same `hidden` flag the three
    // Attendance entries carry, applied to a whole section. Every route, page,
    // component, API and permission below is untouched, so /recruitment/... and
    // /reports/... still open and still work when reached directly or linked
    // to. Remove the flag to show the section again.
    id: 'recruitment',
    label: 'Recruitment',
    icon: WorkIcon,
    hidden: true,
    items: [
      live({ label: 'Job Openings', to: PATHS.jobOpenings, icon: WorkIcon, resource: RESOURCES.RECRUITMENT, action: ACTIONS.READ }),
      live({ label: 'Candidates', to: PATHS.candidates, icon: PersonSearchIcon, resource: RESOURCES.RECRUITMENT, action: ACTIONS.READ }),
      live({ label: 'Interviews', to: PATHS.interviews, icon: EventSeatIcon, resource: RESOURCES.RECRUITMENT, action: ACTIONS.READ }),
      // Joining and employee conversion live on the offers screen: they are the
      // last step of an offer, not a separate thing to navigate to.
      live({ label: 'Offer Letters', to: PATHS.offerLetters, icon: MailIcon, resource: RESOURCES.RECRUITMENT, action: ACTIONS.READ }),
      live({ label: 'Hiring Reports', to: PATHS.hiringReports, icon: InsightsIcon, resource: RESOURCES.RECRUITMENT, action: ACTIONS.READ }),
    ],
  },

  {
    id: 'reports',
    label: 'Reports',
    icon: InsightsIcon,
    hidden: true,
    // Every entry here resolves to the same screen, driven by the server's
    // descriptor for that report. They are listed individually because
    // "Loan Report" is what someone looks for in a sidebar -- not
    // "Reports, then pick loans from a dropdown".
    items: [
      live({ label: 'All Reports', to: PATHS.reports, icon: InsightsIcon, resource: RESOURCES.REPORT, action: ACTIONS.READ }),
      live({ label: 'Employee Report', to: PATHS.employeeReports, icon: SummarizeIcon, resource: RESOURCES.REPORT, action: ACTIONS.READ }),
      live({ label: 'Attendance Report', to: PATHS.attendanceModuleReports, icon: AssessmentIcon, resource: RESOURCES.REPORT, action: ACTIONS.READ }),
      live({ label: 'Leave Report', to: PATHS.leaveReports, icon: BeachIcon, resource: RESOURCES.REPORT, action: ACTIONS.READ }),
      live({ label: 'Payroll Report', to: PATHS.payrollReports, icon: QueryStatsIcon, resource: RESOURCES.REPORT, action: ACTIONS.READ }),
      live({ label: 'Recruitment Report', to: PATHS.recruitmentReports, icon: PersonSearchIcon, resource: RESOURCES.REPORT, action: ACTIONS.READ }),
      live({ label: 'Asset Report', to: PATHS.assetReports, icon: DevicesIcon, resource: RESOURCES.REPORT, action: ACTIONS.READ }),
      live({ label: 'Loan Report', to: PATHS.loanReports, icon: AccountBalanceIcon, resource: RESOURCES.REPORT, action: ACTIONS.READ }),
      live({ label: 'Settlement Report', to: PATHS.settlementReports, icon: LogoutIcon, resource: RESOURCES.REPORT, action: ACTIONS.READ }),
      // The NSSF/NHIF register, which is a filing rather than an analysis.
      live({ label: 'Statutory & Cost', to: PATHS.payrollStatutoryReports, icon: ReceiptIcon, resource: RESOURCES.PAYROLL, action: ACTIONS.DASHBOARD }),
    ],
  },

  {
    id: 'administration',
    label: 'Administration',
    icon: AdminIcon,
    items: [
      live({ label: 'Users', to: PATHS.users, icon: GroupsIcon, resource: RESOURCES.USER, action: ACTIONS.READ }),
      live({ label: 'Roles', to: PATHS.roles, icon: AdminIcon, resource: RESOURCES.ROLE, action: ACTIONS.READ }),
      live({ label: 'Permissions', to: PATHS.permissions, icon: VpnKeyIcon, resource: RESOURCES.ROLE, action: ACTIONS.READ }),
      live({ label: 'Login History', to: PATHS.loginHistory, icon: HistoryIcon, resource: RESOURCES.DASHBOARD, action: ACTIONS.READ }),
      live({ label: 'Audit Logs', to: PATHS.auditLogs, icon: FactCheckIcon, resource: RESOURCES.AUDIT, action: ACTIONS.READ }),
      live({ label: 'Activity Logs', to: PATHS.activityLogs, icon: TrendingUpIcon, resource: RESOURCES.AUDIT, action: ACTIONS.READ }),
      live({ label: 'Company Profile', to: PATHS.companyProfile, icon: BusinessIcon, resource: RESOURCES.TENANT, action: ACTIONS.READ }),
      live({ label: 'Email Configuration', to: PATHS.emailConfiguration, icon: MailIcon, resource: RESOURCES.TENANT, action: ACTIONS.READ }),
      live({ label: 'Notification Settings', to: PATHS.notificationSettings, icon: NotificationsIcon, resource: RESOURCES.TENANT, action: ACTIONS.READ }),
      // Gated on DELETE rather than READ: this screen can empty collections,
      // and offering it to someone who will only ever be refused is worse than
      // not showing it.
      live({ label: 'Backup & Restore', to: PATHS.backupRestore, icon: BackupIcon, resource: RESOURCES.TENANT, action: ACTIONS.DELETE }),
      live({ label: 'System Settings', to: PATHS.settings, icon: SettingsIcon, resource: RESOURCES.PAYROLL, action: ACTIONS.READ }),
    ],
  },
];

/** Flat view, for the router and for lookups by path. */
export const NAV_ITEMS = NAV_GROUPS.flatMap((group) =>
  group.items.map((item) => ({ ...item, groupId: group.id, groupLabel: group.label ?? null })),
);

export const findNavItem = (path) => NAV_ITEMS.find((item) => item.to === path) ?? null;

export default NAV_GROUPS;
