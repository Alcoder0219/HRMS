import { useCallback, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/AddOutlined';
import SearchIcon from '@mui/icons-material/SearchOutlined';
import ClearIcon from '@mui/icons-material/ClearOutlined';
import EditIcon from '@mui/icons-material/EditOutlined';
import DeleteIcon from '@mui/icons-material/DeleteOutlineOutlined';

import PageHeader from '@components/common/PageHeader.jsx';
import DataTable from '@components/common/DataTable.jsx';
import ExportMenu from '@components/common/ExportMenu.jsx';
import FormDialog from '@components/common/FormDialog.jsx';
import ConfirmDialog from '@components/feedback/ConfirmDialog.jsx';
import useTableState from '@hooks/useTableState.js';
import usePermissions from '@hooks/usePermissions.js';
import { RESOURCES, ACTIONS } from '@utils/permissions.js';
import leaveService from '@services/modules/leave.service.js';
import { ACCRUAL_OPTIONS, GENDER_OPTIONS } from './leaveConstants.js';
import { humanize } from '@utils/format.js';
import { getRowId } from '@utils/dataGrid.js';
import { PATHS } from '@routes/paths.js';

const EMPTY = {
  name: '',
  code: '',
  description: '',
  daysPerYear: 12,
  accrual: 'ANNUAL',
  isPaid: true,
  allowHalfDay: true,
  requiresApproval: true,
  countsHolidays: false,
  allowNegativeBalance: false,
  minNoticeDays: 0,
  maxConsecutiveDays: 0,
  applicableAfterMonths: 0,
  applicableGender: '',
  carryForwardEnabled: false,
  carryForwardMaxDays: 0,
  carryForwardExpiryMonths: 12,
  encashmentEnabled: false,
  encashmentMaxDays: 0,
  encashmentMinRetain: 0,
};

/**
 * The leave-type catalogue: what can be taken, how much, and under what rules.
 *
 * Every rule an employee is judged against lives here rather than in code --
 * entitlement, notice, carry-forward, encashment. Those are customer policy
 * decisions that differ per organisation and change without a release.
 */
const LeaveTypesPage = () => {
  const { can } = usePermissions();

  // The catalogue decides everyone's entitlement, so the API gates writes on
  // APPROVE rather than CREATE.
  const canManage = can(RESOURCES.LEAVE, ACTIONS.APPROVE);
  const canDelete = can(RESOURCES.LEAVE, ACTIONS.DELETE);

  const table = useTableState({ initialFilters: { status: 'all' }, initialSort: 'name', initialSortOrder: 'asc' });

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [form, setForm] = useState(undefined);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);

  const { params, setTotal } = table;

  const load = useCallback(() => {
    setLoading(true);
    setError(null);

    leaveService
      .listTypes(params)
      .then((response) => {
        setRows(response.data ?? []);
        setTotal(response.meta?.total ?? 0);
      })
      .catch((rejection) => {
        setRows([]);
        setError(rejection?.message ?? 'Could not load leave types');
      })
      .finally(() => setLoading(false));
  }, [params, setTotal]);

  useEffect(() => {
    load();
  }, [load]);

  const set = (field) => (event) =>
    setForm((previous) => ({
      ...previous,
      [field]: event.target.type === 'checkbox' ? event.target.checked : event.target.value,
    }));

  const openEdit = (row) => {
    setEditingId(getRowId(row));
    setForm({
      ...EMPTY,
      ...row,
      description: row.description ?? '',
      applicableGender: row.applicableGender ?? '',
      carryForwardEnabled: row.carryForward?.enabled ?? false,
      carryForwardMaxDays: row.carryForward?.maxDays ?? 0,
      carryForwardExpiryMonths: row.carryForward?.expiryMonths ?? 12,
      encashmentEnabled: row.encashment?.enabled ?? false,
      encashmentMaxDays: row.encashment?.maxDays ?? 0,
      encashmentMinRetain: row.encashment?.minBalanceToRetain ?? 0,
    });
  };

  const handleSave = async () => {
    setSaving(true);

    const payload = {
      name: form.name.trim(),
      code: form.code.trim().toUpperCase(),
      description: form.description.trim() || null,
      daysPerYear: Number(form.daysPerYear) || 0,
      accrual: form.accrual,
      isPaid: form.isPaid,
      allowHalfDay: form.allowHalfDay,
      requiresApproval: form.requiresApproval,
      countsHolidays: form.countsHolidays,
      allowNegativeBalance: form.allowNegativeBalance,
      minNoticeDays: Number(form.minNoticeDays) || 0,
      maxConsecutiveDays: Number(form.maxConsecutiveDays) || 0,
      applicableAfterMonths: Number(form.applicableAfterMonths) || 0,
      applicableGender: form.applicableGender || null,
      carryForward: {
        enabled: form.carryForwardEnabled,
        maxDays: Number(form.carryForwardMaxDays) || 0,
        expiryMonths: Number(form.carryForwardExpiryMonths) || 12,
      },
      encashment: {
        enabled: form.encashmentEnabled,
        maxDays: Number(form.encashmentMaxDays) || 0,
        minBalanceToRetain: Number(form.encashmentMinRetain) || 0,
      },
    };

    try {
      if (editingId) await leaveService.updateType(editingId, payload);
      else await leaveService.createType(payload);

      setNotice({ severity: 'success', message: editingId ? 'Leave type updated' : 'Leave type created' });
      setForm(undefined);
      setEditingId(null);
      load();
    } catch (rejection) {
      setNotice({ severity: 'error', message: rejection?.message ?? 'The leave type could not be saved' });
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (row) => {
    try {
      await leaveService.setTypeStatus(getRowId(row), !row.isActive);
      setNotice({ severity: 'success', message: `${row.name} ${row.isActive ? 'deactivated' : 'activated'}` });
      load();
    } catch (rejection) {
      setNotice({ severity: 'error', message: rejection?.message ?? 'The status could not be changed' });
    }
  };

  const handleDelete = async () => {
    const target = pendingDelete;
    setPendingDelete(null);

    try {
      await leaveService.deleteType(getRowId(target));
      setNotice({ severity: 'success', message: `${target.name} deleted` });
      load();
    } catch (rejection) {
      // A 409 is the referential guard, not a failure.
      setNotice({ severity: 'warning', message: rejection?.message ?? 'Could not delete' });
    }
  };

  const columns = [
    {
      key: 'name',
      label: 'Leave type',
      sortable: true,
      exportValue: (row) => row.name,
      render: (row) => (
        <Box>
          <Typography variant="body2" fontWeight={500} color={row.isActive ? 'text.primary' : 'text.disabled'}>
            {row.name}
          </Typography>
          <Typography variant="caption" color="text.secondary" fontFamily="monospace">
            {row.code}
          </Typography>
        </Box>
      ),
    },
    {
      key: 'daysPerYear',
      label: 'Days / year',
      align: 'right',
      sortable: true,
      exportValue: (row) => row.daysPerYear,
      render: (row) => (
        <Box>
          <Typography variant="body2">{row.daysPerYear}</Typography>
          <Typography variant="caption" color="text.secondary">
            {humanize(row.accrual)}
          </Typography>
        </Box>
      ),
    },
    {
      key: 'isPaid',
      label: 'Paid',
      exportValue: (row) => (row.isPaid ? 'Yes' : 'No'),
      render: (row) => (
        <Chip label={row.isPaid ? 'Paid' : 'Unpaid'} size="small" color={row.isPaid ? 'success' : 'default'} variant="outlined" />
      ),
    },
    {
      key: 'carryForward',
      label: 'Carry forward',
      exportValue: (row) => (row.carryForward?.enabled ? `${row.carryForward.maxDays} days` : 'No'),
      render: (row) =>
        row.carryForward?.enabled ? (
          <Chip label={`Up to ${row.carryForward.maxDays}`} size="small" color="info" variant="outlined" />
        ) : (
          '—'
        ),
    },
    {
      key: 'encashment',
      label: 'Encashable',
      exportValue: (row) => (row.encashment?.enabled ? `${row.encashment.maxDays} days` : 'No'),
      render: (row) =>
        row.encashment?.enabled ? (
          <Chip label={`Up to ${row.encashment.maxDays}`} size="small" color="primary" variant="outlined" />
        ) : (
          '—'
        ),
    },
    {
      key: 'rules',
      label: 'Rules',
      exportValue: (row) =>
        [row.minNoticeDays ? `${row.minNoticeDays}d notice` : null, row.allowHalfDay ? 'half day' : null]
          .filter(Boolean)
          .join(', '),
      render: (row) => (
        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
          {row.minNoticeDays > 0 && <Chip label={`${row.minNoticeDays}d notice`} size="small" variant="outlined" />}
          {row.maxConsecutiveDays > 0 && <Chip label={`max ${row.maxConsecutiveDays}`} size="small" variant="outlined" />}
          {row.allowHalfDay && <Chip label="½ day" size="small" variant="outlined" />}
          {!row.requiresApproval && <Chip label="auto-approve" size="small" color="warning" variant="outlined" />}
        </Stack>
      ),
    },
    {
      key: 'isActive',
      label: 'Status',
      width: 130,
      exportValue: (row) => (row.isActive ? 'Active' : 'Inactive'),
      render: (row) => (
        <Stack direction="row" spacing={0.5} alignItems="center">
          <Switch size="small" checked={Boolean(row.isActive)} disabled={!canManage} onChange={() => toggleStatus(row)} />
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
      width: 100,
      render: (row) => (
        <Stack direction="row" spacing={0.25} justifyContent="flex-end">
          {canManage && (
            <Tooltip title="Edit">
              <IconButton size="small" onClick={() => openEdit(row)}>
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

  const number = (label, field, helper = null, extra = {}) => (
    <Grid size={{ xs: 12, sm: 6, md: 4 }}>
      <TextField
        label={label}
        type="number"
        size="small"
        fullWidth
        value={form?.[field] ?? ''}
        onChange={set(field)}
        helperText={helper}
        slotProps={{ input: { inputProps: extra } }}
      />
    </Grid>
  );

  const toggle = (label, field, helper = null) => (
    <Grid size={{ xs: 12, sm: 6, md: 4 }}>
      <FormControlLabel control={<Switch checked={Boolean(form?.[field])} onChange={set(field)} />} label={label} />
      {helper && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ ml: 6, mt: -0.5 }}>
          {helper}
        </Typography>
      )}
    </Grid>
  );

  return (
    <Box>
      <PageHeader
        title="Leave Types"
        subtitle="What can be taken, how much of it, and under what rules"
        breadcrumbs={[{ label: 'Home', to: PATHS.dashboard }, { label: 'Leave' }, { label: 'Types' }]}
        actions={
          <Stack direction="row" spacing={1} data-print="hide">
            <ExportMenu
              columns={columns}
              rows={rows}
              filename="leave-types"
              totalCount={table.total}
              onError={(message) => setNotice({ severity: 'error', message })}
            />
            {canManage && (
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => {
                  setEditingId(null);
                  setForm({ ...EMPTY });
                }}
              >
                Add leave type
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
          placeholder="Search name or code"
          value={table.search}
          onChange={(event) => table.setSearch(event.target.value)}
          sx={{ width: { xs: '100%', sm: 280 } }}
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
          onChange={(event) => table.setFilter('status', event.target.value)}
          sx={{ width: 160 }}
        >
          <MenuItem value="all">All</MenuItem>
          <MenuItem value="active">Active only</MenuItem>
          <MenuItem value="inactive">Inactive only</MenuItem>
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
        emptyTitle={hasFilters ? 'No leave types match' : 'No leave types yet'}
        emptyMessage={
          hasFilters ? 'Try clearing the search or the status filter.' : 'Nobody can apply for leave until a type exists.'
        }
        emptyAction={
          !hasFilters && canManage ? (
            <Button
              size="small"
              variant="outlined"
              startIcon={<AddIcon />}
              onClick={() => {
                setEditingId(null);
                setForm({ ...EMPTY });
              }}
            >
              Add leave type
            </Button>
          ) : null
        }
        page={table.page}
        limit={table.limit}
        total={table.total}
        onPageChange={table.setPage}
        onLimitChange={table.setLimit}
      />

      <FormDialog
        open={form !== undefined}
        title={editingId ? 'Edit leave type' : 'Add leave type'}
        subtitle={editingId ? form?.name : 'These rules apply to everyone who takes this leave'}
        submitting={saving}
        submitLabel={editingId ? 'Save changes' : 'Create leave type'}
        disabled={!form?.name?.trim() || !form?.code?.trim()}
        onSubmit={handleSave}
        onClose={() => {
          setForm(undefined);
          setEditingId(null);
        }}
        maxWidth="md"
      >
        <Grid container spacing={2} sx={{ pt: 0.5 }}>
          <Grid size={{ xs: 12, sm: 8 }}>
            <TextField label="Name" value={form?.name ?? ''} onChange={set('name')} fullWidth required autoFocus size="small" />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <TextField
              label="Code"
              value={form?.code ?? ''}
              onChange={(event) => setForm((p) => ({ ...p, code: event.target.value.toUpperCase() }))}
              fullWidth
              required
              size="small"
            />
          </Grid>

          <Grid size={12}>
            <TextField label="Description" value={form?.description ?? ''} onChange={set('description')} fullWidth size="small" />
          </Grid>

          {number('Days per year', 'daysPerYear', null, { min: 0, max: 365 })}

          <Grid size={{ xs: 12, sm: 6, md: 4 }}>
            <TextField select label="Accrual" size="small" fullWidth value={form?.accrual ?? 'ANNUAL'} onChange={set('accrual')}>
              {ACCRUAL_OPTIONS.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
            <Typography variant="caption" color="text.secondary">
              {ACCRUAL_OPTIONS.find((option) => option.value === form?.accrual)?.help}
            </Typography>
          </Grid>

          <Grid size={{ xs: 12, sm: 6, md: 4 }}>
            <TextField
              select
              label="Applies to"
              size="small"
              fullWidth
              value={form?.applicableGender ?? ''}
              onChange={set('applicableGender')}
            >
              {GENDER_OPTIONS.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
          </Grid>

          {toggle('Paid leave', 'isPaid', 'Unpaid leave still needs approval but reaches payroll as loss of pay')}
          {toggle('Allow half days', 'allowHalfDay')}
          {toggle('Needs approval', 'requiresApproval', 'Off means it is approved the moment it is applied for')}

          {number('Minimum notice (days)', 'minNoticeDays', null, { min: 0, max: 90 })}
          {number('Max consecutive days', 'maxConsecutiveDays', '0 for no limit', { min: 0, max: 365 })}
          {number('Available after (months)', 'applicableAfterMonths', 'Probation gate', { min: 0, max: 60 })}

          {toggle('Charge holidays inside the leave', 'countsHolidays', 'Off skips weekly offs and holidays')}
          {toggle('Allow a negative balance', 'allowNegativeBalance')}

          <Grid size={12}>
            <Typography variant="subtitle2" sx={{ mt: 1 }}>
              Carry forward
            </Typography>
          </Grid>

          {toggle('Enable carry forward', 'carryForwardEnabled')}
          {number('Maximum days carried', 'carryForwardMaxDays', 'Cannot exceed the annual entitlement', { min: 0, max: 365 })}
          {number('Expires after (months)', 'carryForwardExpiryMonths', null, { min: 1, max: 60 })}

          <Grid size={12}>
            <Typography variant="subtitle2" sx={{ mt: 1 }}>
              Encashment
            </Typography>
          </Grid>

          {toggle('Enable encashment', 'encashmentEnabled')}
          {number('Maximum days encashable', 'encashmentMaxDays', 'Cannot exceed the annual entitlement', { min: 0, max: 365 })}
          {number('Balance to retain', 'encashmentMinRetain', 'Only days above this may be paid out', { min: 0, max: 365 })}
        </Grid>
      </FormDialog>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={`Delete ${pendingDelete?.name ?? 'this leave type'}?`}
        message="This is refused if any balance or request still points at it — deactivate it instead to keep history readable."
        confirmLabel="Delete"
        confirmColor="error"
        onConfirm={handleDelete}
        onClose={() => setPendingDelete(null)}
      />
    </Box>
  );
};

export default LeaveTypesPage;
