import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Grid from '@mui/material/Grid';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import PlayCircleIcon from '@mui/icons-material/PlayCircleOutlined';

import PageHeader from '@components/common/PageHeader.jsx';
import DataTable from '@components/common/DataTable.jsx';
import usePermissions from '@hooks/usePermissions.js';
import { RESOURCES, ACTIONS } from '@utils/permissions.js';
import payrollService from '@services/modules/payroll.service.js';
import { formatCurrency, formatDate, formatNumber, humanize } from '@utils/format.js';
import { getRowId } from '@utils/dataGrid.js';
import { PATHS } from '@routes/paths.js';

export const RUN_STATUS_COLOR = {
  DRAFT: 'default',
  PROCESSING: 'info',
  PENDING_APPROVAL: 'warning',
  APPROVED: 'success',
  PAID: 'success',
  CANCELLED: 'error',
};

const MONTHS = Array.from({ length: 12 }, (_, index) => ({
  value: index + 1,
  label: new Date(2000, index).toLocaleString([], { month: 'long' }),
}));

const now = new Date();
const YEARS = Array.from({ length: 5 }, (_, index) => now.getFullYear() - 3 + index);

/**
 * The payroll run list -- one row per processed month.
 *
 * Processing is gated on APPROVE rather than CREATE, matching the API: running
 * payroll decides what a few hundred people are paid, and the server treats it
 * as an approval-grade act rather than an ordinary create.
 */
const PayrollRunsPage = () => {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const canProcess = can(RESOURCES.PAYROLL, ACTIONS.APPROVE);

  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ page: 1, limit: 25, total: 0 });
  const [filters, setFilters] = useState({ year: '', status: '' });
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState(null);

  const [processOpen, setProcessOpen] = useState(false);
  const [processForm, setProcessForm] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const [processing, setProcessing] = useState(false);

  const load = useCallback(() => {
    setLoading(true);

    payrollService
      .listRuns({ ...filters, page: meta.page, limit: meta.limit })
      .then((response) => {
        setRows(response.data ?? []);
        setMeta((previous) => ({ ...previous, total: response.meta?.total ?? 0 }));
      })
      .catch((rejection) =>
        setNotice({ severity: 'error', message: rejection?.message ?? 'Could not load payroll runs' }),
      )
      .finally(() => setLoading(false));
  }, [filters, meta.page, meta.limit]);

  useEffect(() => {
    load();
  }, [load]);

  const handleProcess = async () => {
    setProcessing(true);

    try {
      const response = await payrollService.processRun(processForm);
      setProcessOpen(false);
      setNotice({
        severity: 'success',
        message: `Payroll processed for ${response.data?.period ?? 'the period'}.`,
      });
      load();
    } catch (rejection) {
      setNotice({ severity: 'error', message: rejection?.message ?? 'Processing failed' });
    } finally {
      setProcessing(false);
    }
  };

  const columns = [
    {
      key: 'period',
      label: 'Period',
      render: (row) => (
        <Box>
          <Typography variant="body2" fontWeight={600}>
            {row.period}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {row.totalDaysInMonth} days · {humanize(row.payableDaysBasis)}
          </Typography>
        </Box>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (row) => (
        <Chip label={humanize(row.status)} size="small" color={RUN_STATUS_COLOR[row.status] ?? 'default'} />
      ),
    },
    { key: 'employeeCount', label: 'Employees', align: 'right', render: (row) => formatNumber(row.employeeCount) },
    { key: 'totalGross', label: 'Gross', align: 'right', render: (row) => formatCurrency(row.totalGross) },
    { key: 'totalDeductions', label: 'Deductions', align: 'right', render: (row) => formatCurrency(row.totalDeductions) },
    {
      key: 'totalNet',
      label: 'Net payable',
      align: 'right',
      render: (row) => <strong>{formatCurrency(row.totalNet)}</strong>,
    },
    {
      key: 'processedAt',
      label: 'Processed',
      render: (row) => (
        <Typography variant="caption" color="text.secondary">
          {formatDate(row.processedAt)}
        </Typography>
      ),
    },
  ];

  return (
    <Box>
      <PageHeader
        title="Payroll Runs"
        subtitle="One run per pay period, from draft through to payment"
        breadcrumbs={[{ label: 'Home', to: PATHS.dashboard }, { label: 'Payroll' }, { label: 'Runs' }]}
        actions={
          canProcess && (
            <Button variant="contained" startIcon={<PlayCircleIcon />} onClick={() => setProcessOpen(true)}>
              Process payroll
            </Button>
          )
        }
      />

      {notice && (
        <Alert severity={notice.severity} sx={{ mb: 2 }} onClose={() => setNotice(null)}>
          {notice.message}
        </Alert>
      )}

      <Stack direction="row" spacing={1} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
        <TextField
          select
          size="small"
          label="Year"
          value={filters.year}
          onChange={(event) => setFilters((previous) => ({ ...previous, year: event.target.value }))}
          sx={{ width: 140 }}
        >
          <MenuItem value="">All years</MenuItem>
          {YEARS.map((year) => (
            <MenuItem key={year} value={year}>
              {year}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          select
          size="small"
          label="Status"
          value={filters.status}
          onChange={(event) => setFilters((previous) => ({ ...previous, status: event.target.value }))}
          sx={{ width: 200 }}
        >
          <MenuItem value="">All statuses</MenuItem>
          {Object.keys(RUN_STATUS_COLOR).map((status) => (
            <MenuItem key={status} value={status}>
              {humanize(status)}
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      <DataTable
        columns={columns}
        rows={rows}
        loading={loading}
        emptyMessage="No payroll has been run yet."
        onRowClick={(row) => navigate(PATHS.payrollRunDetail(getRowId(row)))}
        page={meta.page}
        limit={meta.limit}
        total={meta.total}
        onPageChange={(page) => setMeta((previous) => ({ ...previous, page }))}
        onLimitChange={(limit) => setMeta((previous) => ({ ...previous, limit, page: 1 }))}
      />

      <Dialog open={processOpen} onClose={() => setProcessOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Process payroll</DialogTitle>

        <DialogContent dividers>
          <DialogContentText variant="body2" sx={{ mb: 2 }}>
            Every eligible employee is priced from their salary structure and the attendance already
            recorded for the period. Re-processing a period that is still editable replaces its figures.
          </DialogContentText>

          <Grid container spacing={2}>
            <Grid size={6}>
              <TextField
                select
                fullWidth
                label="Year"
                value={processForm.year}
                onChange={(event) => setProcessForm((previous) => ({ ...previous, year: Number(event.target.value) }))}
              >
                {YEARS.map((year) => (
                  <MenuItem key={year} value={year}>
                    {year}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>

            <Grid size={6}>
              <TextField
                select
                fullWidth
                label="Month"
                value={processForm.month}
                onChange={(event) => setProcessForm((previous) => ({ ...previous, month: Number(event.target.value) }))}
              >
                {MONTHS.map((month) => (
                  <MenuItem key={month.value} value={month.value}>
                    {month.label}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
          </Grid>
        </DialogContent>

        <DialogActions>
          <Button color="inherit" onClick={() => setProcessOpen(false)}>
            Cancel
          </Button>
          <Button variant="contained" onClick={handleProcess} disabled={processing}>
            {processing ? 'Processing…' : 'Process'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default PayrollRunsPage;
