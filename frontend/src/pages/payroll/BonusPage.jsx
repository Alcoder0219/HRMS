import { useCallback, useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/AddOutlined';
import DeleteIcon from '@mui/icons-material/DeleteOutlineOutlined';
import PlayCircleIcon from '@mui/icons-material/PlayCircleOutlined';
import CardGiftcardIcon from '@mui/icons-material/CardGiftcardOutlined';

import PageHeader from '@components/common/PageHeader.jsx';
import DataTable from '@components/common/DataTable.jsx';
import StatCard from '@components/common/StatCard.jsx';
import ExportMenu from '@components/common/ExportMenu.jsx';
import EmployeePicker from '@components/common/EmployeePicker.jsx';
import CurrencyAdornment from '@components/common/CurrencyAdornment.jsx';
import ConfirmDialog from '@components/feedback/ConfirmDialog.jsx';
import usePermissions from '@hooks/usePermissions.js';
import { RESOURCES, ACTIONS } from '@utils/permissions.js';
import payrollService from '@services/modules/payroll.service.js';
import { formatCurrency } from '@utils/format.js';
import { getRowId, displayName } from '@utils/dataGrid.js';
import { PATHS } from '@routes/paths.js';

const MONTHS = Array.from({ length: 12 }, (_, index) => ({
  value: index + 1,
  label: new Date(2000, index).toLocaleString([], { month: 'long' }),
}));

const now = new Date();
const YEARS = Array.from({ length: 5 }, (_, index) => now.getFullYear() - 3 + index);

/** The payslip components that count as variable pay. */
const VARIABLE_CODES = ['BONUS', 'INCENTIVE', 'ARREARS'];

const amountOf = (payslip, code) =>
  (payslip.earnings ?? []).filter((line) => line.code === code).reduce((sum, line) => sum + line.amount, 0);

/**
 * Bonus, incentive and arrears.
 *
 * There is no bonus collection and this does not add one. A bonus IS a payslip
 * line: it applies to one period, and the payslip the run produces is the
 * record of it. A parallel table would be a second place for the same figure to
 * live, and the first place it would drift.
 *
 * So the flow is: declare the amounts here, process the period, and the run
 * writes them onto the payslips. The history tab then reads them straight back
 * off those payslips -- one source, no reconciliation needed.
 */
const BonusPage = () => {
  const { can } = usePermissions();
  const canProcess = can(RESOURCES.PAYROLL, ACTIONS.APPROVE);

  const [tab, setTab] = useState('history');
  const [period, setPeriod] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });

  const [payslips, setPayslips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [lines, setLines] = useState([]);
  const [picker, setPicker] = useState(null);
  const [confirmRun, setConfirmRun] = useState(false);
  const [processing, setProcessing] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);

    payrollService
      .listPayslips({ year: period.year, month: period.month, limit: 200 })
      .then((response) => setPayslips(response.data ?? []))
      .catch((rejection) => {
        setPayslips([]);
        setError(rejection?.message ?? 'Could not load payslips for this period');
      })
      .finally(() => setLoading(false));
  }, [period.year, period.month]);

  useEffect(() => {
    load();
  }, [load]);

  /** Payslips that actually carry variable pay, flattened for the table. */
  const paid = useMemo(
    () =>
      payslips
        .map((payslip) => ({
          _id: payslip._id,
          employeeCode: payslip.employeeSnapshot?.employeeCode,
          employeeId: payslip.employeeSnapshot?.employeeId,
          fullName: payslip.employeeSnapshot?.fullName,
          department: payslip.employeeSnapshot?.department,
          bonus: amountOf(payslip, 'BONUS'),
          incentive: amountOf(payslip, 'INCENTIVE'),
          arrears: amountOf(payslip, 'ARREARS'),
          gross: payslip.grossEarnings,
          status: payslip.status,
        }))
        .filter((row) => row.bonus > 0 || row.incentive > 0 || row.arrears > 0),
    [payslips],
  );

  const totals = paid.reduce(
    (sum, row) => ({
      bonus: sum.bonus + row.bonus,
      incentive: sum.incentive + row.incentive,
      arrears: sum.arrears + row.arrears,
    }),
    { bonus: 0, incentive: 0, arrears: 0 },
  );

  const addLine = (employee) => {
    if (!employee) return;

    const id = getRowId(employee);
    if (lines.some((line) => line.employeeId === id)) {
      setNotice({ severity: 'info', message: `${displayName(employee)} is already on the list` });
      return;
    }

    setLines((previous) => [
      ...previous,
      {
        employeeId: id,
        employeeCode: employee.employeeCode,
        employeeIdCode: employee.employeeId,
        fullName: displayName(employee),
        bonus: '',
        incentive: '',
        arrears: '',
      },
    ]);
    setPicker(null);
  };

  const setLine = (employeeId, field) => (event) =>
    setLines((previous) =>
      previous.map((line) => (line.employeeId === employeeId ? { ...line, [field]: event.target.value } : line)),
    );

  const declared = lines.filter(
    (line) => Number(line.bonus) > 0 || Number(line.incentive) > 0 || Number(line.arrears) > 0,
  );

  const declaredTotal = declared.reduce(
    (sum, line) => sum + (Number(line.bonus) || 0) + (Number(line.incentive) || 0) + (Number(line.arrears) || 0),
    0,
  );

  const runPayroll = async () => {
    setConfirmRun(false);
    setProcessing(true);

    try {
      const response = await payrollService.processRun({
        year: period.year,
        month: period.month,
        variablePay: declared.map((line) => ({
          employeeId: line.employeeId,
          ...(Number(line.bonus) > 0 ? { bonus: Number(line.bonus) } : {}),
          ...(Number(line.incentive) > 0 ? { incentive: Number(line.incentive) } : {}),
          ...(Number(line.arrears) > 0 ? { arrears: Number(line.arrears) } : {}),
        })),
      });

      setNotice({
        severity: 'success',
        message: `${response.message ?? 'Payroll processed'} — variable pay applied to ${declared.length} employee(s)`,
      });
      setLines([]);
      setTab('history');
      load();
    } catch (rejection) {
      setNotice({ severity: 'error', message: rejection?.message ?? 'The payroll run failed' });
    } finally {
      setProcessing(false);
    }
  };

  const historyColumns = [
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
    { key: 'bonus', label: 'Bonus', align: 'right', render: (row) => (row.bonus ? formatCurrency(row.bonus) : '—') },
    {
      key: 'incentive',
      label: 'Incentive',
      align: 'right',
      render: (row) => (row.incentive ? formatCurrency(row.incentive) : '—'),
    },
    { key: 'arrears', label: 'Arrears', align: 'right', render: (row) => (row.arrears ? formatCurrency(row.arrears) : '—') },
    {
      key: 'total',
      label: 'Total variable',
      align: 'right',
      exportValue: (row) => row.bonus + row.incentive + row.arrears,
      render: (row) => <strong>{formatCurrency(row.bonus + row.incentive + row.arrears)}</strong>,
    },
    { key: 'gross', label: 'Gross', align: 'right', render: (row) => formatCurrency(row.gross) },
  ];

  const declareColumns = [
    { key: 'employeeCode', label: 'Code', width: 110 },
    // A declaration line already uses `employeeId` for the record reference it
    // posts back, so the displayed ID is held under its own key.
    { key: 'employeeIdCode', label: 'Employee ID', width: 120, render: (row) => row.employeeIdCode ?? '—' },
    { key: 'fullName', label: 'Employee' },
    ...['bonus', 'incentive', 'arrears'].map((field) => ({
      key: field,
      label: field.charAt(0).toUpperCase() + field.slice(1),
      align: 'right',
      width: 150,
      render: (row) => (
        <TextField
          size="small"
          type="number"
          value={row[field]}
          onChange={setLine(row.employeeId, field)}
          slotProps={{
            input: {
              startAdornment: <CurrencyAdornment />,
              inputProps: { min: 0, style: { textAlign: 'right', padding: '6px 8px' } },
            },
          }}
        />
      ),
    })),
    {
      key: 'actions',
      label: '',
      align: 'right',
      width: 60,
      render: (row) => (
        <Tooltip title="Remove">
          <IconButton
            size="small"
            color="error"
            onClick={() => setLines((previous) => previous.filter((line) => line.employeeId !== row.employeeId))}
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ),
    },
  ];

  const set = (field) => (event) => setPeriod((previous) => ({ ...previous, [field]: Number(event.target.value) }));

  return (
    <Box>
      <PageHeader
        title="Bonus"
        subtitle="Bonus, incentive and arrears — declared for a period, paid through payroll"
        breadcrumbs={[{ label: 'Home', to: PATHS.dashboard }, { label: 'Payroll' }, { label: 'Bonus' }]}
        actions={
          tab === 'history' ? (
            <ExportMenu
              columns={historyColumns}
              rows={paid}
              filename={`bonus-${period.year}-${String(period.month).padStart(2, '0')}`}
              totalCount={paid.length}
              onError={(message) => setNotice({ severity: 'error', message })}
            />
          ) : null
        }
      />

      {notice && (
        <Alert severity={notice.severity} sx={{ mb: 2 }} onClose={() => setNotice(null)}>
          {notice.message}
        </Alert>
      )}

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard label="Bonus paid" value={formatCurrency(totals.bonus)} icon={CardGiftcardIcon} loading={loading} />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard label="Incentive paid" value={formatCurrency(totals.incentive)} color="info" loading={loading} />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard label="Arrears paid" value={formatCurrency(totals.arrears)} color="warning" loading={loading} />
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
        <Tab value="history" label={`Paid this period (${paid.length})`} />
        {canProcess && <Tab value="declare" label={`Declare (${declared.length})`} />}
      </Tabs>

      {tab === 'history' ? (
        <DataTable
          columns={historyColumns}
          rows={paid}
          loading={loading}
          error={error}
          onRetry={load}
          emptyTitle="No variable pay in this period"
          emptyMessage={
            canProcess
              ? 'Declare bonus or incentive on the next tab, then process the period to pay it.'
              : 'Bonus and incentive appear here once a payroll run has paid them.'
          }
        />
      ) : (
        <>
          <Alert severity="warning" sx={{ mb: 2 }}>
            <AlertTitle>This processes payroll for the whole period</AlertTitle>
            Declaring variable pay here prices <strong>every eligible employee</strong> for{' '}
            {MONTHS[period.month - 1].label} {period.year}, not just those listed. The amounts below are added to
            those employees&apos; payslips. Re-processing a period that is still editable replaces its figures.
          </Alert>

          <Stack direction="row" spacing={1} sx={{ mb: 2 }} alignItems="center" flexWrap="wrap" useFlexGap>
            <EmployeePicker
              value={picker}
              onChange={addLine}
              label="Add an employee"
              sx={{ width: { xs: '100%', sm: 340 } }}
            />

            <Chip label={`${declared.length} with amounts`} size="small" variant="outlined" />
            <Chip label={`Total ${formatCurrency(declaredTotal)}`} size="small" color="primary" variant="outlined" />

            <Box sx={{ flex: 1 }} />

            <Button
              variant="contained"
              startIcon={<PlayCircleIcon />}
              disabled={declared.length === 0 || processing}
              onClick={() => setConfirmRun(true)}
            >
              {processing ? 'Processing…' : 'Process payroll'}
            </Button>
          </Stack>

          <DataTable
            columns={declareColumns}
            rows={lines}
            getKey={(row) => row.employeeId}
            emptyTitle="Nobody added yet"
            emptyMessage="Search for an employee above to declare a bonus, incentive or arrears for them."
            emptyAction={
              <Button size="small" variant="outlined" startIcon={<AddIcon />} disabled>
                Use the picker above
              </Button>
            }
          />
        </>
      )}

      <ConfirmDialog
        open={confirmRun}
        title={`Process ${MONTHS[period.month - 1].label} ${period.year}?`}
        message={`Every eligible employee is priced for this period. ${declared.length} of them also receive the variable pay declared here, totalling ${formatCurrency(declaredTotal)}. The amounts are written onto their payslips.`}
        confirmLabel="Process payroll"
        confirmColor="primary"
        loading={processing}
        onConfirm={runPayroll}
        onClose={() => setConfirmRun(false)}
      />
    </Box>
  );
};

export default BonusPage;
