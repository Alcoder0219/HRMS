import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import SearchIcon from '@mui/icons-material/SearchOutlined';
import AddIcon from '@mui/icons-material/AddOutlined';
import ClearIcon from '@mui/icons-material/ClearOutlined';
import EditIcon from '@mui/icons-material/EditOutlined';
import ViewIcon from '@mui/icons-material/VisibilityOutlined';
import DeleteIcon from '@mui/icons-material/DeleteOutlineOutlined';
import UploadIcon from '@mui/icons-material/UploadFileOutlined';

import PageHeader from '@components/common/PageHeader.jsx';
import DataTable from '@components/common/DataTable.jsx';
import ExportMenu from '@components/common/ExportMenu.jsx';
import ImportDialog from '@components/common/ImportDialog.jsx';
import ConfirmDialog from '@components/feedback/ConfirmDialog.jsx';
import MasterFormDialog from './components/MasterFormDialog.jsx';
import useTableState from '@hooks/useTableState.js';
import usePermissions from '@hooks/usePermissions.js';
import { RESOURCES, ACTIONS } from '@utils/permissions.js';
import organizationService from '@services/modules/organization.service.js';
import { ORGANIZATION_MASTERS, WEEK_DAYS } from '@config/organizationMasters.js';
import { formatCurrency, emptyDash } from '@utils/format.js';
import { getRowId } from '@utils/dataGrid.js';
import { PATHS } from '@routes/paths.js';

/**
 * The organization masters, all served by one screen.
 *
 * Five of the six are the same shape -- a named, coded reference list -- so
 * they share a component and differ only in their column set and their form
 * descriptor. Splitting them into five near-identical files would multiply the
 * maintenance without changing a single pixel.
 */

const codeCell = (row) => (
  <Typography variant="caption" fontFamily="monospace">
    {emptyDash(row.code)}
  </Typography>
);

/** Extra columns per master, on top of the name/code/status the five share. */
const EXTRA_COLUMNS = {
  units: [
    { key: 'city', label: 'City', sortable: true, render: (row) => emptyDash(row.city) },
    { key: 'state', label: 'State', sortable: true, render: (row) => emptyDash(row.state) },
    { key: 'ptState', label: 'PT state', render: (row) => emptyDash(row.ptState) },
    { key: 'lwfState', label: 'LWF state', render: (row) => emptyDash(row.lwfState) },
  ],

  departments: [
    {
      key: 'parentId',
      label: 'Parent',
      exportValue: (row) => row.parentId?.name,
      render: (row) => emptyDash(row.parentId?.name),
    },
    {
      key: 'description',
      label: 'Description',
      exportValue: (row) => row.description,
      render: (row) => (
        <Typography variant="caption" color="text.secondary">
          {emptyDash(row.description)}
        </Typography>
      ),
    },
  ],

  designations: [
    { key: 'level', label: 'Level', align: 'right', sortable: true, render: (row) => emptyDash(row.level) },
    {
      key: 'departmentId',
      label: 'Department',
      exportValue: (row) => row.departmentId?.name,
      render: (row) => emptyDash(row.departmentId?.name),
    },
  ],

  grades: [
    { key: 'level', label: 'Level', align: 'right', sortable: true, render: (row) => emptyDash(row.level) },
    {
      key: 'minGross',
      label: 'Min gross',
      align: 'right',
      sortable: true,
      exportValue: (row) => row.minGross,
      render: (row) => formatCurrency(row.minGross),
    },
    {
      key: 'maxGross',
      label: 'Max gross',
      align: 'right',
      sortable: true,
      exportValue: (row) => row.maxGross,
      render: (row) => formatCurrency(row.maxGross),
    },
  ],

  shifts: [
    { key: 'startTime', label: 'Starts', sortable: true, render: (row) => emptyDash(row.startTime) },
    { key: 'endTime', label: 'Ends', sortable: true, render: (row) => emptyDash(row.endTime) },
    {
      key: 'breakMinutes',
      label: 'Break',
      align: 'right',
      render: (row) => (row.breakMinutes ? `${row.breakMinutes} min` : '—'),
    },
    {
      key: 'weeklyOffs',
      label: 'Weekly offs',
      exportValue: (row) => (row.weeklyOffs ?? []).map((day) => WEEK_DAYS[day]?.label).join(', '),
      render: (row) =>
        row.weeklyOffs?.length ? (
          <Stack direction="row" spacing={0.5}>
            {row.weeklyOffs.map((day) => (
              <Chip key={day} label={WEEK_DAYS[day]?.label.slice(0, 3)} size="small" variant="outlined" />
            ))}
          </Stack>
        ) : (
          '—'
        ),
    },
    {
      key: 'isNightShift',
      label: 'Night',
      exportValue: (row) => (row.isNightShift ? 'Yes' : 'No'),
      render: (row) => (row.isNightShift ? <Chip label="Night" size="small" color="info" variant="outlined" /> : '—'),
    },
  ],
};

const MasterListPage = ({ master }) => {
  const config = ORGANIZATION_MASTERS[master];
  const navigate = useNavigate();
  const { can } = usePermissions();

  const canCreate = can(RESOURCES.ORGANIZATION, ACTIONS.CREATE);
  const canUpdate = can(RESOURCES.ORGANIZATION, ACTIONS.UPDATE);
  const canDelete = can(RESOURCES.ORGANIZATION, ACTIONS.DELETE);
  const canExport = can(RESOURCES.ORGANIZATION, ACTIONS.EXPORT);

  const table = useTableState({
    initialFilters: { status: 'all' },
    initialSort: 'name',
    initialSortOrder: 'asc',
  });

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [formRecord, setFormRecord] = useState(undefined); // undefined = closed, null = add
  const [pendingDelete, setPendingDelete] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [parents, setParents] = useState([]);

  const { params, setTotal, resetFilters, setSearch, setFilter } = table;

  const load = useCallback(() => {
    setLoading(true);
    setError(null);

    organizationService
      .listMaster(master, params)
      .then((response) => {
        setRows(response.data ?? []);
        setTotal(response.meta?.total ?? 0);
      })
      .catch((rejection) => {
        setRows([]);
        setError(rejection?.message ?? `Could not load ${config.plural.toLowerCase()}`);
      })
      .finally(() => setLoading(false));
  }, [master, params, setTotal, config]);

  useEffect(() => {
    load();
  }, [load]);

  // Departments are the only reference list the forms offer, and both the
  // department and designation forms need it.
  useEffect(() => {
    if (!['departments', 'designations'].includes(master)) return;

    organizationService
      .departments()
      .then((response) => setParents(response.data ?? []))
      .catch(() => setParents([]));
  }, [master]);

  // Moving between masters must not carry the previous one's search across.
  useEffect(() => {
    resetFilters();
  }, [master, resetFilters]);

  const handleSaved = (message) => {
    setFormRecord(undefined);
    setNotice({ severity: 'success', message });
    load();
  };

  const toggleStatus = async (row) => {
    setBusyId(getRowId(row));

    try {
      await organizationService.setMasterStatus(master, getRowId(row), !row.isActive);
      setNotice({
        severity: 'success',
        message: `${row.name} ${row.isActive ? 'deactivated' : 'activated'}`,
      });
      load();
    } catch (rejection) {
      setNotice({ severity: 'error', message: rejection?.message ?? 'The status could not be changed' });
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async () => {
    const target = pendingDelete;
    setPendingDelete(null);

    try {
      await organizationService.deleteMaster(master, getRowId(target));
      setNotice({ severity: 'success', message: `${target.name} deleted` });
      load();
    } catch (rejection) {
      // A 409 here is the referential guard, not a failure -- the message names
      // what still points at the record and what to do instead.
      setNotice({ severity: 'warning', message: rejection?.message ?? 'Could not delete' });
    }
  };

  const columns = [
    {
      key: 'name',
      label: config.label,
      sortable: true,
      exportValue: (row) => row.name,
      render: (row) => (
        <Typography variant="body2" fontWeight={500} color={row.isActive ? 'text.primary' : 'text.disabled'}>
          {row.name}
        </Typography>
      ),
    },
    { key: 'code', label: 'Code', sortable: true, width: 120, exportValue: (row) => row.code, render: codeCell },

    ...(EXTRA_COLUMNS[master] ?? []),

    {
      key: 'isActive',
      label: 'Status',
      sortable: true,
      width: 130,
      exportValue: (row) => (row.isActive ? 'Active' : 'Inactive'),
      render: (row) => (
        <Stack direction="row" spacing={0.5} alignItems="center" onClick={(event) => event.stopPropagation()}>
          <Switch
            size="small"
            checked={Boolean(row.isActive)}
            disabled={!canUpdate || busyId === getRowId(row)}
            onChange={() => toggleStatus(row)}
            inputProps={{ 'aria-label': `Toggle ${row.name}` }}
          />
          <Typography variant="caption" color={row.isActive ? 'success.main' : 'text.disabled'}>
            {row.isActive ? 'Active' : 'Inactive'}
          </Typography>
        </Stack>
      ),
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      width: 130,
      render: (row) => (
        <Stack direction="row" spacing={0.25} justifyContent="flex-end" onClick={(event) => event.stopPropagation()}>
          <Tooltip title="View details">
            <IconButton size="small" onClick={() => navigate(`${config.path}/${getRowId(row)}`)}>
              <ViewIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          {canUpdate && (
            <Tooltip title="Edit">
              <IconButton size="small" onClick={() => setFormRecord(row)}>
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}

          {canDelete && (
            <Tooltip title="Delete">
              <IconButton size="small" color="error" onClick={() => setPendingDelete(row)}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Stack>
      ),
    },
  ];

  const hasFilters = table.search !== '' || table.filters.status !== 'all';

  return (
    <Box>
      <PageHeader
        title={config.plural}
        subtitle={config.subtitle}
        breadcrumbs={[
          { label: 'Home', to: PATHS.dashboard },
          { label: 'Organization' },
          { label: config.plural },
        ]}
        actions={
          <Stack direction="row" spacing={1} data-print="hide">
            <ExportMenu
              columns={columns}
              rows={rows}
              filename={master}
              totalCount={table.total}
              // Server-side, so the export covers every matching record rather
              // than the page on screen, and carries the server's formatting.
              onExcel={canExport ? () => organizationService.exportMasterExcel(master, params) : null}
              onPdf={canExport ? () => organizationService.exportMasterPdf(master, params) : null}
              onError={(message) => setNotice({ severity: 'error', message })}
            />

            {canUpdate && (
              <Button startIcon={<UploadIcon />} onClick={() => setImportOpen(true)}>
                Import
              </Button>
            )}

            {canCreate && (
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => setFormRecord(null)}>
                Add {config.label.toLowerCase()}
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

      <Stack direction="row" spacing={1} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap data-print="hide">
        <TextField
          size="small"
          placeholder={config.searchPlaceholder}
          value={table.search}
          onChange={(event) => setSearch(event.target.value)}
          sx={{ width: { xs: '100%', sm: 320 } }}
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

        <TextField
          select
          size="small"
          label="Status"
          value={table.filters.status}
          onChange={(event) => setFilter('status', event.target.value)}
          sx={{ width: 160 }}
        >
          <MenuItem value="all">All</MenuItem>
          <MenuItem value="active">Active only</MenuItem>
          <MenuItem value="inactive">Inactive only</MenuItem>
        </TextField>

        {hasFilters && (
          <Button size="small" color="inherit" startIcon={<ClearIcon />} onClick={resetFilters}>
            Clear
          </Button>
        )}

        <Chip
          label={`${table.total} record${table.total === 1 ? '' : 's'}`}
          size="small"
          variant="outlined"
          sx={{ alignSelf: 'center' }}
        />
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
        onRowClick={(row) => navigate(`${config.path}/${getRowId(row)}`)}
        emptyTitle={hasFilters ? `No ${config.plural.toLowerCase()} match` : `No ${config.plural.toLowerCase()} yet`}
        emptyMessage={
          hasFilters
            ? 'Try clearing the search or the status filter.'
            : canCreate
              ? `Add the first ${config.label.toLowerCase()}, or import a spreadsheet.`
              : null
        }
        emptyAction={
          !hasFilters && canCreate ? (
            <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={() => setFormRecord(null)}>
              Add {config.label.toLowerCase()}
            </Button>
          ) : null
        }
        page={table.page}
        limit={table.limit}
        total={table.total}
        onPageChange={table.setPage}
        onLimitChange={table.setLimit}
      />

      <MasterFormDialog
        open={formRecord !== undefined}
        master={master}
        record={formRecord}
        options={{ departments: parents }}
        onClose={() => setFormRecord(undefined)}
        onSaved={handleSaved}
      />

      <ImportDialog
        open={importOpen}
        title={`Import ${config.plural.toLowerCase()}`}
        templateName={`${master}-import-template.xlsx`}
        description={`Rows are matched on Code. An existing code updates that ${config.label.toLowerCase()}; a new one creates it. Nothing is written until you have seen the validation result.`}
        onTemplate={() => organizationService.masterTemplate(master)}
        onImport={(file, dryRun) => organizationService.importMaster(master, file, dryRun)}
        onClose={() => setImportOpen(false)}
        onImported={() => {
          setImportOpen(false);
          setNotice({ severity: 'success', message: 'Import complete' });
          load();
        }}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={`Delete ${pendingDelete?.name ?? ''}?`}
        message={`This removes the ${config.label.toLowerCase()} permanently. If any record still points at it the delete is refused — deactivate it instead to keep history readable.`}
        confirmLabel="Delete"
        confirmColor="error"
        onConfirm={handleDelete}
        onClose={() => setPendingDelete(null)}
      />
    </Box>
  );
};

export default MasterListPage;
