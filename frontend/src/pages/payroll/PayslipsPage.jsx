import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import PdfIcon from '@mui/icons-material/PictureAsPdfOutlined';
import ViewIcon from '@mui/icons-material/VisibilityOutlined';
import ClearIcon from '@mui/icons-material/ClearOutlined';

import PageHeader from '@components/common/PageHeader.jsx';
import DataTable from '@components/common/DataTable.jsx';
import EmployeePicker from '@components/common/EmployeePicker.jsx';
import ExportMenu from '@components/common/ExportMenu.jsx';
import useTableState from '@hooks/useTableState.js';
import payrollService from '@services/modules/payroll.service.js';
import { downloadBlob } from '@utils/exporters.js';
import { formatCurrency, humanize } from '@utils/format.js';
import { getRowId, employeeIdentifiers } from '@utils/dataGrid.js';
import { PATHS } from '@routes/paths.js';

const STATUS_COLOR = {
  DRAFT: 'default',
  FINALISED: 'info',
  PUBLISHED: 'success',
  ON_HOLD: 'warning',
};

const MONTHS = Array.from({ length: 12 }, (_, index) => ({
  value: index + 1,
  label: new Date(2000, index).toLocaleString([], { month: 'long' }),
}));

const now = new Date();
const YEARS = Array.from({ length: 5 }, (_, index) => now.getFullYear() - 3 + index);

/**
 * Payslips across the organisation, with the PDF the API already generates.
 *
 * The download is gated on `payroll:read` server-side rather than on print or
 * export rights, because an employee is entitled to their own payslip and the
 * service scopes the record to them.
 */
const PayslipsPage = () => {
  const navigate = useNavigate();

  const table = useTableState({
    initialFilters: { year: '', month: '', status: '' },
    initialSort: 'period',
  });

  const [employee, setEmployee] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const { params, setTotal } = table;

  const load = useCallback(() => {
    setLoading(true);
    setError(null);

    payrollService
      .listPayslips({ ...params, employeeId: employee ? getRowId(employee) : undefined })
      .then((response) => {
        setRows(response.data ?? []);
        setTotal(response.meta?.total ?? 0);
      })
      .catch((rejection) => {
        setRows([]);
        setError(rejection?.message ?? 'Could not load payslips');
      })
      .finally(() => setLoading(false));
  }, [params, employee, setTotal]);

  useEffect(() => {
    load();
  }, [load]);

  const downloadPdf = async (row) => {
    try {
      const blob = await payrollService.payslipPdf(getRowId(row));
      downloadBlob(blob, `payslip-${row.employeeSnapshot?.employeeCode ?? 'employee'}-${row.period}.pdf`);
    } catch (rejection) {
      setNotice({ severity: 'error', message: rejection?.message ?? 'The payslip could not be downloaded' });
    }
  };

  const columns = [
    { key: 'period', label: 'Period', width: 110, sortable: true },
    {
      key: 'employee',
      label: 'Employee',
      exportValue: (row) => row.employeeSnapshot?.fullName,
      render: (row) => (
        <Box>
          <Typography variant="body2">{row.employeeSnapshot?.fullName ?? '—'}</Typography>
          <Typography variant="caption" color="text.secondary">
            {employeeIdentifiers(row.employeeSnapshot)}
          </Typography>
        </Box>
      ),
    },
    {
      key: 'payableDays',
      label: 'Payable days',
      align: 'right',
      exportValue: (row) => row.attendance?.payableDays,
      render: (row) => row.attendance?.payableDays ?? '—',
    },
    {
      key: 'grossEarnings',
      label: 'Gross',
      align: 'right',
      sortable: true,
      exportValue: (row) => row.grossEarnings,
      render: (row) => formatCurrency(row.grossEarnings),
    },
    {
      key: 'totalDeductions',
      label: 'Deductions',
      align: 'right',
      exportValue: (row) => row.totalDeductions,
      render: (row) => formatCurrency(row.totalDeductions),
    },
    {
      key: 'netPayable',
      label: 'Net pay',
      align: 'right',
      sortable: true,
      exportValue: (row) => row.netPayable,
      render: (row) => <strong>{formatCurrency(row.netPayable)}</strong>,
    },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      exportValue: (row) => humanize(row.status),
      render: (row) => (
        <Box>
          <Chip label={humanize(row.status)} size="small" color={STATUS_COLOR[row.status] ?? 'default'} variant="outlined" />
          {row.holdReason && (
            <Typography variant="caption" display="block" color="text.secondary">
              {row.holdReason}
            </Typography>
          )}
        </Box>
      ),
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      width: 100,
      render: (row) => (
        <Stack direction="row" spacing={0.5} justifyContent="flex-end" onClick={(event) => event.stopPropagation()}>
          <Tooltip title="Open">
            <IconButton size="small" onClick={() => navigate(`/payroll/payslips/${getRowId(row)}`)}>
              <ViewIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Download payslip">
            <IconButton size="small" onClick={() => downloadPdf(row)}>
              <PdfIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      ),
    },
  ];

  const hasFilters = table.activeFilterCount > 0 || Boolean(employee);

  return (
    <Box>
      <PageHeader
        title="Payslips"
        subtitle="Every payslip generated by a payroll run"
        breadcrumbs={[{ label: 'Home', to: PATHS.dashboard }, { label: 'Payroll' }, { label: 'Payslips' }]}
        actions={
          <ExportMenu
            columns={columns}
            rows={rows}
            filename="payslips"
            totalCount={table.total}
            onError={(message) => setNotice({ severity: 'error', message })}
          />
        }
      />

      {notice && (
        <Alert severity={notice.severity} sx={{ mb: 2 }} onClose={() => setNotice(null)}>
          {notice.message}
        </Alert>
      )}

      <Stack direction="row" spacing={1} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap data-print="hide">
        <EmployeePicker value={employee} onChange={setEmployee} sx={{ width: { xs: '100%', sm: 280 } }} />

        <TextField
          select
          size="small"
          label="Year"
          value={table.filters.year}
          onChange={(event) => table.setFilter('year', event.target.value)}
          sx={{ width: 130 }}
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
          label="Month"
          value={table.filters.month}
          onChange={(event) => table.setFilter('month', event.target.value)}
          sx={{ width: 150 }}
        >
          <MenuItem value="">All months</MenuItem>
          {MONTHS.map((month) => (
            <MenuItem key={month.value} value={month.value}>
              {month.label}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          select
          size="small"
          label="Status"
          value={table.filters.status}
          onChange={(event) => table.setFilter('status', event.target.value)}
          sx={{ width: 160 }}
        >
          <MenuItem value="">All statuses</MenuItem>
          {Object.keys(STATUS_COLOR).map((status) => (
            <MenuItem key={status} value={status}>
              {humanize(status)}
            </MenuItem>
          ))}
        </TextField>

        {hasFilters && (
          <Button
            size="small"
            color="inherit"
            startIcon={<ClearIcon />}
            onClick={() => {
              table.resetFilters();
              setEmployee(null);
            }}
          >
            Clear
          </Button>
        )}
      </Stack>

      <DataTable
        columns={columns}
        rows={rows}
        loading={loading}
        error={error}
        onRetry={load}
        sortBy={table.sortBy}
        sortOrder={table.sortOrder}
        onSort={table.toggleSort}
        onRowClick={(row) => navigate(`/payroll/payslips/${getRowId(row)}`)}
        emptyTitle={hasFilters ? 'No payslips match these filters' : 'No payslips yet'}
        emptyMessage={
          hasFilters ? 'Try clearing a filter.' : 'Payslips appear here once a payroll run has been processed.'
        }
        page={table.page}
        limit={table.limit}
        total={table.total}
        onPageChange={table.setPage}
        onLimitChange={table.setLimit}
      />
    </Box>
  );
};

export default PayslipsPage;
