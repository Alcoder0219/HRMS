import { useCallback, useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import EventIcon from '@mui/icons-material/EventAvailableOutlined';
import TimerIcon from '@mui/icons-material/TimerOutlined';
import MoreTimeIcon from '@mui/icons-material/MoreTimeOutlined';
import WarningIcon from '@mui/icons-material/RunningWithErrorsOutlined';

import PageHeader from '@components/common/PageHeader.jsx';
import DataTable from '@components/common/DataTable.jsx';
import StatCard from '@components/common/StatCard.jsx';
import ExportMenu from '@components/common/ExportMenu.jsx';
import EmployeePicker from '@components/common/EmployeePicker.jsx';
import AttendanceStatusChip from '@components/common/AttendanceStatusChip.jsx';
import { EmptyState, LoadingState, ErrorState } from '@components/common/StateBlock.jsx';
import attendanceService from '@services/modules/attendance.service.js';
import { formatDate, humanize } from '@utils/format.js';
import { getRowId, displayName, employeeIdentifiers } from '@utils/dataGrid.js';
import { PATHS } from '@routes/paths.js';

const MONTHS = Array.from({ length: 12 }, (_, index) => ({
  value: index + 1,
  label: new Date(2000, index).toLocaleString([], { month: 'long' }),
}));

const now = new Date();
const YEARS = Array.from({ length: 5 }, (_, index) => now.getFullYear() - 3 + index);

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Cell colour by status. Present is deliberately the quietest of them. */
const STATUS_STYLE = {
  PRESENT: { bg: 'success.light', fg: 'success.contrastText', code: 'P' },
  HALF_DAY: { bg: 'warning.light', fg: 'warning.contrastText', code: 'H' },
  ABSENT: { bg: 'error.light', fg: 'error.contrastText', code: 'A' },
  ON_LEAVE: { bg: 'info.light', fg: 'info.contrastText', code: 'L' },
  HOLIDAY: { bg: 'action.selected', fg: 'text.secondary', code: 'HO' },
  WEEKLY_OFF: { bg: 'action.hover', fg: 'text.secondary', code: 'WO' },
  MISSING_PUNCH: { bg: 'error.light', fg: 'error.contrastText', code: 'MP' },
  ON_DUTY: { bg: 'primary.light', fg: 'primary.contrastText', code: 'OD' },
  WORK_FROM_HOME: { bg: 'primary.light', fg: 'primary.contrastText', code: 'WFH' },
};

const timeOf = (value) =>
  value ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';

const hoursOf = (minutes) => (minutes ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : '—');

/**
 * The imported sheet's own rows -- raw HH:mm strings from the workbook, not
 * graded attendance. Kept deliberately plain so it reads as a transcript.
 */
const SHEET_COLUMNS = [
  { key: 'day', label: 'Day', width: 80 },
  { key: 'inTime', label: 'In', render: (row) => row.inTime || '—' },
  { key: 'outTime', label: 'Out', render: (row) => row.outTime || '—' },
  {
    key: 'remark',
    label: 'Remark',
    render: (row) => (
      <Typography variant="caption" color="text.secondary">
        {row.remark || '—'}
      </Typography>
    ),
  },
];

/**
 * One employee's attendance, month by month.
 *
 * The calendar and the day list read the same `/attendance/me/calendar`
 * response -- the endpoint accepts an `employeeId`, so an administrator sees
 * anyone's month through the same code path an employee uses for their own.
 * Two views of one dataset, rather than two requests that could disagree.
 */
const AttendanceHistoryPage = () => {
  const [employee, setEmployee] = useState(null);
  const [period, setPeriod] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const [tab, setTab] = useState('calendar');

  const [days, setDays] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // The imported workbook row for this month, if one exists. Distinct from the
  // graded calendar above -- see the Sheet tab.
  const [sheet, setSheet] = useState(null);
  const [sheetState, setSheetState] = useState('idle');

  const employeeId = employee ? getRowId(employee) : null;

  const load = useCallback(() => {
    if (!employeeId) {
      setDays([]);
      return;
    }

    setLoading(true);
    setError(null);

    attendanceService
      .myCalendar({ employeeId, year: period.year, month: period.month })
      .then((response) => setDays(response.data?.days ?? response.data ?? []))
      .catch((rejection) => {
        setDays([]);
        setError(rejection?.message ?? 'Could not load this month');
      })
      .finally(() => setLoading(false));
  }, [employeeId, period.year, period.month]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * The imported sheet for the same month.
   *
   * A 404 here is an ordinary outcome, not an error: most months are recorded
   * by punching rather than by importing a workbook. The tab says which.
   */
  useEffect(() => {
    if (!employee) {
      setSheet(null);
      setSheetState('idle');
      return;
    }

    setSheetState('loading');

    attendanceService
      // Matched on the employee CODE, which is the identifier the workbook
      // carries -- the sheet has no ObjectId in it.
      .employeeMonth({ employeeId: employee.employeeCode, year: period.year, month: period.month })
      .then((response) => {
        setSheet(response.data ?? null);
        setSheetState('found');
      })
      .catch(() => {
        setSheet(null);
        setSheetState('none');
      });
  }, [employee, period.year, period.month]);

  const totals = useMemo(() => {
    const count = (status) => days.filter((day) => day.status === status).length;

    return {
      present: count('PRESENT'),
      halfDay: count('HALF_DAY'),
      absent: count('ABSENT'),
      leave: count('ON_LEAVE'),
      missing: count('MISSING_PUNCH'),
      late: days.filter((day) => (day.lateMinutes ?? 0) > 0).length,
      early: days.filter((day) => (day.earlyGoingMinutes ?? 0) > 0).length,
      overtimeMinutes: days.reduce((sum, day) => sum + (day.overtimeMinutes ?? 0), 0),
      workedMinutes: days.reduce((sum, day) => sum + (day.workedMinutes ?? 0), 0),
    };
  }, [days]);

  /**
   * Days laid out as weeks, padded so the first lands under its weekday.
   *
   * Without the leading blanks the grid reads as a list and the point of a
   * calendar -- seeing that every absence is a Monday -- is lost.
   */
  const weeks = useMemo(() => {
    if (!days.length) return [];

    const first = new Date(days[0].date);
    const leading = first.getDay();

    const cells = [...Array(leading).fill(null), ...days];
    const result = [];

    for (let index = 0; index < cells.length; index += 7) {
      result.push(cells.slice(index, index + 7));
    }

    return result;
  }, [days]);

  const columns = [
    {
      key: 'date',
      label: 'Date',
      width: 140,
      exportValue: (row) => formatDate(row.date),
      render: (row) => (
        <Box>
          <Typography variant="body2">{formatDate(row.date)}</Typography>
          <Typography variant="caption" color="text.secondary">
            {new Date(row.date).toLocaleDateString([], { weekday: 'short' })}
          </Typography>
        </Box>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      exportValue: (row) => humanize(row.status),
      render: (row) => <AttendanceStatusChip status={row.status} />,
    },
    { key: 'checkInAt', label: 'In', exportValue: (row) => timeOf(row.checkInAt), render: (row) => timeOf(row.checkInAt) },
    { key: 'checkOutAt', label: 'Out', exportValue: (row) => timeOf(row.checkOutAt), render: (row) => timeOf(row.checkOutAt) },
    {
      key: 'workedMinutes',
      label: 'Worked',
      align: 'right',
      exportValue: (row) => row.workedMinutes,
      render: (row) => hoursOf(row.workedMinutes),
    },
    {
      key: 'lateMinutes',
      label: 'Late',
      align: 'right',
      exportValue: (row) => row.lateMinutes,
      render: (row) =>
        row.lateMinutes ? <Chip label={`${row.lateMinutes}m`} size="small" color="warning" variant="outlined" /> : '—',
    },
    {
      key: 'earlyGoingMinutes',
      label: 'Early out',
      align: 'right',
      exportValue: (row) => row.earlyGoingMinutes,
      render: (row) =>
        row.earlyGoingMinutes ? (
          <Chip label={`${row.earlyGoingMinutes}m`} size="small" color="warning" variant="outlined" />
        ) : (
          '—'
        ),
    },
    {
      key: 'overtimeMinutes',
      label: 'Overtime',
      align: 'right',
      exportValue: (row) => row.overtimeMinutes,
      render: (row) =>
        row.overtimeMinutes ? (
          <Chip label={hoursOf(row.overtimeMinutes)} size="small" color="success" variant="outlined" />
        ) : (
          '—'
        ),
    },
    {
      key: 'anomalies',
      label: 'Flags',
      exportValue: (row) => (row.anomalies ?? []).join(', '),
      render: (row) =>
        row.anomalies?.length ? (
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
            {row.anomalies.map((anomaly) => (
              <Chip key={anomaly} label={humanize(anomaly)} size="small" variant="outlined" color="error" />
            ))}
          </Stack>
        ) : (
          '—'
        ),
    },
  ];

  return (
    <Box>
      <PageHeader
        title="Attendance History"
        subtitle="One employee's month, as a calendar and as a day-by-day record"
        breadcrumbs={[
          { label: 'Home', to: PATHS.dashboard },
          { label: 'Attendance', to: PATHS.attendance },
          { label: 'History' },
        ]}
        actions={
          employee ? (
            <ExportMenu
              columns={columns}
              rows={days}
              filename={`attendance-${employee.employeeCode ?? 'employee'}-${period.year}-${String(period.month).padStart(2, '0')}`}
              totalCount={days.length}
              onError={(message) => setError(message)}
            />
          ) : null
        }
      />

      <Stack direction="row" spacing={1} sx={{ mb: 3 }} flexWrap="wrap" useFlexGap data-print="hide">
        <EmployeePicker
          value={employee}
          onChange={setEmployee}
          label="Employee"
          sx={{ width: { xs: '100%', sm: 340 } }}
        />

        <TextField
          select
          size="small"
          label="Year"
          value={period.year}
          onChange={(event) => setPeriod((previous) => ({ ...previous, year: Number(event.target.value) }))}
          sx={{ width: 120 }}
        >
          {YEARS.map((year) => (
            <MenuItem key={year} value={year}>
              {year}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          select
          size="small"
          label="Month"
          value={period.month}
          onChange={(event) => setPeriod((previous) => ({ ...previous, month: Number(event.target.value) }))}
          sx={{ width: 150 }}
        >
          {MONTHS.map((month) => (
            <MenuItem key={month.value} value={month.value}>
              {month.label}
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      {!employee && (
        <EmptyState
          icon={EventIcon}
          title="Choose an employee"
          message="Search above to see their attendance calendar and day-by-day history."
          minHeight={280}
        />
      )}

      {employee && loading && <LoadingState message="Loading the month…" minHeight={280} />}

      {employee && error && <ErrorState message={error} onRetry={load} minHeight={280} />}

      {employee && !loading && !error && (
        <>
          <Card variant="outlined" sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h6">{displayName(employee)}</Typography>
              <Typography variant="caption" color="text.secondary">
                {employeeIdentifiers(employee)}
                {employee.departmentId?.name ? ` · ${employee.departmentId.name}` : ''}
              </Typography>
            </CardContent>
          </Card>

          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid size={{ xs: 6, sm: 4, md: 3 }}>
              <StatCard label="Present" value={totals.present} caption={`${totals.halfDay} half day(s)`} icon={EventIcon} color="success" />
            </Grid>
            <Grid size={{ xs: 6, sm: 4, md: 3 }}>
              <StatCard label="Absent" value={totals.absent} caption={`${totals.leave} on leave`} color="error" />
            </Grid>
            <Grid size={{ xs: 6, sm: 4, md: 3 }}>
              <StatCard
                label="Late / early"
                value={`${totals.late} / ${totals.early}`}
                caption="Days with a tolerance breach"
                icon={WarningIcon}
                color="warning"
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 4, md: 3 }}>
              <StatCard label="Overtime" value={hoursOf(totals.overtimeMinutes)} caption={`Worked ${hoursOf(totals.workedMinutes)}`} icon={MoreTimeIcon} />
            </Grid>
          </Grid>

          <Tabs value={tab} onChange={(_event, next) => setTab(next)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
            <Tab value="calendar" label="Calendar" />
            <Tab value="days" label={`Day by day (${days.length})`} />
            {/* Only offered when a workbook actually produced a sheet for this
                month; most months are punched rather than imported. */}
            {sheetState === 'found' && <Tab value="sheet" label="As imported" />}
          </Tabs>

          {tab === 'calendar' ? (
            <Paper variant="outlined" sx={{ p: 2, overflowX: 'auto' }} data-print="table">
              <Box sx={{ minWidth: 560 }}>
                <Grid container columns={7} spacing={1} sx={{ mb: 1 }}>
                  {WEEKDAYS.map((weekday) => (
                    <Grid key={weekday} size={1}>
                      <Typography variant="caption" color="text.secondary" align="center" display="block">
                        {weekday}
                      </Typography>
                    </Grid>
                  ))}
                </Grid>

                {weeks.map((week, weekIndex) => (
                  <Grid container columns={7} spacing={1} key={weekIndex} sx={{ mb: 1 }}>
                    {week.map((day, dayIndex) => {
                      if (!day) return <Grid key={`pad-${dayIndex}`} size={1} />;

                      const style = STATUS_STYLE[day.status] ?? {
                        bg: 'background.paper',
                        fg: 'text.primary',
                        code: '—',
                      };

                      const detail = [
                        humanize(day.status),
                        day.checkInAt ? `In ${timeOf(day.checkInAt)}` : null,
                        day.checkOutAt ? `Out ${timeOf(day.checkOutAt)}` : null,
                        day.lateMinutes ? `Late ${day.lateMinutes}m` : null,
                        day.earlyGoingMinutes ? `Early out ${day.earlyGoingMinutes}m` : null,
                        day.overtimeMinutes ? `Overtime ${hoursOf(day.overtimeMinutes)}` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ');

                      return (
                        <Grid key={day.date} size={1}>
                          <Tooltip title={detail} arrow>
                            <Box
                              sx={{
                                bgcolor: style.bg,
                                color: style.fg,
                                borderRadius: 1,
                                p: 1,
                                minHeight: 66,
                                border: 1,
                                borderColor: 'divider',
                              }}
                            >
                              <Typography variant="caption" sx={{ opacity: 0.8 }}>
                                {new Date(day.date).getDate()}
                              </Typography>
                              <Typography variant="body2" fontWeight={700}>
                                {style.code}
                              </Typography>
                              {/* A tolerance breach is worth seeing without
                                  hovering; it is the thing being looked for. */}
                              {(day.lateMinutes > 0 || day.earlyGoingMinutes > 0) && (
                                <Typography variant="caption" display="block" sx={{ fontSize: 10 }}>
                                  {day.lateMinutes > 0 ? `L${day.lateMinutes}` : ''}
                                  {day.earlyGoingMinutes > 0 ? ` E${day.earlyGoingMinutes}` : ''}
                                </Typography>
                              )}
                            </Box>
                          </Tooltip>
                        </Grid>
                      );
                    })}
                  </Grid>
                ))}

                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 2 }}>
                  {Object.entries(STATUS_STYLE).map(([status, style]) => (
                    <Stack key={status} direction="row" spacing={0.5} alignItems="center">
                      <Box sx={{ width: 14, height: 14, borderRadius: 0.5, bgcolor: style.bg, border: 1, borderColor: 'divider' }} />
                      <Typography variant="caption" color="text.secondary">
                        {style.code} — {humanize(status)}
                      </Typography>
                    </Stack>
                  ))}
                </Stack>
              </Box>
            </Paper>
          ) : tab === 'days' ? (
            <DataTable
              columns={columns}
              rows={days}
              getKey={(row) => row.date}
              emptyTitle="No days recorded"
              emptyMessage="Nothing has been recorded for this employee in this month."
            />
          ) : (
            <>
              <Alert severity="info" sx={{ mb: 2 }}>
                The times exactly as the workbook supplied them. The calendar and day list above show what
                the rules engine graded from these — when the two disagree, this is what was uploaded.
              </Alert>

              <DataTable
                columns={SHEET_COLUMNS}
                rows={sheet?.attendance ?? []}
                getKey={(row) => row.day}
                emptyTitle="The sheet has no day rows"
              />

              <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                Imported {sheet?.fileName ? `from ${sheet.fileName} ` : ''}
                {sheet?.uploadedAt ? `on ${formatDate(sheet.uploadedAt)}` : ''}
                {sheet?.unit ? ` · unit ${sheet.unit}` : ''}
              </Typography>
            </>
          )}
        </>
      )}
    </Box>
  );
};

export default AttendanceHistoryPage;
