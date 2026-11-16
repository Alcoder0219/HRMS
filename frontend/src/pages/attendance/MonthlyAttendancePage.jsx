import { useCallback, useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import DownloadIcon from '@mui/icons-material/FileDownloadOutlined';
import EditIcon from '@mui/icons-material/EditOutlined';

import PageHeader from '@components/common/PageHeader.jsx';
import EditAttendanceDialog from './components/EditAttendanceDialog.jsx';
import { OVERTIME_FILTERS, toHoursMinutes } from './attendanceConstants.js';
import { useAppDispatch, useAppSelector } from '@hooks/useRedux.js';
import usePermissions from '@hooks/usePermissions.js';
import { RESOURCES, ACTIONS } from '@utils/permissions.js';
import { fetchMonthlyRegister, selectAttendance } from '@redux/slices/attendanceSlice.js';
import { fetchMasters, selectMasters } from '@redux/slices/employeeSlice.js';
import attendanceService from '@services/modules/attendance.service.js';
import { downloadBlob } from '@services/modules/employee.service.js';
import { getRowId, employeeIdentifiers } from '@utils/dataGrid.js';
import { PATHS } from '@routes/paths.js';

/** Cell colour by status code. Present is deliberately the quietest. */
const CODE_STYLE = {
  P: { bg: 'success.light', fg: 'success.contrastText' },
  H: { bg: 'warning.light', fg: 'warning.contrastText' },
  A: { bg: 'error.light', fg: 'error.contrastText' },
  L: { bg: 'info.light', fg: 'info.contrastText' },
  HO: { bg: 'action.selected', fg: 'text.secondary' },
  WO: { bg: 'action.hover', fg: 'text.secondary' },
  MP: { bg: 'error.light', fg: 'error.contrastText' },
  OD: { bg: 'primary.light', fg: 'primary.contrastText' },
  WFH: { bg: 'primary.light', fg: 'primary.contrastText' },
};

/** Employees per page; the first is the default. */
const PAGE_SIZES = [25, 50, 100];

const MONTHS = Array.from({ length: 12 }, (_, index) => ({
  value: index + 1,
  label: new Date(2000, index).toLocaleString([], { month: 'long' }),
}));

const MonthlyAttendancePage = () => {
  const dispatch = useAppDispatch();
  const { can } = usePermissions();
  const { register } = useAppSelector(selectAttendance);
  const masters = useAppSelector(selectMasters);

  const now = new Date();
  const [params, setParams] = useState({
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    departmentId: '',
  });
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState(null);

  // Shift and overtime filters. They are applied by the server with the page,
  // so the counts and pages always describe the filtered set.
  const [filters, setFilters] = useState({ overtime: '', minOvertimeMinutes: '', shiftId: '' });
  const [editing, setEditing] = useState(null);

  // Pagination: employees per page, and which page. Every filter change, and a
  // new page size, goes back to page 1.
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(PAGE_SIZES[0]);

  const setFilter = (field) => (event) => {
    setFilters((prev) => ({ ...prev, [field]: event.target.value }));
    setPage(1);
  };

  // Typing a minimum is debounced, so one request follows the number rather
  // than one per keystroke.
  const [minOvertime, setMinOvertime] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setMinOvertime(filters.minOvertimeMinutes), 400);
    return () => clearTimeout(timer);
  }, [filters.minOvertimeMinutes]);

  /** Everything the page asks the server for: the month, the filters, the page. */
  const query = useMemo(() => {
    const minimum = Number(minOvertime) || 0;
    return {
      ...params,
      shiftId: filters.shiftId,
      ...(filters.overtime === 'with' ? { hasOvertime: true } : {}),
      ...(filters.overtime === 'without' ? { hasOvertime: false } : {}),
      // Overtime is whole minutes, so "at least 30.5" is "at least 31".
      ...(minimum > 0 ? { minOvertimeMinutes: Math.ceil(minimum) } : {}),
      page,
      limit,
    };
  }, [params, filters.shiftId, filters.overtime, minOvertime, page, limit]);

  const reload = useCallback(
    () =>
      dispatch(fetchMonthlyRegister(query))
        .unwrap()
        .catch((rejection) => setError(rejection?.message ?? 'Could not reload the register')),
    [dispatch, query],
  );

  useEffect(() => {
    dispatch(fetchMasters());
  }, [dispatch]);

  useEffect(() => {
    setLoading(true);
    setError(null);

    // A newer selection supersedes this one: its response is dropped rather
    // than painted over the page the user has moved on to.
    const request = dispatch(fetchMonthlyRegister(query));
    let current = true;

    request
      .unwrap()
      .catch((rejection) => {
        if (current && rejection?.name !== 'AbortError') setError(rejection?.message ?? 'Could not load the register');
      })
      .finally(() => {
        if (current) setLoading(false);
      });

    return () => {
      current = false;
      request.abort();
    };
  }, [dispatch, query]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const blob = await attendanceService.exportMonthly(params);
      downloadBlob(blob, `attendance-${params.year}-${String(params.month).padStart(2, '0')}.xlsx`);
    } catch (rejection) {
      setError(rejection?.message ?? 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const set = (field) => (event) => {
    setParams((prev) => ({ ...prev, [field]: event.target.value }));
    setPage(1);
  };

  const holidayDays = new Set((register?.holidays ?? []).map((holiday) => holiday.day));

  // Editing a day is a correction to attendance, so it needs the same right
  // the manual-marking endpoint demands. The API re-checks it regardless.
  const canEdit = can(RESOURCES.ATTENDANCE, ACTIONS.UPDATE);

  /**
   * The rows of this page.
   *
   * The server already applied the shift and overtime filters before choosing
   * the page; the same rule is applied again here, which changes nothing then,
   * and keeps the filters working against a server that does not page yet.
   */
  const visibleRows = useMemo(() => {
    const minimum = Number(filters.minOvertimeMinutes) || 0;

    return (register?.employees ?? []).filter((row) => {
      const overtime = row.totals?.overtimeMinutes ?? 0;

      if (filters.overtime === 'with' && overtime <= 0) return false;
      if (filters.overtime === 'without' && overtime > 0) return false;
      if (minimum > 0 && overtime < minimum) return false;
      if (filters.shiftId && row.employee?.shiftId !== filters.shiftId) return false;

      return true;
    });
  }, [register, filters]);

  const pagination = register?.pagination ?? null;

  // Across every matching employee, not just this page -- as before paging.
  const overtimeTotal = useMemo(
    () => pagination?.overtimeTotal ?? visibleRows.reduce((sum, row) => sum + (row.totals?.overtimeMinutes ?? 0), 0),
    [pagination, visibleRows],
  );

  const totalEmployees = pagination?.total ?? visibleRows.length;
  const currentPage = pagination?.page ?? 1;
  const totalPages = pagination?.totalPages ?? 1;
  const firstShown = totalEmployees ? (currentPage - 1) * (pagination?.limit ?? limit) + 1 : 0;
  const lastShown = totalEmployees ? firstShown + visibleRows.length - 1 : 0;

  return (
    <Box>
      <PageHeader
        title="Monthly attendance"
        subtitle="Every employee, every day — the sheet payroll works from"
        breadcrumbs={[
          { label: 'Home', to: PATHS.dashboard },
          { label: 'Attendance', to: PATHS.attendance },
          { label: 'Monthly' },
        ]}
        actions={
          can(RESOURCES.ATTENDANCE, ACTIONS.EXPORT) && (
            <Button
              variant="outlined"
              color="inherit"
              startIcon={<DownloadIcon />}
              onClick={handleExport}
              disabled={exporting}
            >
              {exporting ? 'Exporting…' : 'Export'}
            </Button>
          )
        }
      />

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
        <TextField select label="Month" value={params.month} onChange={set('month')} sx={{ maxWidth: 180 }}>
          {MONTHS.map((month) => (
            <MenuItem key={month.value} value={month.value}>
              {month.label}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          select
          label="Year"
          value={params.year}
          onChange={set('year')}
          sx={{ maxWidth: 130 }}
        >
          {[now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2].map((year) => (
            <MenuItem key={year} value={year}>
              {year}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          select
          label="Department"
          value={params.departmentId}
          onChange={set('departmentId')}
          sx={{ maxWidth: 240 }}
        >
          <MenuItem value="">All departments</MenuItem>
          {masters.departments.map((department) => (
            <MenuItem key={department._id} value={department._id}>
              {department.name}
            </MenuItem>
          ))}
        </TextField>

        {/* These three narrow the rows already loaded, so they apply instantly
            and never refetch the month. */}
        <TextField select label="Shift" value={filters.shiftId} onChange={setFilter('shiftId')} sx={{ maxWidth: 200 }}>
          <MenuItem value="">All shifts</MenuItem>
          {(masters.shifts ?? []).map((shift) => (
            <MenuItem key={shift._id} value={shift._id}>
              {shift.name}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          select
          label="Overtime"
          value={filters.overtime}
          onChange={setFilter('overtime')}
          sx={{ maxWidth: 190 }}
        >
          {OVERTIME_FILTERS.map((option) => (
            <MenuItem key={option.value} value={option.value}>
              {option.label}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          type="number"
          label="Minimum OT (minutes)"
          value={filters.minOvertimeMinutes}
          onChange={setFilter('minOvertimeMinutes')}
          sx={{ maxWidth: 190 }}
          slotProps={{ htmlInput: { min: 0, step: 15 } }}
        />
      </Stack>

      {/* The month's overtime across whatever the filters left showing. */}
      <Stack direction="row" spacing={1} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap alignItems="center">
        <Chip size="small" label={`${totalEmployees} employee(s)`} variant="outlined" />
        <Chip
          size="small"
          color={overtimeTotal > 0 ? 'success' : 'default'}
          label={`Total overtime ${toHoursMinutes(overtimeTotal)}`}
        />
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Legend earns its place: the matrix is unreadable without it. */}
      <Stack direction="row" spacing={1.5} sx={{ mb: 2, flexWrap: 'wrap', gap: 1 }}>
        {Object.entries(register?.legend ?? {}).map(([status, code]) => (
          <Stack key={status} direction="row" spacing={0.5} alignItems="center">
            <Box
              sx={{
                width: 18,
                height: 18,
                borderRadius: 0.5,
                bgcolor: CODE_STYLE[code]?.bg ?? 'action.hover',
                border: 1,
                borderColor: 'divider',
              }}
            />
            <Typography variant="caption" color="text.secondary">
              {code} · {status.replace(/_/g, ' ').toLowerCase()}
            </Typography>
          </Stack>
        ))}
      </Stack>

      <Paper variant="outlined" sx={{ position: 'relative' }}>
        {loading && (
          <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', zIndex: 2, bgcolor: 'background.paper', opacity: 0.7 }}>
            <CircularProgress />
          </Box>
        )}

        {/* Horizontal scroll is contained here so the page body never scrolls
            sideways -- a 31-column matrix will always be wider than a laptop. */}
        <Box sx={{ overflowX: 'auto' }}>
          <Box component="table" sx={{ borderCollapse: 'separate', borderSpacing: 0, minWidth: 900 }}>
            <Box component="thead">
              <Box component="tr">
                <Box
                  component="th"
                  sx={{
                    position: 'sticky',
                    left: 0,
                    zIndex: 1,
                    bgcolor: 'background.default',
                    borderBottom: 1,
                    borderRight: 1,
                    borderColor: 'divider',
                    p: 1.25,
                    textAlign: 'left',
                    minWidth: 220,
                  }}
                >
                  <Typography variant="caption" fontWeight={700}>
                    Employee
                  </Typography>
                </Box>

                {Array.from({ length: register?.daysInMonth ?? 0 }, (_, index) => index + 1).map((dayNumber) => (
                  <Box
                    component="th"
                    key={dayNumber}
                    sx={{
                      p: 0.5,
                      width: 30,
                      borderBottom: 1,
                      borderColor: 'divider',
                      bgcolor: holidayDays.has(dayNumber) ? 'action.selected' : 'background.default',
                    }}
                  >
                    <Typography variant="caption" fontWeight={600}>
                      {dayNumber}
                    </Typography>
                  </Box>
                ))}

                {/* OT sits after Pay; Action closes the row. */}
                {['P', 'A', 'Pay', 'OT'].map((label) => (
                  <Box
                    component="th"
                    key={label}
                    sx={{
                      p: 1,
                      borderBottom: 1,
                      borderLeft: 1,
                      borderColor: 'divider',
                      bgcolor: 'background.default',
                      minWidth: label === 'OT' ? 68 : 54,
                    }}
                  >
                    <Typography variant="caption" fontWeight={700}>
                      {label}
                    </Typography>
                  </Box>
                ))}

                {canEdit && (
                  <Box
                    component="th"
                    sx={{ p: 1, borderBottom: 1, borderLeft: 1, borderColor: 'divider', bgcolor: 'background.default', minWidth: 72 }}
                  >
                    <Typography variant="caption" fontWeight={700}>
                      Action
                    </Typography>
                  </Box>
                )}
              </Box>
            </Box>

            <Box component="tbody">
              {/* This report returns a server-built DTO that already exposes
                  `id`; keys resolve through the shared rule anyway, so the
                  table holds if that shape ever changes. */}
              {visibleRows.map((row) => (
                <Box component="tr" key={getRowId(row.employee)}>
                  <Box
                    component="td"
                    sx={{
                      position: 'sticky',
                      left: 0,
                      zIndex: 1,
                      bgcolor: 'background.paper',
                      borderBottom: 1,
                      borderRight: 1,
                      borderColor: 'divider',
                      p: 1.25,
                    }}
                  >
                    <Typography variant="body2" fontWeight={500} noWrap>
                      {row.employee.fullName}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {employeeIdentifiers(row.employee)}
                      {row.employee.department ? ` · ${row.employee.department}` : ''}
                    </Typography>
                  </Box>

                  {row.days.map((day) => {
                    const style = CODE_STYLE[day.code];
                    return (
                      <Tooltip
                        key={day.day}
                        title={
                          day.status
                            ? `${day.status}${day.lateMinutes ? ` · late ${day.lateMinutes}m` : ''}${
                                day.isRegularized ? ' · regularized' : ''
                              }`
                            : 'No record'
                        }
                      >
                        <Box
                          component="td"
                          sx={{
                            p: 0,
                            textAlign: 'center',
                            borderBottom: 1,
                            borderColor: 'divider',
                            bgcolor: style?.bg ?? 'transparent',
                            color: style?.fg ?? 'text.disabled',
                            fontSize: 10,
                            fontWeight: 600,
                            height: 34,
                          }}
                        >
                          {day.code}
                        </Box>
                      </Tooltip>
                    );
                  })}

                  {[row.totals.present, row.totals.absent, row.totals.payableDays].map((value, index) => (
                    <Box
                      component="td"
                      key={index}
                      sx={{ p: 1, textAlign: 'center', borderBottom: 1, borderLeft: 1, borderColor: 'divider' }}
                    >
                      <Typography variant="caption" fontWeight={600}>
                        {value}
                      </Typography>
                    </Box>
                  ))}

                  {/*
                    Overtime as hours:minutes. A zero is greyed rather than
                    hidden, and an employee who is not on an overtime contract
                    says so on hover -- otherwise 00:00 is ambiguous between
                    "worked none" and "cannot earn any".
                  */}
                  <Box
                    component="td"
                    sx={{ p: 1, textAlign: 'center', borderBottom: 1, borderLeft: 1, borderColor: 'divider' }}
                  >
                    <Tooltip
                      title={
                        row.employee.overtimeEligible === false
                          ? 'Not eligible for overtime'
                          : `${toHoursMinutes(row.totals.workedMinutes)} worked this month`
                      }
                    >
                      <Typography
                        variant="caption"
                        fontWeight={600}
                        color={row.totals.overtimeMinutes > 0 ? 'success.main' : 'text.disabled'}
                      >
                        {toHoursMinutes(row.totals.overtimeMinutes)}
                      </Typography>
                    </Tooltip>
                  </Box>

                  {canEdit && (
                    <Box
                      component="td"
                      sx={{ p: 0.5, textAlign: 'center', borderBottom: 1, borderLeft: 1, borderColor: 'divider' }}
                    >
                      <Tooltip title="Edit attendance">
                        <IconButton size="small" onClick={() => setEditing(row.employee)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  )}
                </Box>
              ))}
            </Box>
          </Box>
        </Box>

        {visibleRows.length === 0 && !loading && (
          <Box sx={{ p: 4, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              No employees match this selection.
            </Typography>
          </Box>
        )}

        {/* Pagination: page size, where you are, and previous / next. */}
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.5}
          alignItems={{ xs: 'flex-start', sm: 'center' }}
          justifyContent="space-between"
          sx={{ px: 2, py: 1.25, borderTop: 1, borderColor: 'divider' }}
        >
          <Typography variant="body2" color="text.secondary">
            {totalEmployees
              ? `Showing ${firstShown}–${lastShown} of ${totalEmployees} employee${totalEmployees === 1 ? '' : 's'}`
              : 'No employees'}
          </Typography>

          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
            <TextField
              select
              size="small"
              label="Per page"
              value={limit}
              onChange={(event) => {
                setLimit(Number(event.target.value));
                setPage(1);
              }}
              sx={{ width: 110 }}
            >
              {PAGE_SIZES.map((size) => (
                <MenuItem key={size} value={size}>
                  {size}
                </MenuItem>
              ))}
            </TextField>

            <Typography variant="body2" color="text.secondary">
              Page {currentPage} of {totalPages}
            </Typography>

            <Button
              size="small"
              variant="outlined"
              color="inherit"
              onClick={() => setPage(currentPage - 1)}
              disabled={loading || currentPage <= 1}
            >
              Previous
            </Button>
            <Button
              size="small"
              variant="outlined"
              color="inherit"
              onClick={() => setPage(currentPage + 1)}
              disabled={loading || currentPage >= totalPages}
            >
              Next
            </Button>
          </Stack>
        </Stack>
      </Paper>

      {/* Reloads the register on save, so the row's P, A, Pay and OT reflect
          the correction without a page refresh. */}
      <EditAttendanceDialog
        open={Boolean(editing)}
        employee={editing}
        year={params.year}
        month={params.month}
        onClose={() => setEditing(null)}
        onSaved={reload}
      />
    </Box>
  );
};

export default MonthlyAttendancePage;
