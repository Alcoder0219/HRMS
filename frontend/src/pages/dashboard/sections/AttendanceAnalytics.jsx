import { Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import DashboardPanel from '../components/DashboardPanel.jsx';
import { BarChart, CHART_COLORS, DonutChart, HorizontalBars, LineChart } from '../components/Charts.jsx';
import { PATHS } from '@routes/paths.js';

/**
 * The month's attendance: what the days were, how they ran, by department, and
 * what needs fixing. Every figure is the attendance module's own (the monthly
 * summary and the stored day records), narrowed by the dashboard's filters.
 */

const Figure = ({ label, value, color }) => (
  <Box sx={{ minWidth: 0 }}>
    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
      <Box sx={{ width: 8, height: 8, borderRadius: 0.5, bgcolor: color, flexShrink: 0 }} />
      <Typography variant="caption" color="text.secondary" noWrap>
        {label}
      </Typography>
    </Stack>
    <Typography variant="subtitle1" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
      {value}
    </Typography>
  </Box>
);

const ExceptionRow = ({ label, hint, value, to = null }) => (
  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between', py: 0.75 }}>
    <Box sx={{ minWidth: 0 }}>
      {to ? (
        <Link component={RouterLink} to={to} variant="body2" underline="hover">
          {label}
        </Link>
      ) : (
        <Typography variant="body2">{label}</Typography>
      )}
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }} noWrap>
        {hint}
      </Typography>
    </Box>
    <Chip size="small" label={value ?? '—'} color={value ? 'warning' : 'default'} variant={value ? 'filled' : 'outlined'} />
  </Stack>
);

/** Minutes as decimal hours, for a figure read as "hours worked". */
const toHours = (minutes) => Math.round(((Number(minutes) || 0) / 60) * 10) / 10;

const AttendanceAnalytics = ({ query, periodLabel, year, overtimePaid = null }) => {
  const data = query.data;
  const totals = data?.totals;
  const common = { loading: query.loading, error: query.error, onRetry: query.reload };
  const empty = !totals || totals.employees === 0;

  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, lg: 5 }}>
        <DashboardPanel
          title="Attendance summary"
          subtitle={`${periodLabel} · days across ${totals?.employees ?? 0} employee(s)`}
          {...common}
          empty={empty}
          emptyMessage={`No attendance recorded for ${periodLabel}.`}
          minHeight={260}
          action={
            <Link component={RouterLink} to={PATHS.attendanceMonthly} variant="caption">
              Monthly register
            </Link>
          }
        >
          {totals && (
            <Stack spacing={2}>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)' }, gap: 1.5 }}>
                <Figure label="Present" value={totals.present} color={CHART_COLORS.present} />
                <Figure label="Absent" value={totals.absent} color={CHART_COLORS.absent} />
                <Figure label="Half day" value={totals.halfDay} color={CHART_COLORS.halfDay} />
                <Figure label="On leave" value={totals.onLeave} color={CHART_COLORS.leave} />
                <Figure label="Weekly off" value={totals.weeklyOff} color={CHART_COLORS.weeklyOff} />
                <Figure label="Missing punch" value={totals.missingPunch} color={CHART_COLORS.pending} />
              </Box>
              <DonutChart
                size={150}
                format={(value) => `${value} day(s)`}
                centerValue={totals.attendancePercent === null ? '—' : `${totals.attendancePercent}%`}
                centerLabel="Attendance"
                data={[
                  { label: 'Present', value: totals.present, color: CHART_COLORS.present },
                  { label: 'Half day', value: totals.halfDay, color: CHART_COLORS.halfDay },
                  { label: 'Absent', value: totals.absent, color: CHART_COLORS.absent },
                  { label: 'On leave', value: totals.onLeave, color: CHART_COLORS.leave },
                  { label: 'Weekly off', value: totals.weeklyOff, color: CHART_COLORS.weeklyOff },
                  { label: 'Holiday', value: totals.holiday, color: CHART_COLORS.holiday },
                  { label: 'Missing punch', value: totals.missingPunch, color: CHART_COLORS.pending },
                ]}
              />
            </Stack>
          )}
        </DashboardPanel>
      </Grid>

      <Grid size={{ xs: 12, lg: 7 }}>
        <DashboardPanel
          title="Daily attendance trend"
          subtitle={`${periodLabel} · employees per day, from the day records`}
          {...common}
          empty={!data?.trend?.length}
          emptyMessage={`Nothing to chart for ${periodLabel} yet.`}
          minHeight={260}
        >
          <LineChart
            height={230}
            data={(data?.trend ?? []).map((day) => ({ ...day, label: String(day.day) }))}
            tooltipLabel={(day) => `${day.day} ${periodLabel}`}
            series={[
              { key: 'present', label: 'Present', color: CHART_COLORS.present },
              { key: 'absent', label: 'Absent', color: CHART_COLORS.absent },
              { key: 'onLeave', label: 'On leave', color: CHART_COLORS.leave },
              { key: 'halfDay', label: 'Half day', color: CHART_COLORS.halfDay },
            ]}
          />
        </DashboardPanel>
      </Grid>

      <Grid size={{ xs: 12, md: 7 }}>
        <DashboardPanel
          title="Department-wise attendance"
          subtitle={`${periodLabel} · present days over working days (half day counts half)`}
          {...common}
          empty={!data?.byDepartment?.length}
          emptyMessage={`No working days recorded for ${periodLabel}.`}
          minHeight={220}
        >
          <Box sx={{ maxHeight: 300, overflowY: 'auto', pr: 0.5 }}>
            <HorizontalBars
              max={100}
              format={(value) => `${value}%`}
              data={(data?.byDepartment ?? []).map((row) => ({
                label: row.label,
                value: row.value,
                caption: `${row.scheduled} working day(s)`,
                color: row.value >= 90 ? CHART_COLORS.present : row.value >= 75 ? CHART_COLORS.pending : CHART_COLORS.absent,
              }))}
            />
          </Box>
        </DashboardPanel>
      </Grid>

      <Grid size={{ xs: 12, md: 5 }}>
        <DashboardPanel title="Attendance exceptions" subtitle={`${periodLabel} · to resolve before payroll`} {...common} empty={!data} minHeight={220}>
          {data && (
            <Stack divider={<Box sx={{ borderTop: 1, borderColor: 'divider' }} />}>
              <ExceptionRow label="Missing IN punch" hint="A day with no check-in recorded" value={data.exceptions.missingIn} to={PATHS.attendanceMonthly} />
              <ExceptionRow label="Missing OUT punch" hint="Checked in, no check-out" value={data.exceptions.missingOut} to={PATHS.attendanceMonthly} />
              <ExceptionRow label="Late arrivals" hint="Days marked late this month" value={data.exceptions.lateArrivals} to={PATHS.attendanceReports} />
              <ExceptionRow
                label="Regularizations pending"
                hint="Correction requests awaiting a decision"
                value={data.exceptions.pendingRegularizations}
                to={PATHS.attendanceRegularization}
              />
            </Stack>
          )}
        </DashboardPanel>
      </Grid>

      <Grid size={12}>
        <DashboardPanel
          title="Overtime"
          subtitle={`${year} · hours from the attendance record`}
          {...common}
          empty={!data}
          minHeight={200}
        >
          {data && (
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} sx={{ alignItems: { md: 'center' } }}>
              <Stack direction={{ xs: 'row', md: 'column' }} spacing={2} useFlexGap sx={{ flexWrap: 'wrap', minWidth: 190 }}>
                {[
                  [periodLabel, `${toHours(totals?.overtimeMinutes)} h`],
                  ['Employees with overtime', totals?.employeesWithOvertime ?? 0],
                  ...(overtimePaid !== null ? [['Overtime paid', overtimePaid]] : []),
                ].map(([label, value]) => (
                  <Box key={label}>
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                      {label}
                    </Typography>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                      {value}
                    </Typography>
                  </Box>
                ))}
              </Stack>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                {data.overtimeTrend?.length ? (
                  <BarChart
                    height={150}
                    showLegend={false}
                    format={(value) => `${Math.round(value)}h`}
                    series={[{ label: 'Overtime', color: CHART_COLORS.overtime }]}
                    data={data.overtimeTrend.map((entry) => ({
                      label: new Date(2000, entry.month - 1).toLocaleString(['en-TZ', 'en-GB'], { month: 'short' }),
                      values: [toHours(entry.overtimeMinutes)],
                    }))}
                  />
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    No overtime recorded in {year}.
                  </Typography>
                )}
              </Box>
            </Stack>
          )}
        </DashboardPanel>
      </Grid>
    </Grid>
  );
};

export default AttendanceAnalytics;
