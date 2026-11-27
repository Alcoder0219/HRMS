import { useCallback, useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';

import PeopleIcon from '@mui/icons-material/PeopleAltOutlined';
import BadgeIcon from '@mui/icons-material/BadgeOutlined';
import PersonOffIcon from '@mui/icons-material/PersonOffOutlined';
import SchoolIcon from '@mui/icons-material/SchoolOutlined';
import EventIcon from '@mui/icons-material/EventAvailableOutlined';
import EventBusyIcon from '@mui/icons-material/EventBusyOutlined';
import BeachIcon from '@mui/icons-material/BeachAccessOutlined';
import WeekendIcon from '@mui/icons-material/WeekendOutlined';
import InsightsIcon from '@mui/icons-material/InsightsOutlined';
import GroupsIcon from '@mui/icons-material/GroupsOutlined';
import PaymentsIcon from '@mui/icons-material/PaymentsOutlined';
import BeachSectionIcon from '@mui/icons-material/FlightTakeoffOutlined';
import PendingIcon from '@mui/icons-material/PendingActionsOutlined';
import HistoryIcon from '@mui/icons-material/HistoryOutlined';
import CelebrationIcon from '@mui/icons-material/CelebrationOutlined';

import PageHeader from '@components/common/PageHeader.jsx';
import DashboardToolbar from './components/DashboardToolbar.jsx';
import KpiCard from './components/KpiCard.jsx';
import Section from './components/Section.jsx';
import AttendanceAnalytics from './sections/AttendanceAnalytics.jsx';
import EmployeeAnalytics from './sections/EmployeeAnalytics.jsx';
import PayrollAnalytics from './sections/PayrollAnalytics.jsx';
import LeaveOverview from './sections/LeaveOverview.jsx';
import PendingActions from './sections/PendingActions.jsx';
import RecentActivity from './sections/RecentActivity.jsx';
import UpcomingEvents from './sections/UpcomingEvents.jsx';
import useDashboardQuery from './useDashboardQuery.js';
import { useAppDispatch, useAppSelector } from '@hooks/useRedux.js';
import useAuth from '@hooks/useAuth.js';
import usePermissions from '@hooks/usePermissions.js';
import useUnitAccess from '@hooks/useUnitAccess.js';
import { fetchMasters, selectMasters } from '@redux/slices/employeeSlice.js';
import dashboardService from '@services/modules/dashboard.service.js';
import { RESOURCES, ACTIONS } from '@utils/permissions.js';
import { formatCurrency } from '@utils/format.js';
import { SCOPES } from '@utils/roles.js';
import { PATHS } from '@routes/paths.js';

/**
 * The landing screen: an overview of the organisation for the selected unit,
 * department and month.
 *
 * Every figure is a module's own. Headcount comes from the employee records,
 * attendance from the monthly attendance summary and the stored day records,
 * leave from the leave requests, salary from the salary register (the stored
 * payslips). The dashboard API only applies the filters consistently and adds
 * them up; it never recalculates a worked hour or a payroll component.
 *
 * Each section owns its state, so one refused or failing request leaves the
 * others standing; sections the user may not see are not requested at all;
 * the lower sections load when they are scrolled near. The server enforces
 * the same permissions, scope and unit rules whatever this screen shows.
 */

const MONTH_NAME = (month) => new Date(2000, month - 1).toLocaleString(['en-TZ', 'en-GB'], { month: 'long' });

/** A path with the dashboard's filters carried as query parameters. */
const withQuery = (path, params) => {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ''));
  return query.toString() ? `${path}?${query}` : path;
};

const now = new Date();

const DashboardPage = () => {
  const dispatch = useAppDispatch();
  const { user } = useAuth();
  const { can, hasScopeAtLeast } = usePermissions();
  const unitAccess = useUnitAccess();
  const masters = useAppSelector(selectMasters);

  const [filters, setFilters] = useState({ unitId: '', departmentId: '', year: now.getFullYear(), month: now.getMonth() + 1 });
  const [refreshKey, setRefreshKey] = useState(0);
  const [updatedAt, setUpdatedAt] = useState(null);

  useEffect(() => {
    dispatch(fetchMasters());
  }, [dispatch]);

  const sees = useMemo(
    () => ({
      employees: can(RESOURCES.EMPLOYEE, ACTIONS.DASHBOARD),
      attendance: can(RESOURCES.ATTENDANCE, ACTIONS.READ),
      leave: can(RESOURCES.LEAVE, ACTIONS.READ),
      leaveApprove: can(RESOURCES.LEAVE, ACTIONS.APPROVE),
      // What the Payroll Runs screen asks for: the read grant with organisation reach.
      payroll: can(RESOURCES.PAYROLL, ACTIONS.READ) && hasScopeAtLeast(SCOPES.TENANT),
      payrollQueues: can(RESOURCES.PAYROLL, ACTIONS.READ) && hasScopeAtLeast(SCOPES.TENANT),
      payrollApprove: can(RESOURCES.PAYROLL, ACTIONS.APPROVE),
      audit: can(RESOURCES.AUDIT, ACTIONS.READ),
    }),
    [can, hasScopeAtLeast],
  );

  const { unitId, departmentId, year, month } = filters;
  const periodLabel = `${MONTH_NAME(month)} ${year}`;
  const scopeParams = { unitId, departmentId };
  const periodParams = { unitId, departmentId, year, month };

  /* ------------------------------------------------------------ requests -- */

  const employees = useDashboardQuery(() => dashboardService.employees(scopeParams).then((r) => r.data), [unitId, departmentId, refreshKey], {
    enabled: sees.employees,
  });
  const today = useDashboardQuery(() => dashboardService.today(scopeParams).then((r) => r.data), [unitId, departmentId, refreshKey], {
    enabled: sees.attendance,
  });
  const attendance = useDashboardQuery(
    () => dashboardService.attendance(periodParams).then((r) => r.data),
    [unitId, departmentId, year, month, refreshKey],
    { enabled: sees.attendance },
  );
  const leave = useDashboardQuery(() => dashboardService.leave(periodParams).then((r) => r.data), [unitId, departmentId, year, month, refreshKey], {
    enabled: sees.leave,
  });
  const payroll = useDashboardQuery(
    () => dashboardService.payroll(periodParams).then((r) => r.data),
    [unitId, departmentId, year, month, refreshKey],
    { enabled: sees.payroll },
  );

  // "Updated" is when the headline figures last finished loading.
  const headlineLoading = employees.loading || today.loading;
  useEffect(() => {
    if (!headlineLoading) setUpdatedAt(new Date());
  }, [headlineLoading, refreshKey, unitId, departmentId]);

  const changeFilters = useCallback((next) => setFilters((previous) => ({ ...previous, ...next })), []);
  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);

  /* --------------------------------------------------------------- KPIs -- */

  const people = employees.data;
  const day = today.data;
  const employeeReport = (extra = {}) => withQuery(PATHS.report('employees'), { unitId, departmentId, ...extra });

  const kpis = [
    sees.employees && { label: 'Total employees', value: people?.total, caption: 'Every record, any status', icon: PeopleIcon, color: 'primary', to: employeeReport(), loading: employees.loading },
    sees.employees && { label: 'Active employees', value: people?.active, caption: 'Currently employed', icon: BadgeIcon, color: 'success', to: employeeReport(), loading: employees.loading },
    sees.employees && { label: 'Inactive employees', value: people?.inactive, caption: 'Resigned, terminated or retired', icon: PersonOffIcon, color: 'secondary', to: employeeReport(), loading: employees.loading },
    sees.employees && { label: 'On probation', value: people?.probation, caption: 'Awaiting confirmation', icon: SchoolIcon, color: 'info', to: employeeReport({ status: 'PROBATION' }), loading: employees.loading },
    sees.attendance && {
      label: 'Present today',
      value: day?.present,
      caption: day ? `${day.halfDay} half day · ${day.missingPunch} punch incomplete` : 'From today’s records',
      icon: EventIcon,
      color: 'success',
      to: PATHS.attendanceRegister,
      loading: today.loading,
    },
    sees.attendance && {
      label: 'Absent today',
      value: day?.absent,
      caption: day ? `${day.recorded} of ${day.employed} employed have a record` : 'From today’s records',
      icon: EventBusyIcon,
      color: 'error',
      to: PATHS.attendanceRegister,
      loading: today.loading,
    },
    sees.attendance && { label: 'On leave today', value: day?.onLeave, caption: 'Marked on leave', icon: BeachIcon, color: 'warning', to: PATHS.attendanceRegister, loading: today.loading },
    sees.attendance && {
      label: 'Weekly off / Holiday',
      value: day?.weeklyOffOrHoliday,
      caption: day?.holidayToday ?? 'Rest day by shift or calendar',
      icon: WeekendIcon,
      color: 'secondary',
      to: PATHS.holidays,
      loading: today.loading,
    },
  ].filter(Boolean);

  const nothingToShow = !sees.employees && !sees.attendance && !sees.leave && !sees.payroll;

  /* -------------------------------------------------------------- render -- */

  return (
    <Box>
      <PageHeader title={`Welcome, ${user?.firstName ?? 'there'}`} />

      <DashboardToolbar
        filters={filters}
        onChange={changeFilters}
        units={masters.units ?? []}
        departments={masters.departments ?? []}
        seesAllUnits={unitAccess.all}
        onRefresh={refresh}
        refreshing={headlineLoading}
        updatedAt={updatedAt}
      />

      {kpis.length > 0 && (
        <Grid container spacing={2} sx={{ mb: 3 }}>
          {kpis.map((kpi) => (
            <Grid key={kpi.label} size={{ xs: 6, md: 3 }}>
              <KpiCard {...kpi} />
            </Grid>
          ))}
        </Grid>
      )}

      {sees.attendance && (
        <Section title="Attendance analytics" icon={InsightsIcon}>
          <AttendanceAnalytics
            query={attendance}
            periodLabel={periodLabel}
            year={year}
            // Shown only to people who may see payroll, from the salary register.
            overtimePaid={sees.payroll && payroll.data?.run ? formatCurrency(payroll.data.run.overtime) : null}
          />
        </Section>
      )}

      {sees.employees && (
        <Section title="Employee analytics" icon={GroupsIcon}>
          <EmployeeAnalytics query={employees} />
        </Section>
      )}

      {sees.payroll && (
        <Section title="Payroll analytics" icon={PaymentsIcon}>
          <PayrollAnalytics query={payroll} periodLabel={periodLabel} year={year} />
        </Section>
      )}

      {sees.leave && (
        <Section title="Leave overview" icon={BeachSectionIcon}>
          <LeaveOverview query={leave} periodLabel={periodLabel} />
        </Section>
      )}

      <Section title="Pending actions" icon={PendingIcon} lazy placeholderHeight={140}>
        <PendingActions sees={sees} payrollAwaiting={payroll.data?.awaitingApproval ?? null} refreshKey={refreshKey} />
      </Section>

      <Section title="Recent activity" icon={HistoryIcon} lazy placeholderHeight={220}>
        <RecentActivity seesAudit={sees.audit} refreshKey={refreshKey} />
      </Section>

      {(sees.attendance || sees.leave) && (
        <Section title="Upcoming holidays & events" icon={CelebrationIcon} lazy placeholderHeight={220}>
          <UpcomingEvents seesAttendance={sees.attendance} leave={sees.leave ? leave : null} refreshKey={refreshKey} />
        </Section>
      )}

      {nothingToShow && (
        <Alert severity="info" icon={<HistoryIcon />}>
          Your role has a narrow scope, so most summary sections are hidden. Use the sidebar to reach what you do have access to.
        </Alert>
      )}
    </Box>
  );
};

export default DashboardPage;
