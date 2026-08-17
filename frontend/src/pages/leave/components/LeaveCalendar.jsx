import { useCallback, useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import { LoadingState, ErrorState, EmptyState } from '@components/common/StateBlock.jsx';
import { useAppDispatch, useAppSelector } from '@hooks/useRedux.js';
import { fetchMasters, selectMasters } from '@redux/slices/employeeSlice.js';
import leaveService from '@services/modules/leave.service.js';
import { humanize } from '@utils/format.js';

const MONTHS = Array.from({ length: 12 }, (_, index) => ({
  value: index + 1,
  label: new Date(2000, index).toLocaleString([], { month: 'long' }),
}));

const now = new Date();
const YEARS = Array.from({ length: 4 }, (_, index) => now.getFullYear() - 1 + index);

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Who is away, laid out as a month.
 *
 * The question a manager asks is not "what did X apply for" but "how many of my
 * team are out on the 14th", which a list of requests cannot answer at a glance.
 * The endpoint returns days rather than requests for exactly that reason.
 */
const LeaveCalendar = ({ onError }) => {
  const dispatch = useAppDispatch();
  const masters = useAppSelector(selectMasters);

  const [period, setPeriod] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const [departmentId, setDepartmentId] = useState('');
  const [days, setDays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    dispatch(fetchMasters());
  }, [dispatch]);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);

    const from = new Date(period.year, period.month - 1, 1);
    const to = new Date(period.year, period.month, 0);
    const iso = (date) => date.toISOString().slice(0, 10);

    leaveService
      .calendar({ from: iso(from), to: iso(to), departmentId })
      .then((response) => setDays(response.data?.days ?? []))
      .catch((rejection) => {
        setDays([]);
        setError(rejection?.message ?? 'Could not load the leave calendar');
        onError?.(rejection?.message);
      })
      .finally(() => setLoading(false));
  }, [period.year, period.month, departmentId, onError]);

  useEffect(() => {
    load();
  }, [load]);

  const byDate = useMemo(() => new Map(days.map((day) => [day.date, day])), [days]);

  /** Every date in the month, padded so the first sits under its weekday. */
  const weeks = useMemo(() => {
    const first = new Date(period.year, period.month - 1, 1);
    const last = new Date(period.year, period.month, 0);

    const cells = [...Array(first.getDay()).fill(null)];

    for (let day = 1; day <= last.getDate(); day += 1) {
      const date = new Date(period.year, period.month - 1, day);
      cells.push({ day, key: date.toISOString().slice(0, 10), weekend: [0, 6].includes(date.getDay()) });
    }

    const result = [];
    for (let index = 0; index < cells.length; index += 7) result.push(cells.slice(index, index + 7));
    return result;
  }, [period.year, period.month]);

  const busiest = days.reduce((max, day) => Math.max(max, day.count), 0);

  const set = (field) => (event) => setPeriod((previous) => ({ ...previous, [field]: Number(event.target.value) }));

  return (
    <Box>
      <Stack direction="row" spacing={1} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap data-print="hide">
        <TextField select size="small" label="Year" value={period.year} onChange={set('year')} sx={{ width: 120 }}>
          {YEARS.map((year) => (
            <MenuItem key={year} value={year}>
              {year}
            </MenuItem>
          ))}
        </TextField>

        <TextField select size="small" label="Month" value={period.month} onChange={set('month')} sx={{ width: 150 }}>
          {MONTHS.map((month) => (
            <MenuItem key={month.value} value={month.value}>
              {month.label}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          select
          size="small"
          label="Department"
          value={departmentId}
          onChange={(event) => setDepartmentId(event.target.value)}
          sx={{ width: 220 }}
        >
          <MenuItem value="">All departments</MenuItem>
          {(masters?.departments ?? []).map((department) => (
            <MenuItem key={department._id} value={department._id}>
              {department.name}
            </MenuItem>
          ))}
        </TextField>

        <Chip
          label={`${days.reduce((sum, day) => sum + day.count, 0)} absence(s) this month`}
          size="small"
          variant="outlined"
          sx={{ alignSelf: 'center' }}
        />
      </Stack>

      {loading && <LoadingState message="Loading the calendar…" minHeight={280} />}
      {error && !loading && <ErrorState message={error} onRetry={load} minHeight={280} />}

      {!loading && !error && (
        <Paper variant="outlined" sx={{ p: 2, overflowX: 'auto' }} data-print="table">
          <Box sx={{ minWidth: 640 }}>
            <Grid container columns={7} spacing={1} sx={{ mb: 1 }}>
              {WEEKDAYS.map((weekday) => (
                <Grid key={weekday} size={1}>
                  <Typography variant="caption" color="text.secondary" align="center" display="block">
                    {weekday}
                  </Typography>
                </Grid>
              ))}
            </Grid>

            {weeks.map((week, weekIndex) => (
              <Grid container columns={7} spacing={1} key={weekIndex} sx={{ mb: 1 }}>
                {week.map((cell, cellIndex) => {
                  if (!cell) return <Grid key={`pad-${cellIndex}`} size={1} />;

                  const entry = byDate.get(cell.key);
                  const count = entry?.count ?? 0;

                  /**
                   * Shaded by how many people are out relative to the busiest
                   * day, so a staffing problem is visible without reading a
                   * single name.
                   */
                  const intensity = busiest > 0 ? count / busiest : 0;

                  return (
                    <Grid key={cell.key} size={1}>
                      <Tooltip
                        arrow
                        title={
                          count === 0
                            ? 'Nobody away'
                            : entry.entries
                                .map((person) => `${person.fullName} — ${person.leaveType} (${humanize(person.status)})`)
                                .join('\n')
                        }
                      >
                        <Box
                          sx={{
                            minHeight: 78,
                            p: 1,
                            borderRadius: 1,
                            border: 1,
                            borderColor: 'divider',
                            bgcolor: count
                              ? `rgba(211, 47, 47, ${0.12 + intensity * 0.4})`
                              : cell.weekend
                                ? 'action.hover'
                                : 'background.paper',
                          }}
                        >
                          <Typography variant="caption" color="text.secondary">
                            {cell.day}
                          </Typography>

                          {count > 0 && (
                            <>
                              <Typography variant="h6" sx={{ lineHeight: 1.2 }}>
                                {count}
                              </Typography>
                              <Typography variant="caption" color="text.secondary" noWrap display="block">
                                {entry.entries[0].fullName?.split(' ')[0]}
                                {count > 1 ? ` +${count - 1}` : ''}
                              </Typography>
                            </>
                          )}
                        </Box>
                      </Tooltip>
                    </Grid>
                  );
                })}
              </Grid>
            ))}

            {days.length === 0 && (
              <EmptyState
                title="Nobody is on leave this month"
                message="Approved and pending leave both appear here."
                minHeight={120}
              />
            )}
          </Box>
        </Paper>
      )}
    </Box>
  );
};

export default LeaveCalendar;
