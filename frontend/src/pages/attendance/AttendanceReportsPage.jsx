import { useCallback, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import DownloadIcon from '@mui/icons-material/FileDownloadOutlined';
import PdfIcon from '@mui/icons-material/PictureAsPdfOutlined';

import PageHeader from '@components/common/PageHeader.jsx';
import DataTable from '@components/common/DataTable.jsx';
import { useAppDispatch, useAppSelector } from '@hooks/useRedux.js';
import { fetchMasters, selectMasters } from '@redux/slices/employeeSlice.js';
import attendanceService from '@services/modules/attendance.service.js';
import { downloadBlob } from '@services/modules/employee.service.js';
import { formatDate, humanize } from '@utils/format.js';
import { PATHS } from '@routes/paths.js';

const MONTHS = Array.from({ length: 12 }, (_, index) => ({
  value: index + 1,
  label: new Date(2000, index).toLocaleString([], { month: 'long' }),
}));

const now = new Date();
const YEARS = Array.from({ length: 5 }, (_, index) => now.getFullYear() - 3 + index);

const firstOfMonth = () => new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
const today = () => now.toISOString().slice(0, 10);

const hours = (value) => (value ? `${value.toFixed(1)} h` : '—');

const timeOf = (value) =>
  value ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';

/** The minutes figure each day-report tab is actually about. */
const minutesFor = (tab, row) =>
  ({
    overtime: row.overtimeMinutes,
    early: row.earlyGoingMinutes,
    late: row.lateMinutes,
  })[tab] ?? row.workedMinutes;

/**
 * The three attendance reports the API already produces, behind one screen.
 *
 * They were fully implemented server-side -- monthly summary, exceptions and
 * the department/unit roll-up -- but nothing in the UI called them, so a month
 * could only be closed by reading the register row by row.
 */
const AttendanceReportsPage = () => {
  const dispatch = useAppDispatch();
  const masters = useAppSelector(selectMasters);

  const [tab, setTab] = useState('summary');
  const [params, setParams] = useState({
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    departmentId: '',
    groupBy: 'department',
    from: firstOfMonth(),
    to: today(),
  });

  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    dispatch(fetchMasters());
  }, [dispatch]);

  /**
   * The four day-level tabs -- late, early going, overtime and absence -- are
   * one endpoint with a `type`, so they share a branch rather than four.
   */
  const DAY_TYPES = {
    late: 'LATE',
    early: 'EARLY',
    overtime: 'OVERTIME',
    halfday: 'HALF_DAY',
    absent: 'ABSENT',
  };

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    setSummary([]);

    const dayType = DAY_TYPES[tab];

    const request = dayType
      ? attendanceService.dayReport({
          type: dayType,
          from: params.from,
          to: params.to,
          departmentId: params.departmentId,
        })
      : tab === 'summary'
        ? attendanceService.monthlySummary({ year: params.year, month: params.month, departmentId: params.departmentId })
        : tab === 'grouped'
          ? attendanceService.groupedReport({ year: params.year, month: params.month, groupBy: params.groupBy })
          : attendanceService.exceptions({ from: params.from, to: params.to, departmentId: params.departmentId });

    request
      .then((response) => {
        setRows(response.data?.rows ?? response.data?.items ?? []);
        // The day reports return a per-employee roll-up beside the detail:
        // "who" and "how often" are always asked of these together.
        setSummary(response.data?.summary ?? []);
      })
      .catch((rejection) => {
        setRows([]);
        setError(rejection?.message ?? 'Could not load the report');
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, params]);

  useEffect(() => {
    load();
  }, [load]);

  const set = (field) => (event) => setParams((previous) => ({ ...previous, [field]: event.target.value }));

  const stamp = `${params.year}-${String(params.month).padStart(2, '0')}`;

  const download = async (kind) => {
    setBusy(true);
    setError(null);

    const dayType = DAY_TYPES[tab];

    try {
      /**
       * The day reports have their own exporter, because they are a date range
       * rather than a month -- exporting the monthly summary from the Late tab
       * would hand back a different report than the one on screen.
       */
      if (dayType) {
        const blob = await attendanceService.exportDayReport({
          type: dayType,
          from: params.from,
          to: params.to,
          departmentId: params.departmentId,
        });
        downloadBlob(blob, `attendance-${tab}-${params.from}-to-${params.to}.xlsx`);
        return;
      }

      if (kind === 'excel') {
        const blob = await attendanceService.exportMonthly({
          year: params.year,
          month: params.month,
          departmentId: params.departmentId,
        });
        downloadBlob(blob, `attendance-summary-${stamp}.xlsx`);
      } else {
        const blob = await attendanceService.exportSummaryPdf({
          year: params.year,
          month: params.month,
          departmentId: params.departmentId,
        });
        downloadBlob(blob, `attendance-summary-${stamp}.pdf`);
      }
    } catch (rejection) {
      setError(rejection?.message ?? 'The export failed');
    } finally {
      setBusy(false);
    }
  };

  const SUMMARY_COLUMNS = [
    { key: 'employeeCode', label: 'Code' },
    { key: 'employeeId', label: 'Employee ID' },
    {
      key: 'fullName',
      label: 'Employee',
      render: (row) => (
        <Box>
          <Typography variant="body2">{row.fullName}</Typography>
          <Typography variant="caption" color="text.secondary">
            {row.department ?? '—'}
          </Typography>
        </Box>
      ),
    },
    { key: 'present', label: 'Present', align: 'right' },
    { key: 'halfDay', label: 'Half', align: 'right' },
    { key: 'absent', label: 'Absent', align: 'right' },
    { key: 'onLeave', label: 'Leave', align: 'right' },
    { key: 'weeklyOff', label: 'W/O', align: 'right' },
    { key: 'holiday', label: 'Holiday', align: 'right' },
    {
      key: 'missingPunch',
      label: 'Missing',
      align: 'right',
      render: (row) =>
        row.missingPunch ? <Chip label={row.missingPunch} size="small" color="error" variant="outlined" /> : '—',
    },
    { key: 'lateCount', label: 'Late', align: 'right' },
    { key: 'workedHours', label: 'Worked', align: 'right', render: (row) => hours(row.workedHours) },
    { key: 'overtimeHours', label: 'OT', align: 'right', render: (row) => hours(row.overtimeHours) },
    {
      key: 'payableDays',
      label: 'Payable',
      align: 'right',
      render: (row) => <strong>{row.payableDays?.toFixed(1) ?? '—'}</strong>,
    },
  ];

  const GROUPED_COLUMNS = [
    { key: 'group', label: params.groupBy === 'unit' ? 'Unit' : 'Department' },
    { key: 'headcount', label: 'Headcount', align: 'right' },
    { key: 'present', label: 'Present', align: 'right' },
    { key: 'halfDay', label: 'Half', align: 'right' },
    { key: 'absent', label: 'Absent', align: 'right' },
    { key: 'lateCount', label: 'Late', align: 'right' },
    { key: 'workedHours', label: 'Worked', align: 'right', render: (row) => hours(row.workedHours) },
    { key: 'overtimeHours', label: 'OT', align: 'right', render: (row) => hours(row.overtimeHours) },
    {
      key: 'attendancePercent',
      label: 'Attendance',
      align: 'right',
      render: (row) => (
        <Chip
          label={`${row.attendancePercent}%`}
          size="small"
          color={row.attendancePercent >= 90 ? 'success' : row.attendancePercent >= 75 ? 'warning' : 'error'}
          variant="outlined"
        />
      ),
    },
  ];

  const EXCEPTION_COLUMNS = [
    { key: 'date', label: 'Date', render: (row) => formatDate(row.date) },
    { key: 'employeeCode', label: 'Code' },
    { key: 'employeeId', label: 'Employee ID' },
    { key: 'fullName', label: 'Employee' },
    { key: 'status', label: 'Status', render: (row) => <Chip label={humanize(row.status)} size="small" color="error" variant="outlined" /> },
    {
      key: 'anomalies',
      label: 'Anomalies',
      render: (row) =>
        row.anomalies?.length ? (
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
            {row.anomalies.map((anomaly) => (
              <Chip key={anomaly} label={humanize(anomaly)} size="small" variant="outlined" />
            ))}
          </Stack>
        ) : (
          '—'
        ),
    },
    {
      key: 'isRegularized',
      label: 'Regularized',
      render: (row) => (row.isRegularized ? <Chip label="Yes" size="small" color="success" variant="outlined" /> : 'No'),
    },
  ];

  /**
   * Day-level detail for late arrival, early going, overtime and absence.
   *
   * One column set for all four: the endpoint returns the same row shape and
   * only the minutes column that matters changes, which the tab decides.
   */
  const DAY_COLUMNS = [
    { key: 'date', label: 'Date', exportValue: (row) => formatDate(row.date), render: (row) => formatDate(row.date) },
    { key: 'employeeCode', label: 'Code' },
    { key: 'employeeId', label: 'Employee ID' },
    {
      key: 'fullName',
      label: 'Employee',
      render: (row) => (
        <Box>
          <Typography variant="body2">{row.fullName ?? '—'}</Typography>
          <Typography variant="caption" color="text.secondary">
            {row.department ?? '—'}
          </Typography>
        </Box>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      exportValue: (row) => humanize(row.status),
      render: (row) => <Chip label={humanize(row.status)} size="small" variant="outlined" />,
    },
    { key: 'checkInAt', label: 'In', exportValue: (row) => timeOf(row.checkInAt), render: (row) => timeOf(row.checkInAt) },
    { key: 'checkOutAt', label: 'Out', exportValue: (row) => timeOf(row.checkOutAt), render: (row) => timeOf(row.checkOutAt) },
    {
      key: 'minutes',
      /**
       * Which minutes column matters depends on the tab. Half day and absence
       * have no overrun to show, so they fall back to time actually worked --
       * which for a half day is the number being questioned.
       */
      label:
        { overtime: 'Overtime', early: 'Early by', late: 'Late by', halfday: 'Worked', absent: 'Worked' }[tab] ??
        'Worked',
      align: 'right',
      exportValue: (row) => minutesFor(tab, row),
      render: (row) => {
        const minutes = minutesFor(tab, row);
        if (!minutes) return '—';

        return (
          <Chip
            label={minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`}
            size="small"
            color={tab === 'overtime' ? 'success' : tab === 'halfday' ? 'default' : 'warning'}
            variant="outlined"
          />
        );
      },
    },
  ];

  /** Per-employee roll-up that accompanies the day reports. */
  const SUMMARY_ROLLUP_COLUMNS = [
    { key: 'employeeCode', label: 'Code' },
    { key: 'employeeId', label: 'Employee ID' },
    { key: 'fullName', label: 'Employee' },
    { key: 'department', label: 'Department', render: (row) => row.department ?? '—' },
    {
      key: 'occurrences',
      label: 'Occurrences',
      align: 'right',
      render: (row) => <strong>{row.occurrences}</strong>,
    },
    {
      key: 'totalMinutes',
      label: 'Total',
      align: 'right',
      render: (row) =>
        row.totalMinutes
          ? `${Math.floor(row.totalMinutes / 60)}h ${row.totalMinutes % 60}m`
          : '—',
    },
  ];

  const isDayReport = Boolean(DAY_TYPES[tab]);
  // The day reports and the exception queue are both date-range driven.
  const isRangeTab = isDayReport || tab === 'exceptions';

  const columns = isDayReport
    ? DAY_COLUMNS
    : tab === 'summary'
      ? SUMMARY_COLUMNS
      : tab === 'grouped'
        ? GROUPED_COLUMNS
        : EXCEPTION_COLUMNS;

  return (
    <Box>
      <PageHeader
        title="Attendance Reports"
        subtitle="Monthly summary, department roll-up and the exception queue"
        breadcrumbs={[
          { label: 'Home', to: PATHS.dashboard },
          { label: 'Attendance', to: PATHS.attendance },
          { label: 'Reports' },
        ]}
        actions={
          <Stack direction="row" spacing={1} data-print="hide">
            <Button size="small" startIcon={<DownloadIcon />} onClick={() => download('excel')} disabled={busy}>
              Excel
            </Button>
            {/* PDF exists only for the monthly summary; the day reports have no
                server-side PDF, and offering one that returns the wrong report
                would be worse than not offering it. */}
            {!isDayReport && (
              <Button size="small" startIcon={<PdfIcon />} onClick={() => download('pdf')} disabled={busy}>
                PDF
              </Button>
            )}
          </Stack>
        }
      />

      {busy && <LinearProgress sx={{ mb: 2 }} />}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Tabs
        value={tab}
        onChange={(_event, next) => setTab(next)}
        sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab value="summary" label="Monthly summary" />
        <Tab value="grouped" label="By department / unit" />
        <Tab value="late" label="Late coming" />
        <Tab value="early" label="Early going" />
        <Tab value="halfday" label="Half day" />
        <Tab value="overtime" label="Overtime" />
        <Tab value="absent" label="Absence" />
        <Tab value="exceptions" label="Exceptions" />
      </Tabs>

      <Stack direction="row" spacing={1} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap data-print="hide">
        {isRangeTab ? (
          <>
            <TextField
              size="small"
              type="date"
              label="From"
              value={params.from}
              onChange={set('from')}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              size="small"
              type="date"
              label="To"
              value={params.to}
              onChange={set('to')}
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </>
        ) : (
          <>
            <TextField select size="small" label="Year" value={params.year} onChange={set('year')} sx={{ width: 120 }}>
              {YEARS.map((year) => (
                <MenuItem key={year} value={year}>
                  {year}
                </MenuItem>
              ))}
            </TextField>

            <TextField select size="small" label="Month" value={params.month} onChange={set('month')} sx={{ width: 150 }}>
              {MONTHS.map((month) => (
                <MenuItem key={month.value} value={month.value}>
                  {month.label}
                </MenuItem>
              ))}
            </TextField>
          </>
        )}

        {tab === 'grouped' ? (
          <TextField select size="small" label="Group by" value={params.groupBy} onChange={set('groupBy')} sx={{ width: 160 }}>
            <MenuItem value="department">Department</MenuItem>
            <MenuItem value="unit">Unit</MenuItem>
          </TextField>
        ) : (
          <TextField
            select
            size="small"
            label="Department"
            value={params.departmentId}
            onChange={set('departmentId')}
            sx={{ width: 220 }}
          >
            <MenuItem value="">All departments</MenuItem>
            {(masters?.departments ?? []).map((department) => (
              <MenuItem key={department._id} value={department._id}>
                {department.name}
              </MenuItem>
            ))}
          </TextField>
        )}

        <Chip label={`${rows.length} row${rows.length === 1 ? '' : 's'}`} size="small" variant="outlined" sx={{ alignSelf: 'center' }} />
      </Stack>

      <DataTable
        columns={columns}
        rows={rows}
        loading={loading}
        error={error}
        onRetry={load}
        // Report rows are computed, not documents: they carry an employee id, a
        // record id or a group name depending on the tab, and never an `_id`.
        // The day reports repeat an employee across dates, so the date is part
        // of the key or React would see duplicates.
        getKey={(row) => `${row.employeeId ?? row.id ?? row.employeeCode ?? row.group}-${row.date ?? ''}`}
        emptyTitle={
          isDayReport
            ? `No ${
                {
                  absent: 'absences',
                  overtime: 'overtime',
                  early: 'early departures',
                  halfday: 'half days',
                  late: 'late arrivals',
                }[tab] ?? 'records'
              } in this range`
            : tab === 'exceptions'
              ? 'No exceptions in this range'
              : 'No data for this period'
        }
        emptyMessage={
          isDayReport || tab === 'exceptions' ? 'Nothing to chase — try widening the dates.' : null
        }
      />

      {isDayReport && summary.length > 0 && (
        <Box sx={{ mt: 4 }}>
          <Typography variant="h6" sx={{ mb: 1 }}>
            By employee
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
            Who it happens to, and how often — the pattern the detail above cannot show.
          </Typography>

          <DataTable
            columns={SUMMARY_ROLLUP_COLUMNS}
            rows={summary}
            getKey={(row) => row.employeeCode}
            emptyTitle="Nothing to summarise"
          />
        </Box>
      )}
    </Box>
  );
};

export default AttendanceReportsPage;
