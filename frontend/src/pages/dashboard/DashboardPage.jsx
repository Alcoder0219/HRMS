import { useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import Link from '@mui/material/Link';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import PeopleIcon from '@mui/icons-material/PeopleAltOutlined';
import BadgeIcon from '@mui/icons-material/BadgeOutlined';
import SchoolIcon from '@mui/icons-material/SchoolOutlined';
import EventIcon from '@mui/icons-material/EventAvailableOutlined';
import BeachIcon from '@mui/icons-material/BeachAccessOutlined';
import PendingIcon from '@mui/icons-material/PendingActionsOutlined';
import PaymentsIcon from '@mui/icons-material/PaymentsOutlined';
import WalletIcon from '@mui/icons-material/AccountBalanceWalletOutlined';
import HistoryIcon from '@mui/icons-material/HistoryOutlined';

import PageHeader from '@components/common/PageHeader.jsx';
import StatCard from '@components/common/StatCard.jsx';
import StatusChip from '@components/common/StatusChip.jsx';
import DashboardPanel from './components/DashboardPanel.jsx';
import { BarChart, DonutChart, HorizontalBars, CHART_COLORS, compactCurrency } from './components/Charts.jsx';
import useDashboardQuery from './useDashboardQuery.js';
import useAuth from '@hooks/useAuth.js';
import usePermissions from '@hooks/usePermissions.js';
import useCurrency from '@hooks/useCurrency.js';
import { compactAmountIn } from '@utils/currency.js';
import { RESOURCES, ACTIONS } from '@utils/permissions.js';
import employeeService from '@services/modules/employee.service.js';
import attendanceService from '@services/modules/attendance.service.js';
import leaveService from '@services/modules/leave.service.js';
import payrollService from '@services/modules/payroll.service.js';
import authService from '@services/modules/auth.service.js';
import { formatCurrency, formatDate, formatDateTime, formatRelative, humanize } from '@utils/format.js';
import { getRowId, displayName, employeeIdentifiers } from '@utils/dataGrid.js';
import { SCOPE_LABELS } from '@utils/roles.js';
import { PATHS } from '@routes/paths.js';

/**
 * The landing screen: headcount, salary, attendance, leave and overtime for a
 * chosen month, assembled from the summary endpoints each module already
 * exposes.
 *
 * Two rules run through the whole page.
 *
 * Every panel owns its request. A dashboard that reads a dozen APIs will have
 * one of them refused -- an ACCOUNTS user holds no `employee:dashboard` -- and
 * one 403 must never blank the page. Panels the caller cannot see are not
 * requested at all; panels that fail say so and offer a retry, beside panels
 * that loaded.
 *
 * Every figure is the module's own. Salary comes from the payroll run and its
 * salary register, attendance from the attendance summary, overtime from the
 * overtime already stored on each attendance day. Nothing on this page
 * recalculates a payroll component, a worked hour or a deduction -- it would be
 * a second opinion about someone's pay, and the wrong one to show.
 */

const MONTHS = Array.from({ length: 12 }, (_, index) => ({
  value: index + 1,
  label: new Date(2000, index).toLocaleString('en-IN', { month: 'long' }),
}));

const CURRENT = new Date();
const YEARS = Array.from({ length: 5 }, (_, index) => CURRENT.getFullYear() - index);

const today = () => new Date().toISOString().slice(0, 10);

/** Minutes as decimal hours, for a figure that is read as "hours worked". */
const toHours = (minutes) => Math.round(((Number(minutes) || 0) / 60) * 10) / 10;

/** Department bars, primary blue first and distinct from there down. */
const DEPARTMENT_COLORS = [
  CHART_COLORS.gross,
  CHART_COLORS.pf,
  CHART_COLORS.lwf,
  CHART_COLORS.net,
  CHART_COLORS.esi,
  CHART_COLORS.employer,
  CHART_COLORS.overtime,
  CHART_COLORS.leave,
];

/**
 * The monthly gross bands the distribution chart counts into.
 *
 * Boundaries only: the labels are written in whichever currency the user is
 * displaying. The boundaries themselves do not move with it, because changing
 * currency relabels amounts rather than converting them.
 */
const SALARY_BANDS = [
  { min: 0, max: 20_000 },
  { min: 20_000, max: 40_000 },
  { min: 40_000, max: 60_000 },
  { min: 60_000, max: 100_000 },
  { min: 100_000, max: Infinity },
];

/** "Below ₹20K", "₹20K – ₹40K", "Above ₹1L" -- or the same in TSH or dollars. */
const describeBand = (band, amount) => {
  if (band.min === 0) return `Below ${amount(band.max)}`;
  if (!Number.isFinite(band.max)) return `Above ${amount(band.min)}`;
  return `${amount(band.min)} – ${amount(band.max)}`;
};

const DashboardPage = () => {
  const { user, roleLabel } = useAuth();
  const { can, scope, isSuperAdmin } = usePermissions();
  const currency = useCurrency();

  const [period, setPeriod] = useState({
    year: CURRENT.getFullYear(),
    month: CURRENT.getMonth() + 1,
  });

  const seesEmployees = can(RESOURCES.EMPLOYEE, ACTIONS.READ);
  const seesAttendance = can(RESOURCES.ATTENDANCE, ACTIONS.READ);
  const seesPayroll = can(RESOURCES.PAYROLL, ACTIONS.READ);
  const seesLeave = can(RESOURCES.LEAVE, ACTIONS.READ);

  const { year, month } = period;
  const periodLabel = `${MONTHS[month - 1].label} ${year}`;

  /* ------------------------------------------------------------ requests -- */

  const headcount = useDashboardQuery(
    () => employeeService.summary().then((r) => r.data),
    [],
    { enabled: seesEmployees },
  );

  // Today's register, not the selected month: these two cards answer "who is in
  // today", which has no meaning for a month in the past. Left on today
  // deliberately rather than filtered into something that reads as a total.
  const attendanceToday = useDashboardQuery(
    () => attendanceService.dailySummary(today()).then((r) => r.data),
    [],
    { enabled: seesAttendance },
  );

  const attendanceMonth = useDashboardQuery(
    () => attendanceService.monthlySummary({ year, month }).then((r) => r.data),
    [year, month],
    { enabled: seesAttendance },
  );

  const overtimeTrend = useDashboardQuery(
    () => attendanceService.overtimeTrend({ year }).then((r) => r.data),
    [year],
    { enabled: seesAttendance },
  );

  const run = useDashboardQuery(
    () => payrollService.listRuns({ year, month, limit: 1 }).then((r) => r.data?.[0] ?? null),
    [year, month],
    { enabled: seesPayroll },
  );

  const runId = run.data ? getRowId(run.data) : null;

  // The register carries the deduction detail -- LWF included -- that the run's
  // own totals do not break out. Requested only once a run exists for the month.
  const register = useDashboardQuery(
    () => payrollService.salaryRegister(runId).then((r) => r.data),
    [runId],
    { enabled: seesPayroll && Boolean(runId) },
  );

  /**
   * The year's trend, read from the payroll RUNS rather than from the payslip
   * aggregate the reports use.
   *
   * The run is the figure the Payroll Runs screen shows and the one this page's
   * KPI cards show, so reading it here is what keeps the chart and the cards
   * telling the same story. It also cannot be thrown by payslips whose run no
   * longer exists -- this database has two such sets, and the payslip aggregate
   * counts them, which is why July reads as double there.
   */
  const salaryTrend = useDashboardQuery(
    () =>
      payrollService
        .listRuns({ year, limit: 12, sortBy: 'month', sortOrder: 'asc' })
        .then((r) => r.data ?? []),
    [year],
    { enabled: seesPayroll },
  );

  /**
   * Leave applications for the month, counted rather than listed.
   *
   * Four requests that each ask for one row and read the total off the
   * envelope, which is how the rest of the app counts a queue. Listing the
   * applications to count them would pull records the panel never shows.
   */
  const leave = useDashboardQuery(
    () => {
      const from = new Date(year, month - 1, 1).toISOString();
      const to = new Date(year, month, 0, 23, 59, 59).toISOString();
      const count = (status) =>
        leaveService
          .listRequests({ from, to, limit: 1, ...(status ? { status } : {}) })
          .then((r) => r.meta?.total ?? 0);

      return Promise.all([count(), count('APPROVED'), count('PENDING'), count('REJECTED')]).then(
        ([total, approved, pending, rejected]) => ({ total, approved, pending, rejected }),
      );
    },
    [year, month],
    { enabled: seesLeave },
  );

  /**
   * The approval queues, gathered together.
   *
   * `allSettled`, so a caller who may see leave but not loans still gets the
   * leave figure instead of an empty panel. A queue that could not be read is
   * null and is left out, never shown as a zero -- "nothing pending" and "not
   * known" must not look the same on an approvals widget.
   */
  const approvals = useDashboardQuery(
    () =>
      Promise.allSettled([
        seesAttendance ? attendanceService.pendingCount().then((r) => r.data?.pending ?? 0) : Promise.reject(),
        seesLeave ? leaveService.pendingCount().then((r) => r.data?.pending ?? 0) : Promise.reject(),
        seesPayroll
          ? payrollService.settlementDashboard().then(
              (r) => (r.data?.totals?.awaitingHr ?? 0) + (r.data?.totals?.awaitingFinance ?? 0),
            )
          : Promise.reject(),
        seesPayroll
          ? payrollService.listLoans({ status: 'PENDING', limit: 1 }).then((r) => r.meta?.total ?? 0)
          : Promise.reject(),
      ]).then(([regularization, leaveQueue, settlements, loans]) => ({
        regularization: regularization.status === 'fulfilled' ? regularization.value : null,
        leave: leaveQueue.status === 'fulfilled' ? leaveQueue.value : null,
        settlements: settlements.status === 'fulfilled' ? settlements.value : null,
        loans: loans.status === 'fulfilled' ? loans.value : null,
      })),
    [seesAttendance, seesLeave, seesPayroll],
  );

  const logins = useDashboardQuery(() => authService.loginHistory({ limit: 6 }).then((r) => r.data ?? []), []);

  const joiners = useDashboardQuery(
    () =>
      employeeService
        .list({ limit: 5, sortBy: 'createdAt', sortOrder: 'desc' })
        .then((r) => r.data ?? []),
    [],
    { enabled: seesEmployees },
  );

  const holidays = useDashboardQuery(
    () => attendanceService.holidays(year).then((r) => r.data ?? []),
    [year],
    { enabled: seesAttendance },
  );

  /* ------------------------------------------------------------- derived -- */

  /** Attendance totals for the month, summed across the per-employee rows. */
  const attendanceTotals = useMemo(() => {
    const rows = attendanceMonth.data?.rows ?? [];
    if (!rows.length) return null;

    const sum = (key) => rows.reduce((total, row) => total + (row[key] ?? 0), 0);

    const present = sum('present');
    const halfDay = sum('halfDay');
    const absent = sum('absent');
    const onLeave = sum('onLeave');
    const weeklyOff = sum('weeklyOff');
    const holiday = sum('holiday');
    // Days somebody was expected to work. Weekly offs and holidays are not,
    // so counting them would flatter the percentage.
    const scheduled = present + halfDay + absent + onLeave;

    return {
      present,
      halfDay,
      absent,
      onLeave,
      weeklyOff,
      holiday,
      missingPunch: sum('missingPunch'),
      overtimeMinutes: sum('overtimeMinutes'),
      employeesWithOvertime: rows.filter((row) => (row.overtimeMinutes ?? 0) > 0).length,
      // Half a day present counts as half, matching how payroll pays it.
      attendancePercent: scheduled ? Math.round(((present + halfDay * 0.5) / scheduled) * 100) : null,
      rows,
    };
  }, [attendanceMonth.data]);

  /**
   * The month's salary, broken into the parts that add back up to gross.
   *
   * Every figure is read off the salary register, which reads them off the
   * stored payslips -- the same numbers the Payroll Run screen prints. Net is
   * gross less what came out of the employee's pay, so the slices total gross
   * exactly and no employer contribution is mistaken for a deduction.
   */
  const salaryBreakdown = useMemo(() => {
    const rows = register.data?.rows ?? [];
    if (!rows.length) return null;

    const sum = (key) => rows.reduce((total, row) => total + (row[key] ?? 0), 0);

    /**
     * `gross` -- the register's own column that includes overtime, bonus and
     * arrears -- not `grossSalary`, which is the fixed salary alone. The run's
     * `totalGross` is the wider figure, and the KPI card above shows it, so the
     * two must be the same number. Net then comes out at the run's `totalNet`
     * exactly, because both are gross less what left the employee's pay.
     */
    const gross = sum('gross');
    const employeeDeductions = sum('employeeDeductions');
    const pf = sum('pf');
    const esi = sum('esi');
    const lwf = sum('lwf');
    const pt = sum('pt');
    const tds = sum('tds');

    return {
      gross,
      net: gross - employeeDeductions,
      pf,
      esi,
      lwf,
      pt,
      tds,
      // Loan and advance recovery and any ad-hoc line, derived from the
      // employee total so the parts always add up to it.
      other: Math.max(0, employeeDeductions - (pf + esi + lwf + pt + tds)),
      overtimeCost: sum('overtime'),
      bonus: sum('bonus'),
    };
  }, [register.data]);

  /**
   * How many people fall in each salary band, counted from the register.
   *
   * Two labels per band: the full one for the panel, and a bare one for the
   * chart's x-axis, where the symbol repeated under all five bars costs width
   * the band itself needs. The panel subtitle names the currency instead.
   */
  const salaryDistribution = useMemo(() => {
    const rows = register.data?.rows ?? [];
    if (!rows.length) return null;

    return SALARY_BANDS.map((band) => ({
      label: describeBand(band, currency.compact),
      axisLabel: describeBand(band, (value) => compactAmountIn(value, currency.code)).replace(' – ', '–'),
      value: rows.filter((row) => (row.gross ?? 0) >= band.min && (row.gross ?? 0) < band.max).length,
    }));
  }, [register.data, currency]);

  /**
   * The month's salary by department, grouped from the register.
   *
   * The register is this run's payslips, so the departments add up to the run's
   * own gross. Summing a column the register already prints, by a field it
   * already carries -- no payroll figure is derived here.
   */
  const departmentSalary = useMemo(() => {
    const rows = register.data?.rows ?? [];
    if (!rows.length) return null;

    const byDepartment = new Map();

    rows.forEach((row) => {
      const key = row.department || 'Unassigned';
      if (!byDepartment.has(key)) byDepartment.set(key, { gross: 0, headcount: 0 });

      const entry = byDepartment.get(key);
      entry.gross += row.gross ?? 0;
      entry.headcount += 1;
    });

    return [...byDepartment.entries()]
      .map(([department, entry]) => ({ label: department, value: entry.gross, caption: `${entry.headcount} employee(s)` }))
      .sort((a, b) => b.value - a.value)
      // Distinct colours so several departments are told apart, starting from
      // the primary blue for the largest.
      .map((row, index) => ({ ...row, color: DEPARTMENT_COLORS[index % DEPARTMENT_COLORS.length] }));
  }, [register.data]);

  const upcomingHolidays = useMemo(
    () =>
      (holidays.data ?? [])
        .filter((holiday) => new Date(holiday.date) >= new Date(new Date().toDateString()))
        .sort((a, b) => new Date(a.date) - new Date(b.date))
        .slice(0, 5),
    [holidays.data],
  );

  const approvalRows = useMemo(() => {
    const data = approvals.data ?? {};
    return [
      { label: 'Attendance regularizations', value: data.regularization, to: PATHS.attendanceRegularization },
      { label: 'Leave requests', value: data.leave, to: PATHS.leaveApproval },
      { label: 'Full & final settlements', value: data.settlements, to: PATHS.settlements },
      { label: 'Loan requests', value: data.loans, to: PATHS.loans },
    ].filter((row) => row.value !== null && row.value !== undefined);
  }, [approvals.data]);

  const totalApprovals = approvalRows.reduce((total, row) => total + row.value, 0);

  const noPanels = !seesEmployees && !seesAttendance && !seesPayroll && !seesLeave;

  /* -------------------------------------------------------------- render -- */

  return (
    <Box>
      <PageHeader
        title={`Welcome, ${user?.firstName ?? 'there'}`}
        subtitle={`${roleLabel} · ${SCOPE_LABELS[scope] ?? scope}`}
        actions={
          // Layout through `sx`: this MUI no longer takes `alignItems` and
          // `justifyContent` as system props on Stack.
          <Stack direction="row" spacing={1} data-print="hide" sx={{ alignItems: 'center' }}>
            {isSuperAdmin && <Chip label="Full access" color="primary" size="small" />}

            <TextField
              select
              size="small"
              label="Month"
              value={month}
              onChange={(event) => setPeriod((previous) => ({ ...previous, month: Number(event.target.value) }))}
              sx={{ width: 140 }}
            >
              {MONTHS.map((entry) => (
                <MenuItem key={entry.value} value={entry.value}>
                  {entry.label}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              select
              size="small"
              label="Year"
              value={year}
              onChange={(event) => setPeriod((previous) => ({ ...previous, year: Number(event.target.value) }))}
              sx={{ width: 110 }}
            >
              {YEARS.map((entry) => (
                <MenuItem key={entry} value={entry}>
                  {entry}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
        }
      />

      {/* ------------------------------------------------------------ KPIs -- */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        {seesEmployees && (
          <>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <StatCard
                label="Total employees"
                value={headcount.data?.total ?? 0}
                caption="Across every status"
                icon={PeopleIcon}
                to={PATHS.employees}
                loading={headcount.loading}
              />
            </Grid>

            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <StatCard
                label="Active"
                value={headcount.data?.ACTIVE ?? 0}
                caption="Confirmed and on the payroll"
                icon={BadgeIcon}
                color="success"
                to={PATHS.employees}
                loading={headcount.loading}
              />
            </Grid>

            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <StatCard
                label="On probation"
                value={headcount.data?.PROBATION ?? 0}
                caption="Yet to be confirmed"
                icon={SchoolIcon}
                color="info"
                to={PATHS.employees}
                loading={headcount.loading}
              />
            </Grid>
          </>
        )}

        {seesAttendance && (
          <>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <StatCard
                label="Attendance today"
                value={attendanceToday.data?.PRESENT ?? 0}
                caption={`of ${attendanceToday.data?.total ?? 0} recorded · ${attendanceToday.data?.ABSENT ?? 0} absent`}
                icon={EventIcon}
                color="success"
                to={PATHS.attendanceRegister}
                loading={attendanceToday.loading}
              />
            </Grid>

            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <StatCard
                label="Leaves today"
                value={attendanceToday.data?.ON_LEAVE ?? 0}
                caption="Marked on leave in the register"
                icon={BeachIcon}
                color="warning"
                to={PATHS.attendanceRegister}
                loading={attendanceToday.loading}
              />
            </Grid>
          </>
        )}

        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            label="Pending approvals"
            value={approvalRows.length ? totalApprovals : '—'}
            caption={
              approvalRows.length
                ? approvalRows.map((row) => `${row.value} ${row.label.split(' ')[0].toLowerCase()}`).join(' · ')
                : 'No queues you can act on'
            }
            icon={PendingIcon}
            color={totalApprovals > 0 ? 'warning' : 'success'}
            to={PATHS.attendanceRegularization}
            loading={approvals.loading}
          />
        </Grid>

        {seesPayroll && (
          <>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <StatCard
                label="Gross salary"
                value={run.data ? formatCurrency(run.data.totalGross) : '—'}
                caption={run.data ? `${periodLabel} · ${humanize(run.data.status)}` : `No run for ${periodLabel}`}
                icon={PaymentsIcon}
                color="primary"
                to={PATHS.payrollRuns}
                loading={run.loading}
              />
            </Grid>

            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <StatCard
                label="Net salary"
                value={run.data ? formatCurrency(run.data.totalNet) : '—'}
                caption={
                  run.data
                    ? `${run.data.employeeCount ?? 0} payslip(s) · ${formatCurrency(run.data.totalDeductions)} deducted`
                    : `No run for ${periodLabel}`
                }
                icon={WalletIcon}
                color="success"
                to={PATHS.payrollRuns}
                loading={run.loading}
              />
            </Grid>
          </>
        )}
      </Grid>

      {/* -------------------------------------------------- salary analytics -- */}
      {seesPayroll && (
        <>
          <Typography variant="h6" sx={{ mb: 1.5 }}>
            Salary analytics
          </Typography>

          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid size={12}>
              <DashboardPanel
                title="Monthly salary trend"
                subtitle={`Gross against net, ${year}`}
                loading={salaryTrend.loading}
                error={salaryTrend.error}
                onRetry={salaryTrend.reload}
                empty={!salaryTrend.data?.length}
                emptyMessage={`No payroll has been processed in ${year}, so there is no salary trend to show.`}
                minHeight={260}
                action={
                  <Link component={RouterLink} to={PATHS.payrollRuns} variant="caption">
                    Payroll runs
                  </Link>
                }
              >
                <BarChart
                  height={240}
                  format={compactCurrency}
                  series={[
                    { label: 'Gross', color: CHART_COLORS.gross },
                    { label: 'Net', color: CHART_COLORS.net },
                  ]}
                  data={(salaryTrend.data ?? []).map((entry) => ({
                    label: MONTHS[entry.month - 1]?.label.slice(0, 3) ?? String(entry.month),
                    values: [entry.totalGross ?? 0, entry.totalNet ?? 0],
                  }))}
                />
              </DashboardPanel>
            </Grid>

            <Grid size={{ xs: 12, md: 6 }}>
              <DashboardPanel
                title="Salary breakdown"
                subtitle={`${periodLabel} · from the salary register`}
                loading={run.loading || register.loading}
                error={register.error}
                onRetry={register.reload}
                empty={!salaryBreakdown}
                emptyMessage={`No salary data available for ${periodLabel}.`}
                minHeight={260}
              >
                {salaryBreakdown && (
                  <DonutChart
                    format={formatCurrency}
                    centerValue={compactCurrency(salaryBreakdown.gross)}
                    centerLabel="Gross"
                    data={[
                      { label: 'Net pay', value: salaryBreakdown.net, color: CHART_COLORS.net },
                      { label: 'Employee PF', value: salaryBreakdown.pf, color: CHART_COLORS.pf },
                      { label: 'Employee ESI', value: salaryBreakdown.esi, color: CHART_COLORS.esi },
                      { label: 'Employee LWF', value: salaryBreakdown.lwf, color: CHART_COLORS.lwf },
                      { label: 'Professional tax', value: salaryBreakdown.pt, color: CHART_COLORS.pending },
                      { label: 'TDS', value: salaryBreakdown.tds, color: CHART_COLORS.tax },
                      { label: 'Other deductions', value: salaryBreakdown.other, color: CHART_COLORS.other },
                    ]}
                  />
                )}
              </DashboardPanel>
            </Grid>

            <Grid size={{ xs: 12, md: 6 }}>
              <DashboardPanel
                title="Department-wise salary"
                subtitle={`${periodLabel} · gross by department`}
                loading={run.loading || register.loading}
                error={register.error}
                onRetry={register.reload}
                empty={!departmentSalary?.length}
                emptyMessage={`No payroll data available for ${periodLabel}.`}
                minHeight={260}
              >
                <HorizontalBars format={formatCurrency} data={departmentSalary ?? []} />
              </DashboardPanel>
            </Grid>

            <Grid size={{ xs: 12, md: 6 }}>
              <DashboardPanel
                title="Salary distribution"
                subtitle={`${periodLabel} · employees per monthly gross band (${currency.symbol})`}
                loading={run.loading || register.loading}
                error={register.error}
                onRetry={register.reload}
                empty={!salaryDistribution}
                emptyMessage={`No salary data available for ${periodLabel}.`}
                minHeight={220}
              >
                <BarChart
                  height={180}
                  showLegend={false}
                  format={(value) => Math.round(value)}
                  /* One bar per band, each its own colour so the ranges are
                     told apart at a glance rather than by reading the axis. */
                  series={[{ label: '' }]}
                  colorByCategory={[
                    CHART_COLORS.leave,
                    CHART_COLORS.pf,
                    CHART_COLORS.net,
                    CHART_COLORS.esi,
                    CHART_COLORS.lwf,
                  ]}
                  data={(salaryDistribution ?? []).map((band) => ({
                    label: band.axisLabel,
                    values: [band.value],
                  }))}
                />
              </DashboardPanel>
            </Grid>

            <Grid size={{ xs: 12, md: 6 }}>
              <DashboardPanel
                title="Overtime"
                subtitle={`${year} · hours from the attendance record`}
                loading={overtimeTrend.loading || attendanceMonth.loading}
                error={overtimeTrend.error}
                onRetry={overtimeTrend.reload}
                empty={!overtimeTrend.data?.months?.length}
                emptyMessage={`No overtime recorded in ${year}.`}
                minHeight={220}
              >
                <Stack spacing={1.5}>
                  <Stack direction="row" spacing={3} useFlexGap sx={{ flexWrap: 'wrap' }}>
                    <Box>
                      <Typography variant="h6">{toHours(attendanceTotals?.overtimeMinutes ?? 0)} h</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {periodLabel}
                      </Typography>
                    </Box>
                    <Box>
                      <Typography variant="h6">{attendanceTotals?.employeesWithOvertime ?? 0}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        Employees with overtime
                      </Typography>
                    </Box>
                    <Box>
                      <Typography variant="h6">
                        {salaryBreakdown ? formatCurrency(salaryBreakdown.overtimeCost) : '—'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Overtime paid
                      </Typography>
                    </Box>
                  </Stack>

                  <BarChart
                    height={140}
                    showLegend={false}
                    format={(value) => `${Math.round(value)}h`}
                    series={[{ label: '', color: CHART_COLORS.overtime }]}
                    data={(overtimeTrend.data?.months ?? []).map((entry) => ({
                      label: MONTHS[entry.month - 1]?.label.slice(0, 3) ?? String(entry.month),
                      values: [toHours(entry.overtimeMinutes)],
                    }))}
                  />
                </Stack>
              </DashboardPanel>
            </Grid>
          </Grid>
        </>
      )}

      {/* ------------------------------------ attendance, leave, approvals -- */}
      <Typography variant="h6" sx={{ mb: 1.5 }}>
        Attendance &amp; leave
      </Typography>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        {seesAttendance && (
          <Grid size={{ xs: 12, md: 6 }}>
            <DashboardPanel
              title="Attendance analytics"
              subtitle={periodLabel}
              loading={attendanceMonth.loading}
              error={attendanceMonth.error}
              onRetry={attendanceMonth.reload}
              empty={!attendanceTotals}
              emptyMessage={`No attendance data available for ${periodLabel}.`}
              minHeight={260}
              action={
                <Link component={RouterLink} to={PATHS.attendanceMonthly} variant="caption">
                  Monthly register
                </Link>
              }
            >
              {attendanceTotals && (
                <Stack spacing={2}>
                  <DonutChart
                    size={168}
                    format={(value) => `${value} day(s)`}
                    centerValue={
                      attendanceTotals.attendancePercent === null
                        ? '—'
                        : `${attendanceTotals.attendancePercent}%`
                    }
                    centerLabel="Attendance"
                    data={[
                      { label: 'Present', value: attendanceTotals.present, color: CHART_COLORS.present },
                      { label: 'Half day', value: attendanceTotals.halfDay, color: CHART_COLORS.halfDay },
                      { label: 'Absent', value: attendanceTotals.absent, color: CHART_COLORS.absent },
                      { label: 'Leave', value: attendanceTotals.onLeave, color: CHART_COLORS.leave },
                      { label: 'Weekly off', value: attendanceTotals.weeklyOff, color: CHART_COLORS.weeklyOff },
                      { label: 'Holiday', value: attendanceTotals.holiday, color: CHART_COLORS.holiday },
                    ]}
                  />

                  <Divider />

                  <Stack direction="row" spacing={3} useFlexGap sx={{ flexWrap: 'wrap' }}>
                    {[
                      ['Present days', attendanceTotals.present],
                      ['Absent days', attendanceTotals.absent],
                      ['Leave days', attendanceTotals.onLeave],
                    ].map(([label, value]) => (
                      <Box key={label}>
                        <Typography variant="subtitle2">{value}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {label}
                        </Typography>
                      </Box>
                    ))}
                  </Stack>
                </Stack>
              )}
            </DashboardPanel>
          </Grid>
        )}

        {seesLeave && (
          <Grid size={{ xs: 12, md: 6 }}>
            <DashboardPanel
              title="Leave overview"
              subtitle={`Applications dated in ${periodLabel}`}
              loading={leave.loading}
              error={leave.error}
              onRetry={leave.reload}
              empty={!leave.data?.total}
              emptyMessage={`No leave applications for ${periodLabel}.`}
              minHeight={260}
              action={
                <Link component={RouterLink} to={PATHS.leave} variant="caption">
                  All requests
                </Link>
              }
            >
              {leave.data && (
                <Stack spacing={2}>
                  <DonutChart
                    size={168}
                    format={(value) => `${value} application(s)`}
                    centerValue={leave.data.total}
                    centerLabel="Applications"
                    data={[
                      { label: 'Approved', value: leave.data.approved, color: CHART_COLORS.approved },
                      { label: 'Pending', value: leave.data.pending, color: CHART_COLORS.pending },
                      { label: 'Rejected', value: leave.data.rejected, color: CHART_COLORS.rejected },
                    ]}
                  />

                  {seesAttendance && attendanceTotals && (
                    <>
                      <Divider />
                      <Box>
                        <Typography variant="subtitle2">{attendanceTotals.onLeave}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          Leave days taken this month, from the attendance register
                        </Typography>
                      </Box>
                    </>
                  )}
                </Stack>
              )}
            </DashboardPanel>
          </Grid>
        )}

        <Grid size={{ xs: 12, md: 6 }}>
          <DashboardPanel
            title="Pending approvals"
            subtitle="Queues you can act on"
            loading={approvals.loading}
            error={approvals.error}
            onRetry={approvals.reload}
            empty={!approvalRows.length}
            emptyMessage="Nothing in your queues."
            minHeight={200}
          >
            <Stack spacing={1}>
              {approvalRows.map((row) => (
                <Stack
                  key={row.label}
                  direction="row"
                  spacing={1}
                  sx={{ justifyContent: 'space-between', alignItems: 'center' }}
                >
                  <Link component={RouterLink} to={row.to} variant="body2" underline="hover" noWrap>
                    {row.label}
                  </Link>
                  <Chip
                    label={row.value}
                    size="small"
                    color={row.value ? 'warning' : 'default'}
                    variant={row.value ? 'filled' : 'outlined'}
                  />
                </Stack>
              ))}
            </Stack>
          </DashboardPanel>
        </Grid>

        {seesAttendance && (
          <Grid size={{ xs: 12, md: 6 }}>
            <DashboardPanel
              title="Upcoming holidays"
              subtitle={`Calendar ${year}`}
              loading={holidays.loading}
              error={holidays.error}
              onRetry={holidays.reload}
              empty={!upcomingHolidays.length}
              emptyMessage={`No holidays left in the ${year} calendar.`}
              minHeight={200}
              action={
                <Link component={RouterLink} to={PATHS.holidays} variant="caption">
                  Calendar
                </Link>
              }
            >
              <Stack spacing={1.25}>
                {upcomingHolidays.map((holiday) => (
                  <Stack
                    key={holiday._id}
                    direction="row"
                    spacing={1}
                    sx={{ justifyContent: 'space-between', alignItems: 'center' }}
                  >
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body2" noWrap>
                        {holiday.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {formatDate(holiday.date)} ·{' '}
                        {new Date(holiday.date).toLocaleDateString('en-IN', { weekday: 'long' })}
                      </Typography>
                    </Box>
                    <Chip label={humanize(holiday.type)} size="small" variant="outlined" />
                  </Stack>
                ))}
              </Stack>
            </DashboardPanel>
          </Grid>
        )}
      </Grid>

      {/* -------------------------------------------------- recent activity -- */}
      <Typography variant="h6" sx={{ mb: 1.5 }}>
        Recent activity
      </Typography>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 6 }}>
          <DashboardPanel
            title="Recent logins"
            subtitle="Your sign-in history"
            loading={logins.loading}
            error={logins.error}
            onRetry={logins.reload}
            empty={!logins.data?.length}
            emptyMessage="No sign-in activity recorded for your account."
            minHeight={200}
            action={
              <Link component={RouterLink} to={PATHS.loginHistory} variant="caption">
                View all
              </Link>
            }
          >
            <Stack spacing={1.25}>
              {(logins.data ?? []).map((entry, index) => (
                <Stack
                  key={`${entry.occurredAt}-${index}`}
                  direction="row"
                  spacing={1}
                  sx={{ justifyContent: 'space-between', alignItems: 'center' }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" noWrap>
                      {humanize(entry.event)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap>
                      {formatDateTime(entry.occurredAt)} · {entry.ip ?? 'unknown IP'}
                    </Typography>
                  </Box>
                  <Chip
                    label={humanize(entry.status)}
                    size="small"
                    color={entry.status === 'SUCCESS' ? 'success' : 'error'}
                    variant="outlined"
                  />
                </Stack>
              ))}
            </Stack>
          </DashboardPanel>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <DashboardPanel
            title="Recently added employees"
            subtitle="Newest records in the directory"
            loading={joiners.loading}
            error={joiners.error}
            onRetry={joiners.reload}
            empty={!joiners.data?.length}
            emptyMessage={
              seesEmployees
                ? 'No employees have been added yet.'
                : 'Your role does not include the employee directory.'
            }
            minHeight={200}
            action={
              seesEmployees ? (
                <Link component={RouterLink} to={PATHS.employees} variant="caption">
                  All employees
                </Link>
              ) : null
            }
          >
            <Stack spacing={1.25}>
              {(joiners.data ?? []).map((employee) => (
                <Stack
                  key={getRowId(employee)}
                  direction="row"
                  spacing={1}
                  sx={{ justifyContent: 'space-between', alignItems: 'center' }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Link
                      component={RouterLink}
                      to={PATHS.employeeDetail(getRowId(employee))}
                      variant="body2"
                      underline="hover"
                      noWrap
                    >
                      {displayName(employee)}
                    </Link>
                    <Typography variant="caption" color="text.secondary" display="block" noWrap>
                      {employeeIdentifiers(employee)} · joined {formatDate(employee.joiningDate)} ·{' '}
                      {formatRelative(employee.createdAt)}
                    </Typography>
                  </Box>
                  <StatusChip status={employee.status} />
                </Stack>
              ))}
            </Stack>
          </DashboardPanel>
        </Grid>
      </Grid>

      {noPanels && (
        <Alert severity="info" sx={{ mt: 2 }} icon={<HistoryIcon />}>
          Your role has a narrow scope, so most summary panels are hidden. Use the sidebar to reach what you
          do have access to.
        </Alert>
      )}
    </Box>
  );
};

export default DashboardPage;
