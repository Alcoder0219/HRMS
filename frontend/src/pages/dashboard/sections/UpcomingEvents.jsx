import { useMemo } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';

import DashboardPanel from '../components/DashboardPanel.jsx';
import useDashboardQuery from '../useDashboardQuery.js';
import attendanceService from '@services/modules/attendance.service.js';
import { formatDate, humanize } from '@utils/format.js';
import { PATHS } from '@routes/paths.js';

/**
 * What is coming: holidays from the Holiday Calendar, and approved leave
 * starting soon (from the leave section, already scoped and filtered).
 */

const DateTile = ({ date }) => {
  const value = new Date(date);
  return (
    <Box
      sx={(theme) => ({
        width: 44,
        flexShrink: 0,
        textAlign: 'center',
        borderRadius: 1.25,
        py: 0.5,
        bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.18 : 0.08),
        color: 'primary.main',
      })}
    >
      <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', lineHeight: 1.2 }}>
        {value.toLocaleDateString(['en-TZ', 'en-GB'], { month: 'short' }).toUpperCase()}
      </Typography>
      <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.1 }}>
        {value.getDate()}
      </Typography>
    </Box>
  );
};

const UpcomingEvents = ({ seesAttendance, leave = null, refreshKey }) => {
  const year = new Date().getFullYear();
  const holidays = useDashboardQuery(
    () =>
      Promise.all([attendanceService.holidays(year), attendanceService.holidays(year + 1)]).then(([current, next]) => [
        ...(current.data ?? []),
        ...(next.data ?? []),
      ]),
    [year, refreshKey],
    { enabled: seesAttendance },
  );

  const upcoming = useMemo(() => {
    const today = new Date(new Date().toDateString());
    return (holidays.data ?? [])
      .filter((holiday) => holiday.isActive !== false && new Date(holiday.date) >= today)
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(0, 6);
  }, [holidays.data]);

  const leaves = leave?.data?.upcomingApproved ?? [];

  return (
    <Grid container spacing={2}>
      {seesAttendance && (
        <Grid size={{ xs: 12, md: leave ? 6 : 12 }}>
          <DashboardPanel
            title="Upcoming holidays"
            subtitle="Public and company holidays"
            loading={holidays.loading}
            error={holidays.error}
            onRetry={holidays.reload}
            empty={!upcoming.length}
            emptyMessage="No upcoming holidays in the calendar."
            minHeight={180}
            action={
              <Link component={RouterLink} to={PATHS.holidays} variant="caption">
                Holiday calendar
              </Link>
            }
          >
            <Stack spacing={1.25}>
              {upcoming.map((holiday) => (
                <Stack key={holiday._id} direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                  <DateTile date={holiday.date} />
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="body2" noWrap>
                      {holiday.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {new Date(holiday.date).toLocaleDateString(['en-TZ', 'en-GB'], { weekday: 'long' })}
                    </Typography>
                  </Box>
                  {holiday.type && <Chip size="small" variant="outlined" label={humanize(holiday.type)} />}
                </Stack>
              ))}
            </Stack>
          </DashboardPanel>
        </Grid>
      )}

      {leave && (
        <Grid size={{ xs: 12, md: seesAttendance ? 6 : 12 }}>
          <DashboardPanel
            title="Upcoming approved leave"
            subtitle="Starting soon"
            loading={leave.loading}
            error={leave.error}
            onRetry={leave.reload}
            empty={!leaves.length}
            emptyMessage="No approved leave is coming up."
            minHeight={180}
            action={
              <Link component={RouterLink} to={PATHS.leave} variant="caption">
                Leave management
              </Link>
            }
          >
            <Stack spacing={1.25}>
              {leaves.map((request) => (
                <Stack key={request._id} direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                  <DateTile date={request.from} />
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="body2" noWrap>
                      {request.employee?.fullName ?? '—'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                      {[request.leaveType, `until ${formatDate(request.to)}`, request.days ? `${request.days} day(s)` : null].filter(Boolean).join(' · ')}
                    </Typography>
                  </Box>
                </Stack>
              ))}
            </Stack>
          </DashboardPanel>
        </Grid>
      )}
    </Grid>
  );
};

export default UpcomingEvents;
