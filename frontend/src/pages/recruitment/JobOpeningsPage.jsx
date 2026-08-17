import { useCallback, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/AddOutlined';
import SearchIcon from '@mui/icons-material/SearchOutlined';
import ClearIcon from '@mui/icons-material/ClearOutlined';
import EditIcon from '@mui/icons-material/EditOutlined';
import DeleteIcon from '@mui/icons-material/DeleteOutlineOutlined';
import WorkIcon from '@mui/icons-material/WorkOutlineOutlined';
import PeopleIcon from '@mui/icons-material/PeopleAltOutlined';

import PageHeader from '@components/common/PageHeader.jsx';
import DataTable from '@components/common/DataTable.jsx';
import StatCard from '@components/common/StatCard.jsx';
import ExportMenu from '@components/common/ExportMenu.jsx';
import FormDialog from '@components/common/FormDialog.jsx';
import CurrencyAdornment from '@components/common/CurrencyAdornment.jsx';
import ConfirmDialog from '@components/feedback/ConfirmDialog.jsx';
import useTableState from '@hooks/useTableState.js';
import usePermissions from '@hooks/usePermissions.js';
import { RESOURCES, ACTIONS } from '@utils/permissions.js';
import { useAppDispatch, useAppSelector } from '@hooks/useRedux.js';
import { fetchMasters, selectMasters } from '@redux/slices/employeeSlice.js';
import recruitmentService from '@services/modules/recruitment.service.js';
import { JOB_STATUS_COLOR, EMPLOYMENT_TYPES } from './recruitmentConstants.js';
import { formatCurrency, formatDate, humanize } from '@utils/format.js';
import { getRowId } from '@utils/dataGrid.js';
import { PATHS } from '@routes/paths.js';

const EMPTY = {
  title: '',
  code: '',
  description: '',
  departmentId: '',
  designationId: '',
  unitId: '',
  employmentType: 'FULL_TIME',
  vacancies: 1,
  minExperienceYears: 0,
  maxExperienceYears: 0,
  minSalary: '',
  maxSalary: '',
  location: '',
  status: 'OPEN',
  closesOn: '',
};

/**
 * Requisitions: what is being hired for, and how far along each one is.
 *
 * A seat is consumed when someone actually joins, not when an offer goes out --
 * an accepted offer that never turns up must not close the role. That is why
 * `filled` moves at conversion and nowhere else.
 */
const JobOpeningsPage = () => {
  const dispatch = useAppDispatch();
  const masters = useAppSelector(selectMasters);
  const { can } = usePermissions();

  const canCreate = can(RESOURCES.RECRUITMENT, ACTIONS.CREATE);
  const canUpdate = can(RESOURCES.RECRUITMENT, ACTIONS.UPDATE);
  const canDelete = can(RESOURCES.RECRUITMENT, ACTIONS.DELETE);

  const table = useTableState({ initialFilters: { status: '', departmentId: '' }, initialSort: 'createdAt' });

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [form, setForm] = useState(undefined);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);

  const { params, setTotal } = table;

  useEffect(() => {
    dispatch(fetchMasters());
  }, [dispatch]);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);

    recruitmentService
      .listJobs(params)
      .then((response) => {
        setRows(response.data ?? []);
        setTotal(response.meta?.total ?? 0);
      })
      .catch((rejection) => {
        setRows([]);
        setError(rejection?.message ?? 'Could not load job openings');
      })
      .finally(() => setLoading(false));
  }, [params, setTotal]);

  useEffect(() => {
    load();
  }, [load]);

  const set = (field) => (event) => setForm((previous) => ({ ...previous, [field]: event.target.value }));

  const openEdit = (row) => {
    setEditingId(getRowId(row));
    setForm({
      ...EMPTY,
      ...row,
      description: row.description ?? '',
      location: row.location ?? '',
      departmentId: row.departmentId?._id ?? row.departmentId ?? '',
      designationId: row.designationId?._id ?? row.designationId ?? '',
      unitId: row.unitId?._id ?? row.unitId ?? '',
      closesOn: row.closesOn ? new Date(row.closesOn).toISOString().slice(0, 10) : '',
    });
  };

  const handleSave = async () => {
    setSaving(true);

    const payload = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      departmentId: form.departmentId || null,
      designationId: form.designationId || null,
      unitId: form.unitId || null,
      employmentType: form.employmentType,
      vacancies: Number(form.vacancies) || 1,
      minExperienceYears: Number(form.minExperienceYears) || 0,
      maxExperienceYears: Number(form.maxExperienceYears) || 0,
      minSalary: Number(form.minSalary) || 0,
      maxSalary: Number(form.maxSalary) || 0,
      location: form.location.trim() || null,
      status: form.status,
      ...(form.closesOn ? { closesOn: form.closesOn } : {}),
      ...(editingId ? {} : { code: form.code.trim().toUpperCase() || null }),
    };

    try {
      if (editingId) await recruitmentService.updateJob(editingId, payload);
      else await recruitmentService.createJob(payload);

      setNotice({ severity: 'success', message: editingId ? 'Opening updated' : 'Opening created' });
      setForm(undefined);
      setEditingId(null);
      load();
    } catch (rejection) {
      setNotice({ severity: 'error', message: rejection?.message ?? 'The opening could not be saved' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const target = pendingDelete;
    setPendingDelete(null);

    try {
      await recruitmentService.deleteJob(getRowId(target));
      setNotice({ severity: 'success', message: `${target.title} deleted` });
      load();
    } catch (rejection) {
      // A 409 is the applicant guard, not a failure.
      setNotice({ severity: 'warning', message: rejection?.message ?? 'Could not delete' });
    }
  };

  const openCount = rows.filter((row) => row.status === 'OPEN').length;
  const totalVacancies = rows.reduce((sum, row) => sum + (row.remaining ?? 0), 0);

  const columns = [
    {
      key: 'title',
      label: 'Role',
      sortable: true,
      exportValue: (row) => row.title,
      render: (row) => (
        <Box>
          <Typography variant="body2" fontWeight={500}>
            {row.title}
          </Typography>
          <Typography variant="caption" color="text.secondary" fontFamily="monospace">
            {row.code}
            {row.location ? ` · ${row.location}` : ''}
          </Typography>
        </Box>
      ),
    },
    {
      key: 'department',
      label: 'Department',
      exportValue: (row) => row.departmentId?.name,
      render: (row) => row.departmentId?.name ?? '—',
    },
    {
      key: 'seats',
      label: 'Seats',
      width: 160,
      exportValue: (row) => `${row.filled}/${row.vacancies}`,
      render: (row) => {
        const share = row.vacancies ? (row.filled / row.vacancies) * 100 : 0;

        return (
          <Box sx={{ minWidth: 120 }}>
            <Typography variant="caption">
              {row.filled ?? 0} of {row.vacancies} filled
            </Typography>
            <LinearProgress
              variant="determinate"
              value={Math.min(100, share)}
              sx={{ mt: 0.5, height: 5, borderRadius: 3 }}
              color={share >= 100 ? 'success' : 'primary'}
            />
          </Box>
        );
      },
    },
    {
      key: 'applicants',
      label: 'Applicants',
      align: 'right',
      exportValue: (row) => row.applicants,
      render: (row) =>
        row.applicants ? <Chip label={row.applicants} size="small" color="info" variant="outlined" /> : '—',
    },
    {
      key: 'salary',
      label: 'Salary band',
      align: 'right',
      exportValue: (row) => `${row.minSalary}-${row.maxSalary}`,
      render: (row) =>
        row.maxSalary ? (
          <Typography variant="caption">
            {formatCurrency(row.minSalary)} – {formatCurrency(row.maxSalary)}
          </Typography>
        ) : (
          '—'
        ),
    },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      exportValue: (row) => humanize(row.status),
      render: (row) => (
        <Box>
          <Chip label={humanize(row.status)} size="small" color={JOB_STATUS_COLOR[row.status] ?? 'default'} />
          {row.closesOn && (
            <Typography variant="caption" display="block" color="text.secondary">
              closes {formatDate(row.closesOn)}
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
        <Stack direction="row" spacing={0.25} justifyContent="flex-end">
          {canUpdate && (
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

  const hasFilters = table.activeFilterCount > 0;

  const picker = (label, field, options) => (
    <Grid size={{ xs: 12, sm: 6, md: 4 }}>
      <TextField select size="small" fullWidth label={label} value={form?.[field] ?? ''} onChange={set(field)}>
        <MenuItem value="">
          <em>None</em>
        </MenuItem>
        {(options ?? []).map((option) => (
          <MenuItem key={option._id} value={option._id}>
            {option.name}
          </MenuItem>
        ))}
      </TextField>
    </Grid>
  );

  return (
    <Box>
      <PageHeader
        title="Job Openings"
        subtitle="Requisitions, their seats and who is applying"
        breadcrumbs={[{ label: 'Home', to: PATHS.dashboard }, { label: 'Recruitment' }, { label: 'Job Openings' }]}
        actions={
          <Stack direction="row" spacing={1} data-print="hide">
            <ExportMenu
              columns={columns}
              rows={rows}
              filename="job-openings"
              totalCount={table.total}
              onError={(message) => setNotice({ severity: 'error', message })}
            />
            {canCreate && (
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => {
                  setEditingId(null);
                  setForm({ ...EMPTY });
                }}
              >
                New opening
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
          <StatCard label="Openings" value={table.total} icon={WorkIcon} loading={loading} />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard label="Open (this page)" value={openCount} color="success" loading={loading} />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard label="Seats to fill" value={totalVacancies} icon={PeopleIcon} color="info" loading={loading} />
        </Grid>
      </Grid>

      <Stack direction="row" spacing={1} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap data-print="hide">
        <TextField
          size="small"
          placeholder="Search title, code or location"
          value={table.search}
          onChange={(event) => table.setSearch(event.target.value)}
          sx={{ width: { xs: '100%', sm: 300 } }}
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
          <MenuItem value="">All statuses</MenuItem>
          {Object.keys(JOB_STATUS_COLOR).map((status) => (
            <MenuItem key={status} value={status}>
              {humanize(status)}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          select
          size="small"
          label="Department"
          value={table.filters.departmentId}
          onChange={(event) => table.setFilter('departmentId', event.target.value)}
          sx={{ width: 220 }}
        >
          <MenuItem value="">All departments</MenuItem>
          {(masters?.departments ?? []).map((department) => (
            <MenuItem key={department._id} value={department._id}>
              {department.name}
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
        emptyTitle={hasFilters ? 'No openings match' : 'No job openings yet'}
        emptyMessage={
          hasFilters ? 'Try clearing a filter.' : 'Raise a requisition before candidates can apply.'
        }
        emptyAction={
          !hasFilters && canCreate ? (
            <Button
              size="small"
              variant="outlined"
              startIcon={<AddIcon />}
              onClick={() => {
                setEditingId(null);
                setForm({ ...EMPTY });
              }}
            >
              New opening
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
        title={editingId ? 'Edit opening' : 'New job opening'}
        subtitle={editingId ? form?.title : 'Only OPEN roles accept applications'}
        submitting={saving}
        submitLabel={editingId ? 'Save changes' : 'Create opening'}
        disabled={!form?.title?.trim()}
        onSubmit={handleSave}
        onClose={() => {
          setForm(undefined);
          setEditingId(null);
        }}
        maxWidth="md"
      >
        <Grid container spacing={2} sx={{ pt: 0.5 }}>
          <Grid size={{ xs: 12, sm: 8 }}>
            <TextField label="Title" value={form?.title ?? ''} onChange={set('title')} fullWidth required autoFocus size="small" />
          </Grid>

          <Grid size={{ xs: 12, sm: 4 }}>
            <TextField
              label="Code"
              value={form?.code ?? ''}
              onChange={set('code')}
              fullWidth
              size="small"
              disabled={Boolean(editingId)}
              helperText={editingId ? 'Fixed once created' : 'Blank to generate'}
            />
          </Grid>

          {picker('Department', 'departmentId', masters?.departments)}
          {picker('Designation', 'designationId', masters?.designations)}
          {picker('Unit', 'unitId', masters?.units)}

          <Grid size={{ xs: 12, sm: 6, md: 4 }}>
            <TextField select size="small" fullWidth label="Employment type" value={form?.employmentType ?? 'FULL_TIME'} onChange={set('employmentType')}>
              {EMPLOYMENT_TYPES.map((type) => (
                <MenuItem key={type} value={type}>
                  {humanize(type)}
                </MenuItem>
              ))}
            </TextField>
          </Grid>

          <Grid size={{ xs: 12, sm: 6, md: 4 }}>
            <TextField label="Vacancies" type="number" size="small" fullWidth value={form?.vacancies ?? 1} onChange={set('vacancies')} slotProps={{ input: { inputProps: { min: 1, max: 999 } } }} />
          </Grid>

          <Grid size={{ xs: 12, sm: 6, md: 4 }}>
            <TextField select size="small" fullWidth label="Status" value={form?.status ?? 'OPEN'} onChange={set('status')}>
              {Object.keys(JOB_STATUS_COLOR).map((status) => (
                <MenuItem key={status} value={status}>
                  {humanize(status)}
                </MenuItem>
              ))}
            </TextField>
          </Grid>

          <Grid size={{ xs: 12, sm: 6, md: 4 }}>
            <TextField label="Location" size="small" fullWidth value={form?.location ?? ''} onChange={set('location')} />
          </Grid>

          <Grid size={{ xs: 6, sm: 3, md: 2 }}>
            <TextField label="Min exp (yrs)" type="number" size="small" fullWidth value={form?.minExperienceYears ?? 0} onChange={set('minExperienceYears')} />
          </Grid>
          <Grid size={{ xs: 6, sm: 3, md: 2 }}>
            <TextField label="Max exp (yrs)" type="number" size="small" fullWidth value={form?.maxExperienceYears ?? 0} onChange={set('maxExperienceYears')} />
          </Grid>

          <Grid size={{ xs: 6, sm: 3, md: 2 }}>
            <TextField
              label="Min salary"
              type="number"
              size="small"
              fullWidth
              value={form?.minSalary ?? ''}
              onChange={set('minSalary')}
              slotProps={{ input: { startAdornment: <CurrencyAdornment /> } }}
            />
          </Grid>
          <Grid size={{ xs: 6, sm: 3, md: 2 }}>
            <TextField
              label="Max salary"
              type="number"
              size="small"
              fullWidth
              value={form?.maxSalary ?? ''}
              onChange={set('maxSalary')}
              slotProps={{ input: { startAdornment: <CurrencyAdornment /> } }}
            />
          </Grid>

          <Grid size={{ xs: 12, sm: 6, md: 4 }}>
            <TextField
              label="Closes on"
              type="date"
              size="small"
              fullWidth
              value={form?.closesOn ?? ''}
              onChange={set('closesOn')}
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Grid>

          <Grid size={12}>
            <TextField label="Description" value={form?.description ?? ''} onChange={set('description')} fullWidth multiline rows={3} size="small" />
          </Grid>
        </Grid>
      </FormDialog>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={`Delete ${pendingDelete?.title ?? 'this opening'}?`}
        message="Refused if anyone has applied — close the opening instead, which keeps the applicants readable."
        confirmLabel="Delete"
        confirmColor="error"
        onConfirm={handleDelete}
        onClose={() => setPendingDelete(null)}
      />
    </Box>
  );
};

export default JobOpeningsPage;
