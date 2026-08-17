import { useCallback, useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import MoreTimeIcon from '@mui/icons-material/MoreTimeOutlined';
import PaidIcon from '@mui/icons-material/PaidOutlined';
import WarningIcon from '@mui/icons-material/ReportProblemOutlined';

import PageHeader from '@components/common/PageHeader.jsx';
import DataTable from '@components/common/DataTable.jsx';
import StatCard from '@components/common/StatCard.jsx';
import ExportMenu from '@components/common/ExportMenu.jsx';
import payrollService from '@services/modules/payroll.service.js';
import attendanceService from '@services/modules/attendance.service.js';
import { formatCurrency, formatDate } from '@utils/format.js';
import { PATHS } from '@routes/paths.js';

const MONTHS = Array.from({ length: 12 }, (_, index) => ({
  value: index + 1,
  label: new Date(2000, index).toLocaleString([], { month: 'long' }),
}));

const now = new Date();
const YEARS = Array.from({ length: 5 }, (_, index) => now.getFullYear() - 3 + index);

const hoursOf = (minutes) => (minutes ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : '—');

const overtimeAmount = (payslip) =>
  (payslip.earnings ?? []).filter((line) => line.code === 'OVERTIME').reduce((sum, line) => sum + line.amount, 0);

/**
 * Overtime: hours recorded against money paid.
 *
 * Two systems own half the answer each -- attendance grades the hours, payroll
 * prices them -- and until now nothing put the two side by side. The gap
 * between them is the thing worth looking at: hours with no payment usually
 * means the employee is not marked overtime-eligible, and payment with no hours
 * means a period was re-run after the attendance changed.
 *
 * Read-only. The rate comes from the employee's overtime configuration and the
 * payroll settings; changing either is done where it is owned.
 */
const OvertimePage = () => {
  const [tab, setTab] = useState('reconcile');
  const [period, setPeriod] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });

  const [payslips, setPayslips] = useState([]);
  const [days, setDays] = useState([]);
  const [summary, setSummary] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);

    const from = new Date(period.year, period.month - 1, 1).toISOString().slice(0, 10);
    const to = new Date(period.year, period.month, 0).toISOString().slice(0, 10);

    Promise.all([
      payrollService.listPayslips({ year: period.year, month: period.month, limit: 200 }),
      // The attendance side. A failure here must not blank the payroll side --
      // the two are separate grants.
      attendanceService.dayReport({ type: 'OVERTIME', from, to }).catch(() => ({ data: null })),
    ])
      .then(([slipResponse, dayResponse]) => {
        setPayslips(slipResponse.data ?? []);
        setDays(dayResponse.data?.rows ?? []);
        setSummary(dayResponse.data?.summary ?? []);
      })
      .catch((rejection) => {
        setPayslips([]);
        setDays([]);
        setError(rejection?.message ?? 'Could not load overtime for this period');
      })
      .finally(() => setLoading(false));
  }, [period.year, period.month]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Hours from attendance joined to money from payroll, keyed on employee code.
   *
   * An outer join in both directions: someone may appear on one side and not
   * the other, and those are exactly the rows worth seeing.
   */
  const reconciled = useMemo(() => {
    const byCode = new Map();

    summary.forEach((entry) => {
      byCode.set(entry.employeeCode, {
        employeeCode: entry.employeeCode,
        employeeId: entry.employeeId,
        fullName: entry.fullName,
        department: entry.department,
        occurrences: entry.occurrences,
        minutes: entry.totalMinutes,
        amount: 0,
        hasPayslip: false,
      });
    });

    payslips.forEach((payslip) => {
      const code = payslip.employeeSnapshot?.employeeCode;
      const amount = overtimeAmount(payslip);
      const existing = byCode.get(code);

      if (existing) {
        existing.amount = amount;
        existing.hasPayslip = true;
        return;
      }

      // Paid but no attendance overtime in the period.
      if (amount > 0) {
        byCode.set(code, {
          employeeCode: code,
          employeeId: payslip.employeeSnapshot?.employeeId,
          fullName: payslip.employeeSnapshot?.fullName,
          department: payslip.employeeSnapshot?.department,
          occurrences: 0,
          minutes: 0,
          amount,
          hasPayslip: true,
        });
      }
    });

    return [...byCode.values()].sort((a, b) => b.minutes - a.minutes);
  }, [summary, payslips]);

  const totals = reconciled.reduce(
    (sum, row) => ({
      minutes: sum.minutes + row.minutes,
      amount: sum.amount + row.amount,
      unpaid: sum.unpaid + (row.minutes > 0 && row.amount === 0 ? 1 : 0),
    }),
    { minutes: 0, amount: 0, unpaid: 0 },
  );

  const reconcileColumns = [
    { key: 'employeeCode', label: 'Code' },
    { key: 'employeeId', label: 'Employee ID', render: (row) => row.employeeId ?? '—' },
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
    { key: 'occurrences', label: 'Days', align: 'right', render: (row) => row.occurrences || '—' },
    {
      key: 'minutes',
      label: 'Hours recorded',
      align: 'right',
      exportValue: (row) => row.minutes,
      render: (row) => hoursOf(row.minutes),
    },
    {
      key: 'amount',
      label: 'Paid',
      align: 'right',
      exportValue: (row) => row.amount,
      render: (row) => (row.amount ? formatCurrency(row.amount) : '—'),
    },
    {
      key: 'state',
      label: 'Reconciliation',
      exportValue: (row) =>
        row.minutes > 0 && row.amount === 0
          ? 'Recorded, not paid'
          : row.minutes === 0 && row.amount > 0
            ? 'Paid, no hours'
            : 'Matched',
      render: (row) => {
        if (row.minutes > 0 && row.amount === 0) {
          return (
            <Tooltip title="Hours were graded but nothing was paid. The usual cause is the employee not being marked overtime-eligible on their salary structure, or the period not yet being processed.">
              <Chip label="Recorded, not paid" size="small" color="warning" variant="outlined" />
            </Tooltip>
          );
        }

        if (row.minutes === 0 && row.amount > 0) {
          return (
            <Tooltip title="Overtime was paid but no overtime days are graded in this period — usually a period re-run after the attendance changed.">
              <Chip label="Paid, no hours" size="small" color="error" variant="outlined" />
            </Tooltip>
          );
        }

        return <Chip label="Matched" size="small" color="success" variant="outlined" />;
      },
    },
  ];

  const dayColumns = [
    { key: 'date', label: 'Date', exportValue: (row) => formatDate(row.date), render: (row) => formatDate(row.date) },
    { key: 'employeeCode', label: 'Code' },
    { key: 'employeeId', label: 'Employee ID', render: (row) => row.employeeId ?? '—' },
    { key: 'fullName', label: 'Employee' },
    { key: 'department', label: 'Department', render: (row) => row.department ?? '—' },
    {
      key: 'overtimeMinutes',
      label: 'Overtime',
      align: 'right',
      exportValue: (row) => row.overtimeMinutes,
      render: (row) => (
        <Chip label={hoursOf(row.overtimeMinutes)} size="small" color="success" variant="outlined" />
      ),
    },
    {
      key: 'workedMinutes',
      label: 'Total worked',
      align: 'right',
      exportValue: (row) => row.workedMinutes,
      render: (row) => hoursOf(row.workedMinutes),
    },
  ];

  const set = (field) => (event) => setPeriod((previous) => ({ ...previous, [field]: Number(event.target.value) }));

  return (
    <Box>
      <PageHeader
        title="Overtime"
        subtitle="Hours graded by attendance, against what payroll paid for them"
        breadcrumbs={[{ label: 'Home', to: PATHS.dashboard }, { label: 'Payroll' }, { label: 'Overtime' }]}
        actions={
          <ExportMenu
            columns={tab === 'reconcile' ? reconcileColumns : dayColumns}
            rows={tab === 'reconcile' ? reconciled : days}
            filename={`overtime-${period.year}-${String(period.month).padStart(2, '0')}`}
            totalCount={tab === 'reconcile' ? reconciled.length : days.length}
            onError={(message) => setError(message)}
          />
        }
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Alert severity="info" sx={{ mb: 3 }}>
        Overtime is never entered here. Attendance grades the hours against the attendance policy, and payroll
        prices them from the employee&apos;s overtime configuration when the period is run. This screen puts the
        two halves side by side.
      </Alert>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard label="Hours recorded" value={hoursOf(totals.minutes)} icon={MoreTimeIcon} loading={loading} />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard label="Paid" value={formatCurrency(totals.amount)} icon={PaidIcon} color="success" loading={loading} />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard
            label="Recorded but unpaid"
            value={totals.unpaid}
            caption="Employees with hours and no payment"
            icon={WarningIcon}
            color={totals.unpaid ? 'warning' : 'success'}
            loading={loading}
          />
        </Grid>
      </Grid>

      <Stack direction="row" spacing={1} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap data-print="hide">
        <TextField select size="small" label="Year" value={period.year} onChange={set('year')} sx={{ width: 130 }}>
          {YEARS.map((year) => (
            <MenuItem key={year} value={year}>
              {year}
            </MenuItem>
          ))}
        </TextField>

        <TextField select size="small" label="Month" value={period.month} onChange={set('month')} sx={{ width: 160 }}>
          {MONTHS.map((month) => (
            <MenuItem key={month.value} value={month.value}>
              {month.label}
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      <Tabs value={tab} onChange={(_event, next) => setTab(next)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Tab value="reconcile" label={`By employee (${reconciled.length})`} />
        <Tab value="days" label={`Day by day (${days.length})`} />
      </Tabs>

      {tab === 'reconcile' ? (
        <DataTable
          columns={reconcileColumns}
          rows={reconciled}
          loading={loading}
          error={error}
          onRetry={load}
          getKey={(row) => row.employeeCode}
          emptyTitle="No overtime in this period"
          emptyMessage="Nothing was graded as overtime, and no payslip carries an overtime component."
        />
      ) : (
        <DataTable
          columns={dayColumns}
          rows={days}
          loading={loading}
          error={error}
          onRetry={load}
          getKey={(row) => `${row.employeeCode}-${row.date}`}
          emptyTitle="No overtime days"
          emptyMessage="Attendance graded no overtime in this period."
        />
      )}
    </Box>
  );
};

export default OvertimePage;
