import { useCallback, useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import DialogActions from '@mui/material/DialogActions';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/AddOutlined';
import SearchIcon from '@mui/icons-material/SearchOutlined';
import ClearIcon from '@mui/icons-material/ClearOutlined';
import EditIcon from '@mui/icons-material/EditOutlined';
import ViewIcon from '@mui/icons-material/VisibilityOutlined';
import DeleteIcon from '@mui/icons-material/DeleteOutlineOutlined';

import PageHeader from '@components/common/PageHeader.jsx';
import DataTable from '@components/common/DataTable.jsx';
import ExportMenu from '@components/common/ExportMenu.jsx';
import FormDialog from '@components/common/FormDialog.jsx';
import AuditTrail from '@components/common/AuditTrail.jsx';
import ConfirmDialog from '@components/feedback/ConfirmDialog.jsx';
import usePermissions from '@hooks/usePermissions.js';
import { RESOURCES, ACTIONS } from '@utils/permissions.js';
import attendanceService from '@services/modules/attendance.service.js';
import { formatDate, humanize } from '@utils/format.js';
import { getRowId } from '@utils/dataGrid.js';
import { PATHS } from '@routes/paths.js';

const TYPES = ['PUBLIC', 'RESTRICTED', 'COMPANY'];
const TYPE_COLOR = { PUBLIC: 'primary', RESTRICTED: 'warning', COMPANY: 'info' };

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, index) => currentYear - 2 + index);

const EMPTY = { name: '', date: '', type: 'PUBLIC', description: '', isOptional: false };

/**
 * The holiday calendar behind /attendance/holidays.
 *
 * Attendance grading reads these rows -- a day listed here is graded HO rather
 * than absent -- so the calendar is direct input to the whole attendance
 * module, which is why it is managed rather than merely displayed.
 *
 * A withdrawn holiday is deactivated, never deleted: past attendance was
 * computed against it, and removing the row would make those days
 * unexplainable. The status filter is what makes a withdrawn one recoverable.
 */
const HolidayCalendarPage = () => {
  const { can } = usePermissions();

  const canCreate = can(RESOURCES.ATTENDANCE, ACTIONS.CREATE);
  const canUpdate = can(RESOURCES.ATTENDANCE, ACTIONS.UPDATE);
  const canDelete = can(RESOURCES.ATTENDANCE, ACTIONS.DELETE);

  const [year, setYear] = useState(currentYear);
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [sortBy, setSortBy] = useState('date');
  const [sortOrder, setSortOrder] = useState('asc');

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [form, setForm] = useState(undefined); // undefined = closed, object = open
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [detail, setDetail] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);

    attendanceService
      .holidays(year, status)
      .then((response) => setRows(response.data ?? []))
      .catch((rejection) => {
        setRows([]);
        setError(rejection?.message ?? 'Could not load the calendar');
      })
      .finally(() => setLoading(false));
  }, [year, status]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Filtered and sorted in the browser.
   *
   * The endpoint returns one year at a time -- a few dozen rows -- so a round
   * trip per keystroke would cost more than it saves, and there is no server
   * search parameter to defer to.
   */
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();

    const filtered = rows.filter((row) => {
      if (typeFilter && row.type !== typeFilter) return false;
      if (!needle) return true;
      return [row.name, row.description].filter(Boolean).some((field) => field.toLowerCase().includes(needle));
    });

    const direction = sortOrder === 'desc' ? -1 : 1;

    return [...filtered].sort((a, b) => {
      const left = sortBy === 'date' ? new Date(a.date).getTime() : String(a[sortBy] ?? '');
      const right = sortBy === 'date' ? new Date(b.date).getTime() : String(b[sortBy] ?? '');

      if (left < right) return -1 * direction;
      if (left > right) return 1 * direction;
      return 0;
    });
  }, [rows, search, typeFilter, sortBy, sortOrder]);

  const toggleSort = (field) => {
    if (sortBy !== field) {
      setSortBy(field);
      setSortOrder('asc');
      return;
    }
    setSortOrder((previous) => (previous === 'asc' ? 'desc' : 'asc'));
  };

  const set = (field) => (event) =>
    setForm((previous) => ({
      ...previous,
      [field]: event.target.type === 'checkbox' ? event.target.checked : event.target.value,
    }));

  const handleSave = async () => {
    setSaving(true);

    const payload = {
      name: form.name.trim(),
      date: form.date,
      type: form.type,
      description: form.description.trim() || null,
      isOptional: form.type === 'RESTRICTED' ? true : form.isOptional,
    };

    try {
      if (editingId) await attendanceService.updateHoliday(editingId, payload);
      else await attendanceService.createHoliday(payload);

      setNotice({ severity: 'success', message: editingId ? 'Holiday updated' : 'Holiday added' });
      setForm(undefined);
      setEditingId(null);
      load();
    } catch (rejection) {
      setNotice({ severity: 'error', message: rejection?.message ?? 'The holiday could not be saved' });
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (row) => {
    try {
      await attendanceService.setHolidayStatus(getRowId(row), !row.isActive);
      setNotice({
        severity: 'success',
        message: `${row.name} ${row.isActive ? 'withdrawn' : 'restored'}`,
      });
      load();
    } catch (rejection) {
      setNotice({ severity: 'error', message: rejection?.message ?? 'The status could not be changed' });
    }
  };

  const handleDelete = async () => {
    const target = pendingDelete;
    setPendingDelete(null);

    try {
      await attendanceService.deleteHoliday(getRowId(target));
      setNotice({ severity: 'success', message: `${target.name} withdrawn` });
      load();
    } catch (rejection) {
      setNotice({ severity: 'error', message: rejection?.message ?? 'Could not withdraw the holiday' });
    }
  };

  const openEdit = (row) => {
    setEditingId(getRowId(row));
    setForm({
      name: row.name ?? '',
      date: row.date ? new Date(row.date).toISOString().slice(0, 10) : '',
      type: row.type ?? 'PUBLIC',
      description: row.description ?? '',
      isOptional: Boolean(row.isOptional),
    });
  };

  const columns = [
    {
      key: 'date',
      label: 'Date',
      width: 150,
      sortable: true,
      exportValue: (row) => formatDate(row.date),
      render: (row) => (
        <Typography variant="body2" color={row.isActive ? 'text.primary' : 'text.disabled'}>
          {formatDate(row.date)}
        </Typography>
      ),
    },
    {
      key: 'day',
      label: 'Day',
      width: 110,
      exportValue: (row) => new Date(row.date).toLocaleDateString([], { weekday: 'long' }),
      render: (row) => (
        <Typography variant="caption" color="text.secondary">
          {new Date(row.date).toLocaleDateString([], { weekday: 'long' })}
        </Typography>
      ),
    },
    {
      key: 'name',
      label: 'Holiday',
      sortable: true,
      exportValue: (row) => row.name,
      render: (row) => (
        <Typography variant="body2" fontWeight={500} color={row.isActive ? 'text.primary' : 'text.disabled'}>
          {row.name}
        </Typography>
      ),
    },
    {
      key: 'type',
      label: 'Type',
      sortable: true,
      exportValue: (row) => humanize(row.type),
      render: (row) => (
        <Chip label={humanize(row.type)} size="small" color={TYPE_COLOR[row.type] ?? 'default'} variant="outlined" />
      ),
    },
    {
      key: 'isOptional',
      label: 'Elective',
      exportValue: (row) => (row.isOptional ? 'Yes' : 'No'),
      render: (row) => (row.isOptional ? <Chip label="Optional" size="small" variant="outlined" /> : '—'),
    },
    {
      key: 'description',
      label: 'Note',
      exportValue: (row) => row.description,
      render: (row) => (
        <Typography variant="caption" color="text.secondary">
          {row.description || '—'}
        </Typography>
      ),
    },
    {
      key: 'isActive',
      label: 'Status',
      width: 130,
      exportValue: (row) => (row.isActive ? 'Active' : 'Withdrawn'),
      render: (row) => (
        <Stack direction="row" spacing={0.5} alignItems="center" onClick={(event) => event.stopPropagation()}>
          <Switch
            size="small"
            checked={Boolean(row.isActive)}
            disabled={!canUpdate}
            onChange={() => toggleStatus(row)}
            inputProps={{ 'aria-label': `Toggle ${row.name}` }}
          />
          <Typography variant="caption" color={row.isActive ? 'success.main' : 'text.disabled'}>
            {row.isActive ? 'Active' : 'Withdrawn'}
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
            <IconButton size="small" onClick={() => setDetail(row)}>
              <ViewIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          {canUpdate && (
            <Tooltip title="Edit">
              <IconButton size="small" onClick={() => openEdit(row)}>
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}

          {canDelete && row.isActive && (
            <Tooltip title="Withdraw">
              <IconButton size="small" color="error" onClick={() => setPendingDelete(row)}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Stack>
      ),
    },
  ];

  const hasFilters = Boolean(search) || Boolean(typeFilter) || status !== 'all';

  return (
    <Box>
      <PageHeader
        title="Holiday Calendar"
        subtitle="Days attendance is graded as a holiday rather than an absence"
        breadcrumbs={[
          { label: 'Home', to: PATHS.dashboard },
          { label: 'Organization' },
          { label: 'Holiday Calendar' },
        ]}
        actions={
          <Stack direction="row" spacing={1} data-print="hide">
            <ExportMenu
              columns={columns}
              rows={visible}
              filename={`holidays-${year}`}
              totalCount={visible.length}
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
                Add holiday
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
          placeholder="Search holiday or note"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
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

        <TextField
          select
          size="small"
          label="Year"
          value={year}
          onChange={(event) => setYear(Number(event.target.value))}
          sx={{ width: 120 }}
        >
          {YEARS.map((option) => (
            <MenuItem key={option} value={option}>
              {option}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          select
          size="small"
          label="Type"
          value={typeFilter}
          onChange={(event) => setTypeFilter(event.target.value)}
          sx={{ width: 160 }}
        >
          <MenuItem value="">All types</MenuItem>
          {TYPES.map((type) => (
            <MenuItem key={type} value={type}>
              {humanize(type)}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          select
          size="small"
          label="Status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          sx={{ width: 160 }}
        >
          <MenuItem value="all">All</MenuItem>
          <MenuItem value="active">Active only</MenuItem>
          <MenuItem value="inactive">Withdrawn only</MenuItem>
        </TextField>

        {hasFilters && (
          <Button
            size="small"
            color="inherit"
            startIcon={<ClearIcon />}
            onClick={() => {
              setSearch('');
              setTypeFilter('');
              setStatus('all');
            }}
          >
            Clear
          </Button>
        )}

        <Chip
          label={`${visible.length} holiday${visible.length === 1 ? '' : 's'}`}
          size="small"
          variant="outlined"
          sx={{ alignSelf: 'center' }}
        />
      </Stack>

      <DataTable
        columns={columns}
        rows={visible}
        loading={loading}
        error={error}
        onRetry={load}
        sortBy={sortBy}
        sortOrder={sortOrder}
        onSort={toggleSort}
        onRowClick={(row) => setDetail(row)}
        emptyTitle={hasFilters ? 'No holidays match' : `No holidays recorded for ${year}`}
        emptyMessage={
          hasFilters
            ? 'Try clearing a filter, or choose another year.'
            : canCreate
              ? 'Add the days this organisation treats as holidays.'
              : null
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
              Add holiday
            </Button>
          ) : null
        }
      />

      <FormDialog
        open={form !== undefined}
        title={editingId ? 'Edit holiday' : 'Add holiday'}
        subtitle={editingId ? undefined : 'A day the whole organisation, or part of it, does not work'}
        submitting={saving}
        submitLabel={editingId ? 'Save changes' : 'Add holiday'}
        disabled={!form?.name?.trim() || !form?.date}
        onSubmit={handleSave}
        onClose={() => {
          setForm(undefined);
          setEditingId(null);
        }}
      >
        <Grid container spacing={2} sx={{ pt: 0.5 }}>
          <Grid size={{ xs: 12, sm: 7 }}>
            <TextField label="Name" value={form?.name ?? ''} onChange={set('name')} fullWidth required autoFocus />
          </Grid>

          <Grid size={{ xs: 12, sm: 5 }}>
            <TextField
              label="Date"
              type="date"
              value={form?.date ?? ''}
              onChange={set('date')}
              fullWidth
              required
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Grid>

          <Grid size={{ xs: 12, sm: 5 }}>
            <TextField select label="Type" value={form?.type ?? 'PUBLIC'} onChange={set('type')} fullWidth>
              {TYPES.map((option) => (
                <MenuItem key={option} value={option}>
                  {humanize(option)}
                </MenuItem>
              ))}
            </TextField>
          </Grid>

          <Grid size={{ xs: 12, sm: 7 }}>
            <FormControlLabel
              control={
                <Switch
                  checked={form?.type === 'RESTRICTED' ? true : Boolean(form?.isOptional)}
                  onChange={set('isOptional')}
                  // A restricted holiday is elective by definition; the toggle
                  // would only offer a contradiction.
                  disabled={form?.type === 'RESTRICTED'}
                />
              }
              label="Employees opt in"
              sx={{ mt: 1 }}
            />
          </Grid>

          <Grid size={12}>
            <TextField
              label="Note"
              value={form?.description ?? ''}
              onChange={set('description')}
              fullWidth
              multiline
              rows={2}
            />
          </Grid>
        </Grid>
      </FormDialog>

      <HolidayDetailDialog holiday={detail} onClose={() => setDetail(null)} />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Withdraw holiday?"
        message={`${pendingDelete?.name ?? ''} will no longer be treated as a holiday when attendance is graded. It is kept, not deleted, because past attendance was calculated against it — you can restore it from the status filter.`}
        confirmLabel="Withdraw"
        confirmColor="error"
        onConfirm={handleDelete}
        onClose={() => setPendingDelete(null)}
      />
    </Box>
  );
};

/** Details and audit trail for one holiday, without leaving the calendar. */
const HolidayDetailDialog = ({ holiday, onClose }) => {
  const [tab, setTab] = useState(0);
  const [audit, setAudit] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!holiday || tab !== 1) return;

    setLoading(true);

    attendanceService
      .holidayAudit(getRowId(holiday), { page: 1, limit: 50 })
      .then((response) => setAudit(response.data ?? []))
      .catch(() => setAudit([]))
      .finally(() => setLoading(false));
  }, [holiday, tab]);

  useEffect(() => {
    if (holiday) {
      setTab(0);
      setAudit([]);
    }
  }, [holiday]);

  if (!holiday) return null;

  const line = (label, value) => (
    <Stack direction="row" justifyContent="space-between" sx={{ py: 0.75 }} spacing={2}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" fontWeight={500} align="right">
        {value}
      </Typography>
    </Stack>
  );

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{holiday.name}</DialogTitle>

      <DialogContent dividers>
        <Tabs value={tab} onChange={(_event, next) => setTab(next)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
          <Tab label="Details" />
          <Tab label="Audit trail" />
        </Tabs>

        {tab === 0 ? (
          <Box>
            {line('Date', formatDate(holiday.date))}
            {line('Day', new Date(holiday.date).toLocaleDateString([], { weekday: 'long' }))}
            {line('Type', humanize(holiday.type))}
            {line('Elective', holiday.isOptional ? 'Yes — employees opt in' : 'No')}
            {line('Status', holiday.isActive ? 'Active' : 'Withdrawn')}
            {line('Note', holiday.description || '—')}
            {line(
              'Applies to',
              holiday.departmentIds?.length || holiday.locations?.length
                ? [
                    holiday.departmentIds?.length ? `${holiday.departmentIds.length} department(s)` : null,
                    holiday.locations?.length ? holiday.locations.join(', ') : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : 'Everyone',
            )}
          </Box>
        ) : (
          <AuditTrail entries={audit} loading={loading} />
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} color="inherit">
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default HolidayCalendarPage;
