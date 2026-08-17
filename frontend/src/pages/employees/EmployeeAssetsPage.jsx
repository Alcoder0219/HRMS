import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import SearchIcon from '@mui/icons-material/SearchOutlined';
import AddIcon from '@mui/icons-material/AddOutlined';
import ClearIcon from '@mui/icons-material/ClearOutlined';
import ViewIcon from '@mui/icons-material/VisibilityOutlined';
import AssignIcon from '@mui/icons-material/AssignmentIndOutlined';
import ReturnIcon from '@mui/icons-material/AssignmentReturnOutlined';
import DevicesIcon from '@mui/icons-material/DevicesOutlined';
import InventoryIcon from '@mui/icons-material/InventoryOutlined';
import HowToRegIcon from '@mui/icons-material/HowToRegOutlined';

import PageHeader from '@components/common/PageHeader.jsx';
import DataTable from '@components/common/DataTable.jsx';
import StatCard from '@components/common/StatCard.jsx';
import EmployeePicker from '@components/common/EmployeePicker.jsx';
import ExportMenu from '@components/common/ExportMenu.jsx';
import useTableState from '@hooks/useTableState.js';
import usePermissions from '@hooks/usePermissions.js';
import { RESOURCES, ACTIONS } from '@utils/permissions.js';
import payrollService from '@services/modules/payroll.service.js';
import {
  AssetFormDialog,
  AssetAssignDialog,
  AssetReturnDialog,
  ASSET_CATEGORIES,
} from './components/AssetDialogs.jsx';
import { formatCurrency, formatDate, humanize } from '@utils/format.js';
import { getRowId, displayName, employeeIdentifiers } from '@utils/dataGrid.js';
import { PATHS } from '@routes/paths.js';

const STATUS_COLOR = {
  AVAILABLE: 'success',
  ASSIGNED: 'primary',
  RETURNED: 'default',
  LOST: 'error',
  DAMAGED: 'warning',
  RETIRED: 'default',
};

/** The open assignment is the last one with no return date. */
const openAssignment = (asset) =>
  [...(asset.assignments ?? [])].reverse().find((entry) => !entry.returnedOn) ?? null;

/**
 * The company asset register: what exists, who holds it, and the issue/return
 * cycle.
 *
 * It lives under /payroll on the server because its first consumer was exit
 * recovery -- an unreturned laptop becomes a deduction on the settlement sheet.
 * The screen sits under Employee Management, which is where people look for it.
 */
const EmployeeAssetsPage = () => {
  const navigate = useNavigate();
  const { can } = usePermissions();

  const canCreate = can(RESOURCES.PAYROLL, ACTIONS.CREATE);
  const canUpdate = can(RESOURCES.PAYROLL, ACTIONS.UPDATE);

  const table = useTableState({
    initialFilters: { status: '', category: '' },
    initialSort: 'assetCode',
    initialSortOrder: 'asc',
  });

  const [employee, setEmployee] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [dialog, setDialog] = useState(null);

  const { params, setTotal } = table;

  const load = useCallback(() => {
    setLoading(true);
    setError(null);

    payrollService
      .listAssets({ ...params, employeeId: employee ? getRowId(employee) : undefined })
      .then((response) => {
        setRows(response.data ?? []);
        setTotal(response.meta?.total ?? 0);
      })
      .catch((rejection) => {
        setRows([]);
        setError(rejection?.message ?? 'Could not load the asset register');
      })
      .finally(() => setLoading(false));
  }, [params, employee, setTotal]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSaved = (message) => {
    setDialog(null);
    setNotice({ severity: 'success', message });
    load();
  };

  const assigned = rows.filter((row) => row.status === 'ASSIGNED').length;
  const available = rows.filter((row) => row.status === 'AVAILABLE').length;

  const columns = [
    { key: 'assetCode', label: 'Code', width: 120, sortable: true },
    {
      key: 'name',
      label: 'Asset',
      sortable: true,
      exportValue: (row) => row.name,
      render: (row) => (
        <Box>
          <Typography variant="body2">{row.name}</Typography>
          <Typography variant="caption" color="text.secondary">
            {[row.make, row.model].filter(Boolean).join(' ') || '—'}
            {row.serialNumber ? ` · ${row.serialNumber}` : ''}
          </Typography>
        </Box>
      ),
    },
    {
      key: 'category',
      label: 'Category',
      sortable: true,
      exportValue: (row) => humanize(row.category),
      render: (row) => humanize(row.category),
    },
    {
      key: 'holder',
      label: 'Held by',
      exportValue: (row) => displayName(row.currentHolderId) || 'In stock',
      render: (row) =>
        row.currentHolderId ? (
          <Box>
            <Typography variant="body2">{displayName(row.currentHolderId) || '—'}</Typography>
            <Typography variant="caption" color="text.secondary">
              {employeeIdentifiers(row.currentHolderId)}
            </Typography>
          </Box>
        ) : (
          <Typography variant="caption" color="text.secondary">
            In stock
          </Typography>
        ),
    },
    {
      key: 'assignedOn',
      label: 'Issued',
      exportValue: (row) => (openAssignment(row) ? formatDate(openAssignment(row).assignedOn) : ''),
      render: (row) => {
        const open = openAssignment(row);
        return open ? formatDate(open.assignedOn) : '—';
      },
    },
    {
      key: 'purchaseCost',
      label: 'Cost',
      align: 'right',
      sortable: true,
      exportValue: (row) => row.purchaseCost,
      render: (row) => formatCurrency(row.purchaseCost),
    },
    {
      key: 'recoveryValue',
      label: 'Recovery value',
      align: 'right',
      exportValue: (row) => row.recoveryValue,
      render: (row) => formatCurrency(row.recoveryValue),
    },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      exportValue: (row) => humanize(row.status),
      render: (row) => (
        <Box>
          <Chip label={humanize(row.status)} size="small" color={STATUS_COLOR[row.status] ?? 'default'} variant="outlined" />
          <Typography variant="caption" display="block" color="text.secondary">
            {humanize(row.condition)}
          </Typography>
        </Box>
      ),
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      width: 120,
      render: (row) => (
        // Stops a row click from also opening the detail page underneath.
        <Stack direction="row" spacing={0.5} justifyContent="flex-end" onClick={(event) => event.stopPropagation()}>
          <Tooltip title="View">
            <IconButton size="small" onClick={() => navigate(`/employees/assets/${getRowId(row)}`)}>
              <ViewIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          {canUpdate && row.status === 'AVAILABLE' && (
            <Tooltip title="Issue">
              <IconButton size="small" onClick={() => setDialog({ type: 'assign', asset: row })}>
                <AssignIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}

          {canUpdate && row.status === 'ASSIGNED' && (
            <Tooltip title="Return">
              <IconButton size="small" onClick={() => setDialog({ type: 'return', asset: row })}>
                <ReturnIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Stack>
      ),
    },
  ];

  const hasFilters = table.activeFilterCount > 0 || Boolean(employee);

  return (
    <Box>
      <PageHeader
        title="Employee Assets"
        subtitle="Company property and who is currently holding it"
        breadcrumbs={[
          { label: 'Home', to: PATHS.dashboard },
          { label: 'Employee Management' },
          { label: 'Assets' },
        ]}
        actions={
          <Stack direction="row" spacing={1} data-print="hide">
            <ExportMenu
              columns={columns}
              rows={rows}
              filename="assets"
              totalCount={table.total}
              onError={(message) => setNotice({ severity: 'error', message })}
            />
            {canCreate && (
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialog({ type: 'create' })}>
                Add asset
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

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard label="Assets in register" value={table.total} icon={DevicesIcon} loading={loading} />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard label="Issued (this page)" value={assigned} icon={HowToRegIcon} color="info" loading={loading} />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard label="In stock (this page)" value={available} icon={InventoryIcon} color="success" loading={loading} />
        </Grid>
      </Grid>

      <Stack direction="row" spacing={1} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap data-print="hide">
        <TextField
          size="small"
          placeholder="Search code, name or serial"
          value={table.search}
          onChange={(event) => table.setSearch(event.target.value)}
          sx={{ width: { xs: '100%', sm: 260 } }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
        />

        <EmployeePicker value={employee} onChange={setEmployee} label="Held by" sx={{ width: { xs: '100%', sm: 240 } }} />

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

        <TextField
          select
          size="small"
          label="Category"
          value={table.filters.category}
          onChange={(event) => table.setFilter('category', event.target.value)}
          sx={{ width: 170 }}
        >
          <MenuItem value="">All categories</MenuItem>
          {ASSET_CATEGORIES.map((category) => (
            <MenuItem key={category} value={category}>
              {humanize(category)}
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
        onRowClick={(row) => navigate(`/employees/assets/${getRowId(row)}`)}
        emptyTitle={hasFilters ? 'No assets match these filters' : 'The register is empty'}
        emptyMessage={
          hasFilters
            ? 'Try clearing a filter, or widen the search.'
            : canCreate
              ? 'Add the first item to start tracking company property.'
              : null
        }
        emptyAction={
          !hasFilters && canCreate ? (
            <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={() => setDialog({ type: 'create' })}>
              Add asset
            </Button>
          ) : null
        }
        page={table.page}
        limit={table.limit}
        total={table.total}
        onPageChange={table.setPage}
        onLimitChange={table.setLimit}
      />

      <AssetFormDialog open={dialog?.type === 'create'} onClose={() => setDialog(null)} onSaved={handleSaved} />
      <AssetAssignDialog
        open={dialog?.type === 'assign'}
        asset={dialog?.asset}
        onClose={() => setDialog(null)}
        onSaved={handleSaved}
      />
      <AssetReturnDialog
        open={dialog?.type === 'return'}
        asset={dialog?.asset}
        onClose={() => setDialog(null)}
        onSaved={handleSaved}
      />
    </Box>
  );
};

export default EmployeeAssetsPage;
