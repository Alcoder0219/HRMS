import { useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Tooltip from '@mui/material/Tooltip';
import WarningIcon from '@mui/icons-material/WarningAmberOutlined';
import AddIcon from '@mui/icons-material/AddOutlined';
import UploadIcon from '@mui/icons-material/UploadFileOutlined';
import LockIcon from '@mui/icons-material/LockClockOutlined';
import { DataGrid } from '@mui/x-data-grid';

import PageHeader from '@components/common/PageHeader.jsx';
import AttendanceStatusChip from '@components/common/AttendanceStatusChip.jsx';
import MarkAttendanceDialog from './components/MarkAttendanceDialog.jsx';
import AttendanceImportDialog from './components/AttendanceImportDialog.jsx';
import LockPeriodDialog from './components/LockPeriodDialog.jsx';

import { useAppDispatch, useAppSelector } from '@hooks/useRedux.js';
import usePermissions from '@hooks/usePermissions.js';
import { RESOURCES, ACTIONS } from '@utils/permissions.js';
import {
  fetchRegister,
  fetchDailySummary,
  setPage,
  setLimit,
  setSort,
  setFilters,
  selectAttendance,
} from '@redux/slices/attendanceSlice.js';
import { formatDate } from '@utils/format.js';
import { formatAttendanceTime, toAttendanceClock } from '@utils/attendanceTime.js';
import { getRowId, displayName, toSortParams, employeeIdentifiers } from '@utils/dataGrid.js';
import { PATHS } from '@routes/paths.js';

const STATUSES = [
  'PRESENT',
  'HALF_DAY',
  'ABSENT',
  'MISSING_PUNCH',
  'ON_LEAVE',
  'HOLIDAY',
  'WEEKLY_OFF',
  'ON_DUTY',
  'WORK_FROM_HOME',
];

const timeOf = formatAttendanceTime;

const minutesToHours = (minutes) =>
  !minutes ? '—' : `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;

const AttendanceRegisterPage = () => {
  const dispatch = useAppDispatch();
  const { can } = usePermissions();
  const { items, total, page, limit, sortBy, sortOrder, filters, summary, status, error } =
    useAppSelector(selectAttendance);

  const [markOpen, setMarkOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [lockOpen, setLockOpen] = useState(false);
  const [notice, setNotice] = useState(null);

  const canMark = can(RESOURCES.ATTENDANCE, ACTIONS.APPROVE);
  const canImport = can(RESOURCES.ATTENDANCE, ACTIONS.CREATE);

  useEffect(() => {
    dispatch(fetchRegister());
  }, [dispatch, page, limit, sortBy, sortOrder, filters]);

  useEffect(() => {
    dispatch(fetchDailySummary(filters.from));
  }, [dispatch, filters.from]);

  const columns = useMemo(
    () => [
      {
        field: 'date',
        headerName: 'Date',
        width: 120,
        valueFormatter: (value) => formatDate(toAttendanceClock(value)),
      },
      {
        field: 'employeeId',
        headerName: 'Employee',
        flex: 1.3,
        minWidth: 220,
        sortable: false,
        renderCell: ({ row }) => (
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" fontWeight={500} noWrap>
              {/* Populated sub-document; `fullName` is a virtual it never carries. */}
              {row.employeeId ? displayName(row.employeeId) : '—'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {employeeIdentifiers(row.employeeId)}
            </Typography>
          </Box>
        ),
      },
      {
        field: 'department',
        headerName: 'Department',
        flex: 1,
        minWidth: 140,
        sortable: false,
        valueGetter: (_value, row) => row.employeeId?.departmentId?.name ?? '—',
      },
      { field: 'checkInAt', headerName: 'In', width: 90, valueFormatter: (value) => timeOf(value) },
      {
        field: 'checkOutAt',
        headerName: 'Out',
        width: 90,
        // Not in the API's sort allowlist, so offering it would only produce
        // a 422. Sorting by check-in orders the same day identically.
        sortable: false,
        valueFormatter: (value) => timeOf(value),
      },
      {
        field: 'workedMinutes',
        headerName: 'Worked',
        width: 110,
        valueFormatter: (value) => minutesToHours(value),
      },
      {
        field: 'lateMinutes',
        headerName: 'Late',
        width: 90,
        renderCell: ({ value }) =>
          value > 0 ? (
            <Typography variant="body2" color="warning.main">
              {value}m
            </Typography>
          ) : (
            '—'
          ),
      },
      {
        field: 'overtimeMinutes',
        headerName: 'OT',
        width: 90,
        renderCell: ({ value }) =>
          value > 0 ? (
            <Typography variant="body2" color="success.main">
              {minutesToHours(value)}
            </Typography>
          ) : (
            '—'
          ),
      },
      {
        field: 'status',
        headerName: 'Status',
        width: 150,
        renderCell: ({ row }) => (
          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ height: '100%' }}>
            <AttendanceStatusChip status={row.status} />
            {row.anomalies?.length > 0 && (
              <Tooltip title={row.anomalies.join(', ')}>
                <WarningIcon fontSize="small" color="error" />
              </Tooltip>
            )}
          </Stack>
        ),
      },
    ],
    [],
  );

  const tiles = [
    { key: 'total', label: 'Records', color: 'text.primary' },
    { key: 'PRESENT', label: 'Present', color: 'success.main' },
    { key: 'ABSENT', label: 'Absent', color: 'error.main' },
    { key: 'MISSING_PUNCH', label: 'Missing punch', color: 'error.main' },
    { key: 'HALF_DAY', label: 'Half day', color: 'warning.main' },
  ];

  return (
    <Box>
      <PageHeader
        title="Attendance register"
        subtitle="Daily record across the organisation"
        breadcrumbs={[
          { label: 'Home', to: PATHS.dashboard },
          { label: 'Attendance', to: PATHS.attendance },
          { label: 'Register' },
        ]}
        actions={
          <>
            {canImport && (
              <Button variant="outlined" color="inherit" startIcon={<UploadIcon />} onClick={() => setImportOpen(true)}>
                Import
              </Button>
            )}
            {/* Closing a period is an approval-grade act: it decides that the
                figures payroll was paid from are final. */}
            {canMark && (
              <Button color="warning" startIcon={<LockIcon />} onClick={() => setLockOpen(true)}>
                Lock period
              </Button>
            )}
            {canMark && (
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => setMarkOpen(true)}>
                Mark attendance
              </Button>
            )}
          </>
        }
      />

      {notice && (
        <Alert severity={notice.severity} sx={{ mb: 2 }} onClose={() => setNotice(null)}>
          {notice.message}
        </Alert>
      )}

      {summary && (
        <Stack direction="row" spacing={2} sx={{ mb: 3, flexWrap: 'wrap', gap: 2 }}>
          {tiles.map(({ key, label, color }) => (
            <Card key={key} variant="outlined" sx={{ px: 2.5, py: 1.5, minWidth: 128 }}>
              <Typography variant="caption" color="text.secondary" textTransform="uppercase" letterSpacing="0.06em">
                {label}
              </Typography>
              <Typography variant="h3" color={color} sx={{ mt: 0.5 }}>
                {summary[key] ?? 0}
              </Typography>
            </Card>
          ))}
        </Stack>
      )}

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
        <TextField
          type="date"
          label="From"
          value={filters.from}
          onChange={(event) => dispatch(setFilters({ from: event.target.value }))}
          slotProps={{ inputLabel: { shrink: true } }}
          sx={{ maxWidth: 180 }}
        />
        <TextField
          type="date"
          label="To"
          value={filters.to}
          onChange={(event) => dispatch(setFilters({ to: event.target.value }))}
          slotProps={{ inputLabel: { shrink: true } }}
          sx={{ maxWidth: 180 }}
        />
        <TextField
          select
          label="Status"
          value={filters.status}
          onChange={(event) => dispatch(setFilters({ status: event.target.value }))}
          sx={{ maxWidth: 200 }}
        >
          <MenuItem value="">All</MenuItem>
          {STATUSES.map((option) => (
            <MenuItem key={option} value={option}>
              {option.replace(/_/g, ' ')}
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error.message}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
        <DataGrid
          rows={items}
          columns={columns}
          // Shared rule: Mongo keys on `_id`, and lean list rows have no `id`.
          getRowId={getRowId}
          loading={status === 'loading'}
          // Server-side: the grid states intent, the API decides. Client-side
          // paging would only ever sort the visible page.
          paginationMode="server"
          sortingMode="server"
          rowCount={total}
          paginationModel={{ page: page - 1, pageSize: limit }}
          onPaginationModelChange={(model) => {
            if (model.pageSize !== limit) dispatch(setLimit(model.pageSize));
            else dispatch(setPage(model.page + 1));
          }}
          // `sortingMode="server"` was declared without a handler, so clicking
          // a header did nothing at all. Both halves are needed.
          sortModel={[{ field: sortBy, sort: sortOrder }]}
          onSortModelChange={(model) =>
            dispatch(setSort(toSortParams(model, { sortBy: 'date', sortOrder: 'desc' })))
          }
          pageSizeOptions={[10, 25, 50, 100]}
          disableRowSelectionOnClick
          disableColumnMenu
          rowHeight={56}
          sx={{
            border: 0,
            '& .MuiDataGrid-columnHeaders': { bgcolor: 'background.default' },
            '& .MuiDataGrid-cell:focus, & .MuiDataGrid-cell:focus-within': { outline: 'none' },
          }}
          slotProps={{ loadingOverlay: { variant: 'linear-progress', noRowsVariant: 'skeleton' } }}
        />
      </Paper>

      <MarkAttendanceDialog
        open={markOpen}
        defaultDate={filters.from}
        onClose={() => setMarkOpen(false)}
        onSaved={() => {
          setMarkOpen(false);
          setNotice({ severity: 'success', message: 'Attendance recorded' });
          dispatch(fetchRegister());
          dispatch(fetchDailySummary(filters.from));
        }}
      />

      <AttendanceImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => {
          dispatch(fetchRegister());
          dispatch(fetchDailySummary(filters.from));
        }}
      />

      <LockPeriodDialog
        open={lockOpen}
        onClose={() => setLockOpen(false)}
        onLocked={(message) => {
          setLockOpen(false);
          setNotice({ severity: 'success', message });
          dispatch(fetchRegister());
        }}
      />
    </Box>
  );
};

export default AttendanceRegisterPage;
