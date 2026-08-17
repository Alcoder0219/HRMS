import { useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import LoginIcon from '@mui/icons-material/LoginOutlined';
import LogoutIcon from '@mui/icons-material/LogoutOutlined';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeftOutlined';
import ChevronRightIcon from '@mui/icons-material/ChevronRightOutlined';
import PlaceIcon from '@mui/icons-material/PlaceOutlined';

import PageHeader from '@components/common/PageHeader.jsx';
import AttendanceStatusChip from '@components/common/AttendanceStatusChip.jsx';
import { employeeIdentifiers } from '@utils/dataGrid.js';
import RegularizationDialog from './components/RegularizationDialog.jsx';

import { useAppDispatch, useAppSelector } from '@hooks/useRedux.js';
import {
  fetchToday,
  fetchCalendar,
  fetchCompOff,
  punch,
  selectAttendance,
} from '@redux/slices/attendanceSlice.js';
import { formatDate, formatDateTime } from '@utils/format.js';
import { PATHS } from '@routes/paths.js';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const minutesToHours = (minutes) =>
  !minutes ? '—' : `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;

/** Cell tint by status. Muted on purpose -- a month should read at a glance. */
const DAY_TINT = {
  PRESENT: 'success.light',
  HALF_DAY: 'warning.light',
  ABSENT: 'error.light',
  MISSING_PUNCH: 'error.light',
  ON_LEAVE: 'info.light',
  HOLIDAY: 'action.hover',
  WEEKLY_OFF: 'action.hover',
  ON_DUTY: 'primary.light',
  WORK_FROM_HOME: 'primary.light',
};

const MyAttendancePage = () => {
  const dispatch = useAppDispatch();
  const { today, calendar, compOff, punching, error } = useAppSelector(selectAttendance);

  const now = new Date();
  const [cursor, setCursor] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const [notice, setNotice] = useState(null);
  const [regularizeDate, setRegularizeDate] = useState(null);

  useEffect(() => {
    dispatch(fetchToday());
    dispatch(fetchCompOff());
  }, [dispatch]);

  useEffect(() => {
    dispatch(fetchCalendar(cursor));
  }, [dispatch, cursor]);

  const handlePunch = async () => {
    setNotice(null);
    try {
      const result = await dispatch(punch()).unwrap();
      setNotice({
        severity: 'success',
        message:
          result.direction === 'IN'
            ? `Checked in at ${formatDateTime(result.record?.checkInAt)}`
            : `Checked out at ${formatDateTime(result.record?.checkOutAt)}`,
      });
      dispatch(fetchToday());
      dispatch(fetchCalendar(cursor));
    } catch (rejection) {
      setNotice({ severity: 'error', message: rejection?.message ?? 'Punch failed' });
    }
  };

  const shiftPeriod = (delta) =>
    setCursor(({ year, month }) => {
      const next = month + delta;
      if (next < 1) return { year: year - 1, month: 12 };
      if (next > 12) return { year: year + 1, month: 1 };
      return { year, month: next };
    });

  // Leading blanks so the first day lands under its weekday column.
  const leadingBlanks = useMemo(() => {
    if (!calendar?.days?.length) return 0;
    return new Date(calendar.days[0].date).getDay();
  }, [calendar]);

  const record = today?.record;
  const summary = calendar?.summary;

  return (
    <Box>
      <PageHeader
        title="My attendance"
        subtitle={today ? `${today.employee.fullName} · ${employeeIdentifiers(today.employee)}` : ''}
        breadcrumbs={[{ label: 'Home', to: PATHS.dashboard }, { label: 'Attendance' }]}
      />

      {notice && (
        <Alert severity={notice.severity} sx={{ mb: 2 }} onClose={() => setNotice(null)}>
          {notice.message}
        </Alert>
      )}
      {error && !notice && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error.message}
        </Alert>
      )}

      <Grid container spacing={2} sx={{ mb: 3 }}>
        {/* ------------------------------------------------- punch card -- */}
        <Grid size={{ xs: 12, md: 5 }}>
          <Card variant="outlined" sx={{ height: '100%' }}>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                <Box>
                  <Typography variant="overline" color="text.secondary">
                    Today
                  </Typography>
                  <Typography variant="h4">{formatDate(new Date())}</Typography>
                </Box>
                <AttendanceStatusChip status={record?.status} />
              </Stack>

              {today?.shift && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  Shift {today.shift.name} · {today.shift.startTime}–{today.shift.endTime}
                </Typography>
              )}

              {today?.isHoliday && (
                <Alert severity="info" sx={{ mt: 2 }} variant="outlined">
                  {today.holidayName ?? 'Holiday'}
                </Alert>
              )}
              {today?.isWeeklyOff && !today?.isHoliday && (
                <Alert severity="info" sx={{ mt: 2 }} variant="outlined">
                  Weekly off — working today earns comp off
                </Alert>
              )}

              <Stack direction="row" spacing={4} sx={{ mt: 2.5 }}>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Check in
                  </Typography>
                  <Typography variant="h5">
                    {record?.checkInAt
                      ? new Date(record.checkInAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                      : '—'}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Check out
                  </Typography>
                  <Typography variant="h5">
                    {record?.checkOutAt
                      ? new Date(record.checkOutAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                      : '—'}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Worked
                  </Typography>
                  <Typography variant="h5">{minutesToHours(record?.workedMinutes)}</Typography>
                </Box>
              </Stack>

              <Button
                fullWidth
                size="large"
                variant="contained"
                color={today?.canCheckOut ? 'warning' : 'primary'}
                startIcon={today?.canCheckOut ? <LogoutIcon /> : <LoginIcon />}
                onClick={handlePunch}
                disabled={punching}
                sx={{ mt: 3 }}
              >
                {punching ? 'Recording…' : today?.canCheckOut ? 'Check out' : 'Check in'}
              </Button>

              {today?.geofenceEnabled && (
                <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 1.5 }}>
                  <PlaceIcon fontSize="small" color="action" />
                  <Typography variant="caption" color="text.secondary">
                    Location is checked against your office when you punch
                  </Typography>
                </Stack>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* ---------------------------------------------- month summary -- */}
        <Grid size={{ xs: 12, md: 7 }}>
          <Card variant="outlined" sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="overline" color="text.secondary">
                This month
              </Typography>

              <Grid container spacing={2} sx={{ mt: 0.5 }}>
                {[
                  { label: 'Present', value: summary?.present ?? 0, color: 'success.main' },
                  { label: 'Half day', value: summary?.halfDay ?? 0, color: 'warning.main' },
                  { label: 'Absent', value: summary?.absent ?? 0, color: 'error.main' },
                  { label: 'Late', value: summary?.lateCount ?? 0, color: 'warning.main' },
                  { label: 'Payable days', value: summary?.payableDays ?? 0, color: 'text.primary' },
                  { label: 'Comp off', value: compOff?.balance ?? 0, color: 'primary.main' },
                ].map((tile) => (
                  <Grid size={{ xs: 6, sm: 4 }} key={tile.label}>
                    <Typography variant="caption" color="text.secondary">
                      {tile.label}
                    </Typography>
                    <Typography variant="h3" color={tile.color}>
                      {tile.value}
                    </Typography>
                  </Grid>
                ))}
              </Grid>

              <Stack direction="row" spacing={3} sx={{ mt: 2 }}>
                <Typography variant="body2" color="text.secondary">
                  Worked {minutesToHours(summary?.totalWorkedMinutes)}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Overtime {minutesToHours(summary?.totalOvertimeMinutes)}
                </Typography>
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* ------------------------------------------------------ calendar -- */}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
          <Typography variant="h5">
            {new Date(cursor.year, cursor.month - 1).toLocaleString([], { month: 'long', year: 'numeric' })}
          </Typography>
          <Stack direction="row">
            <IconButton onClick={() => shiftPeriod(-1)} aria-label="Previous month">
              <ChevronLeftIcon />
            </IconButton>
            <IconButton
              onClick={() => shiftPeriod(1)}
              // Future months hold nothing to show.
              disabled={cursor.year === now.getFullYear() && cursor.month === now.getMonth() + 1}
              aria-label="Next month"
            >
              <ChevronRightIcon />
            </IconButton>
          </Stack>
        </Stack>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            gap: 1,
          }}
        >
          {WEEKDAYS.map((weekday) => (
            <Typography
              key={weekday}
              variant="caption"
              color="text.secondary"
              sx={{ textAlign: 'center', fontWeight: 600 }}
            >
              {weekday}
            </Typography>
          ))}

          {Array.from({ length: leadingBlanks }).map((_, index) => (
            <Box key={`blank-${index}`} />
          ))}

          {calendar?.days?.map((day) => {
            const date = new Date(day.date);
            const clickable = day.status && !['HOLIDAY', 'WEEKLY_OFF'].includes(day.status);

            return (
              <Tooltip
                key={day.date}
                title={
                  day.status
                    ? `${day.status}${day.workedMinutes ? ` · ${minutesToHours(day.workedMinutes)}` : ''}${
                        day.lateMinutes ? ` · late ${day.lateMinutes}m` : ''
                      }`
                    : 'No record'
                }
              >
                <Box
                  onClick={clickable ? () => setRegularizeDate(day.date) : undefined}
                  sx={{
                    p: 1,
                    minHeight: 62,
                    borderRadius: 1.5,
                    border: 1,
                    borderColor: 'divider',
                    bgcolor: day.status ? DAY_TINT[day.status] : 'transparent',
                    opacity: day.status ? 1 : 0.45,
                    cursor: clickable ? 'pointer' : 'default',
                    '&:hover': clickable ? { borderColor: 'primary.main' } : undefined,
                  }}
                >
                  <Typography variant="caption" fontWeight={600}>
                    {date.getDate()}
                  </Typography>
                  {day.workedMinutes > 0 && (
                    <Typography variant="caption" display="block" sx={{ fontSize: 10 }}>
                      {minutesToHours(day.workedMinutes)}
                    </Typography>
                  )}
                  {day.isRegularized && (
                    <Chip label="R" size="small" sx={{ height: 14, fontSize: 9, mt: 0.25 }} />
                  )}
                </Box>
              </Tooltip>
            );
          })}
        </Box>

        <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
          Click a working day to raise a regularization request.
        </Typography>
      </Paper>

      <RegularizationDialog
        open={Boolean(regularizeDate)}
        date={regularizeDate}
        onClose={() => setRegularizeDate(null)}
        onSubmitted={() => {
          setRegularizeDate(null);
          setNotice({ severity: 'success', message: 'Regularization submitted for approval' });
          dispatch(fetchCalendar(cursor));
        }}
      />
    </Box>
  );
};

export default MyAttendancePage;
