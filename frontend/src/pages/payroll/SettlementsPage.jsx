import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import PdfIcon from '@mui/icons-material/PictureAsPdfOutlined';
import ViewIcon from '@mui/icons-material/VisibilityOutlined';
import AddIcon from '@mui/icons-material/AddOutlined';
import ClearIcon from '@mui/icons-material/ClearOutlined';
import LogoutIcon from '@mui/icons-material/LogoutOutlined';
import PaidIcon from '@mui/icons-material/PaidOutlined';
import PendingIcon from '@mui/icons-material/PendingActionsOutlined';

import PageHeader from '@components/common/PageHeader.jsx';
import DataTable from '@components/common/DataTable.jsx';
import StatCard from '@components/common/StatCard.jsx';
import ExportMenu from '@components/common/ExportMenu.jsx';
import useTableState from '@hooks/useTableState.js';
import usePermissions from '@hooks/usePermissions.js';
import { RESOURCES, ACTIONS } from '@utils/permissions.js';
import payrollService from '@services/modules/payroll.service.js';
import SettlementFormDialog, { SETTLEMENT_TRIGGERS } from './components/SettlementFormDialog.jsx';
import { downloadBlob } from '@utils/exporters.js';
import { formatCurrency, formatDate, humanize } from '@utils/format.js';
import { getRowId, displayName, employeeIdentifiers } from '@utils/dataGrid.js';
import { PATHS } from '@routes/paths.js';

const STATUS_COLOR = {
  DRAFT: 'default',
  PENDING_HR: 'warning',
  PENDING_FINANCE: 'warning',
  APPROVED: 'info',
  PAID: 'success',
  ON_HOLD: 'error',
  CANCELLED: 'default',
};

/**
 * Full and final settlements, with the exit dashboard the API already computes.
 *
 * `payableTo` is shown rather than assumed: a settlement can end up owed to the
 * company once notice shortfall and asset recovery exceed the dues, and a
 * column of net figures with no direction is misleading in exactly that case.
 */
const SettlementsPage = () => {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const canCreate = can(RESOURCES.PAYROLL, ACTIONS.CREATE);

  const table = useTableState({ initialFilters: { status: '', trigger: '' }, initialSort: 'createdAt' });

  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);

  const { params, setTotal } = table;

  const load = useCallback(() => {
    setLoading(true);
    setError(null);

    payrollService
      .listSettlements(params)
      .then((response) => {
        setRows(response.data ?? []);
        setTotal(response.meta?.total ?? 0);
      })
      .catch((rejection) => {
        setRows([]);
        setError(rejection?.message ?? 'Could not load settlements');
      })
      .finally(() => setLoading(false));
  }, [params, setTotal]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    // The dashboard needs DASHBOARD rights the list does not, so a failure here
    // must not take the list down with it.
    payrollService
      .settlementDashboard()
      .then((response) => setSummary(response.data))
      .catch(() => setSummary(null));
  }, []);

  const downloadPdf = async (row) => {
    try {
      const blob = await payrollService.settlementPdf(getRowId(row));
      downloadBlob(blob, `settlement-${row.settlementNumber}.pdf`);
    } catch (rejection) {
      setNotice({ severity: 'error', message: rejection?.message ?? 'The sheet could not be downloaded' });
    }
  };

  // `byStatus` is an object keyed by status -- the service reshapes the
  // aggregate before returning it -- so this is a lookup, not a search. The
  // `?? []` that used to guard it never fired: an object is not nullish, so
  // `.find` was simply undefined once the request resolved.
  const byStatus = (status) => summary?.byStatus?.[status]?.count ?? 0;

  const pendingCount = byStatus('PENDING_HR') + byStatus('PENDING_FINANCE');

  const columns = [
    { key: 'settlementNumber', label: 'Number', width: 140, sortable: true },
    {
      key: 'employee',
      label: 'Employee',
      exportValue: (row) => displayName(row.employeeId) || row.employeeSnapshot?.fullName,
      render: (row) => (
        <Box>
          <Typography variant="body2">
            {displayName(row.employeeId) || row.employeeSnapshot?.fullName || '—'}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {/* The live record if it is still populated, else the settlement's own snapshot. */}
            {employeeIdentifiers(row.employeeId ?? row.employeeSnapshot)}
          </Typography>
        </Box>
      ),
    },
    {
      key: 'trigger',
      label: 'Trigger',
      exportValue: (row) => humanize(row.trigger),
      render: (row) => humanize(row.trigger),
    },
    {
      key: 'lastWorkingDate',
      label: 'Last working day',
      sortable: true,
      exportValue: (row) => formatDate(row.lastWorkingDate),
      render: (row) => formatDate(row.lastWorkingDate),
    },
    {
      key: 'totalEarnings',
      label: 'Earnings',
      align: 'right',
      exportValue: (row) => row.totalEarnings,
      render: (row) => formatCurrency(row.totalEarnings),
    },
    {
      key: 'totalDeductions',
      label: 'Deductions',
      align: 'right',
      exportValue: (row) => row.totalDeductions,
      render: (row) => formatCurrency(row.totalDeductions),
    },
    {
      key: 'netSettlement',
      label: 'Net',
      align: 'right',
      sortable: true,
      exportValue: (row) => row.netSettlement,
      render: (row) => (
        <Box>
          <strong>{formatCurrency(Math.abs(row.netSettlement))}</strong>
          <Typography variant="caption" display="block" color={row.payableTo === 'COMPANY' ? 'error.main' : 'text.secondary'}>
            {row.payableTo === 'COMPANY' ? 'recoverable' : 'payable'}
          </Typography>
        </Box>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      exportValue: (row) => humanize(row.status),
      render: (row) => (
        <Box>
          <Chip label={humanize(row.status)} size="small" color={STATUS_COLOR[row.status] ?? 'default'} variant="outlined" />
          {row.pendingAssetCount > 0 && (
            <Typography variant="caption" display="block" color="warning.main">
              {row.pendingAssetCount} asset(s) not returned
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
            <IconButton size="small" onClick={() => navigate(`/payroll/settlements/${getRowId(row)}`)}>
              <ViewIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Settlement sheet">
            <IconButton size="small" onClick={() => downloadPdf(row)}>
              <PdfIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      ),
    },
  ];

  const hasFilters = table.activeFilterCount > 0;

  return (
    <Box>
      <PageHeader
        title="Settlements"
        subtitle="Full and final settlement of people who have left"
        breadcrumbs={[{ label: 'Home', to: PATHS.dashboard }, { label: 'Payroll' }, { label: 'Settlements' }]}
        actions={
          <Stack direction="row" spacing={1} data-print="hide">
            <ExportMenu
              columns={columns}
              rows={rows}
              filename="settlements"
              totalCount={table.total}
              onError={(message) => setNotice({ severity: 'error', message })}
            />
            {canCreate && (
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}>
                New settlement
              </Button>
            )}
          </Stack>
        }
      />

      {notice && (
        <Alert severity={notice.severity} sx={{ mb: 2 }} onClose={() => setNotice(null)}>
          {notice.message}
        </Alert>
      )}

      {summary && (
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <StatCard label="Total settlements" value={table.total} icon={LogoutIcon} />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <StatCard label="Awaiting a decision" value={pendingCount} icon={PendingIcon} color="warning" />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <StatCard label="Paid" value={byStatus('PAID')} icon={PaidIcon} color="success" />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <StatCard label="On hold" value={byStatus('ON_HOLD')} icon={PendingIcon} color="error" />
          </Grid>
        </Grid>
      )}

      <Stack direction="row" spacing={1} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap data-print="hide">
        <TextField
          select
          size="small"
          label="Status"
          value={table.filters.status}
          onChange={(event) => table.setFilter('status', event.target.value)}
          sx={{ width: 200 }}
        >
          <MenuItem value="">All statuses</MenuItem>
          {Object.keys(STATUS_COLOR).map((status) => (
            <MenuItem key={status} value={status}>
              {humanize(status)}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          select
          size="small"
          label="Trigger"
          value={table.filters.trigger}
          onChange={(event) => table.setFilter('trigger', event.target.value)}
          sx={{ width: 200 }}
        >
          <MenuItem value="">All triggers</MenuItem>
          {SETTLEMENT_TRIGGERS.map((trigger) => (
            <MenuItem key={trigger} value={trigger}>
              {humanize(trigger)}
            </MenuItem>
          ))}
        </TextField>

        {hasFilters && (
          <Button size="small" color="inherit" startIcon={<ClearIcon />} onClick={table.resetFilters}>
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
        onRowClick={(row) => navigate(`/payroll/settlements/${getRowId(row)}`)}
        emptyTitle={hasFilters ? 'No settlements match these filters' : 'No settlements yet'}
        emptyMessage={
          hasFilters
            ? 'Try clearing a filter.'
            : canCreate
              ? 'Open one when someone resigns, retires or is exited.'
              : null
        }
        emptyAction={
          !hasFilters && canCreate ? (
            <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}>
              New settlement
            </Button>
          ) : null
        }
        page={table.page}
        limit={table.limit}
        total={table.total}
        onPageChange={table.setPage}
        onLimitChange={table.setLimit}
      />

      <SettlementFormDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={(message, created) => {
          setCreateOpen(false);
          setNotice({ severity: 'success', message });
          // Straight into the sheet: a settlement is created to be worked on,
          // not to sit in a list.
          if (created?._id) navigate(`/payroll/settlements/${created._id}`);
          else load();
        }}
      />
    </Box>
  );
};

export default SettlementsPage;
