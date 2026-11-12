import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CopyIcon from '@mui/icons-material/ContentCopyOutlined';

import {
  SCHEDULE_DAYS,
  copyMondayToWeekdays,
  formatDuration,
  isOvernight,
  netMinutes,
  scheduleErrors,
  scheduleFromShift,
} from '@utils/shiftSchedule.js';

/**
 * Times for each day of the week, inside the Edit Shift dialog.
 *
 * Off by default: a shift without a schedule keeps working on its one timing
 * and weekly offs, exactly as before. Switching it on starts from those, so
 * nothing changes until a day is actually edited. Each row is one day: worked
 * or weekly off, its own start, end and break, and the net working time that
 * attendance will measure the day against.
 */
const DayScheduleEditor = ({ value, onChange, form, error = null }) => {
  const schedule = Array.isArray(value) ? value : [];
  const enabled = schedule.length === 7;
  const errors = scheduleErrors(schedule);

  const byDay = new Map(schedule.map((entry) => [entry.day, entry]));

  const update = (day, patch) =>
    onChange(schedule.map((entry) => (entry.day === day ? { ...entry, ...patch } : entry)));

  const toggleEnabled = (event) =>
    onChange(
      event.target.checked
        ? scheduleFromShift({ startTime: form.startTime, endTime: form.endTime, breakMinutes: form.breakMinutes, weeklyOffs: form.weeklyOffs })
        : [],
    );

  return (
    <Stack spacing={1.5}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}>
        <Box>
          <FormControlLabel control={<Switch checked={enabled} onChange={toggleEnabled} />} label="Different timings for each day" />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 6, mt: -0.5 }}>
            {enabled
              ? 'Attendance on each day is graded against that day’s own times. Days switched off are weekly offs.'
              : 'Off: every working day uses the times above and the weekly offs below.'}
          </Typography>
        </Box>
        {enabled && (
          <Button size="small" startIcon={<CopyIcon />} onClick={() => onChange(copyMondayToWeekdays(schedule))}>
            Copy Monday to Tue–Fri
          </Button>
        )}
      </Stack>

      {enabled && (
        <Paper variant="outlined" sx={{ p: { xs: 1, sm: 1.5 } }}>
          <Stack spacing={1}>
            {SCHEDULE_DAYS.map(({ day, label }) => {
              const entry = byDay.get(day) ?? { day, isWorking: false };
              const working = Boolean(entry.isWorking);
              const problem = errors[day];

              return (
                <Box
                  key={day}
                  sx={{
                    display: 'grid',
                    gap: 1,
                    alignItems: 'center',
                    gridTemplateColumns: { xs: '1fr 1fr', md: '110px 150px 1fr 1fr 110px 90px' },
                  }}
                >
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {label}
                  </Typography>

                  <FormControlLabel
                    sx={{ m: 0 }}
                    control={<Switch size="small" checked={working} onChange={(event) => update(day, { isWorking: event.target.checked, ...(event.target.checked && !entry.startTime ? { startTime: form.startTime || '', endTime: form.endTime || '', breakMinutes: Number(form.breakMinutes) || 0 } : {}) })} />}
                    label={<Typography variant="caption">{working ? 'Working' : 'Weekly off'}</Typography>}
                  />

                  <TextField
                    label="Start"
                    type="time"
                    size="small"
                    value={working ? (entry.startTime ?? '') : ''}
                    disabled={!working}
                    error={Boolean(problem)}
                    onChange={(event) => update(day, { startTime: event.target.value })}
                    slotProps={{ inputLabel: { shrink: true } }}
                  />

                  <TextField
                    label="End"
                    type="time"
                    size="small"
                    value={working ? (entry.endTime ?? '') : ''}
                    disabled={!working}
                    error={Boolean(problem)}
                    helperText={working && isOvernight(entry) ? 'Next day' : undefined}
                    onChange={(event) => update(day, { endTime: event.target.value })}
                    slotProps={{ inputLabel: { shrink: true } }}
                  />

                  <TextField
                    label="Break (min)"
                    type="number"
                    size="small"
                    value={working ? (entry.breakMinutes ?? 0) : ''}
                    disabled={!working}
                    error={Boolean(problem)}
                    onChange={(event) => update(day, { breakMinutes: event.target.value === '' ? 0 : Number(event.target.value) })}
                    slotProps={{ htmlInput: { min: 0, max: 480 } }}
                  />

                  <Typography variant="body2" color={working ? 'text.primary' : 'text.secondary'} sx={{ textAlign: { md: 'right' } }}>
                    {working ? formatDuration(netMinutes(entry)) : '—'}
                  </Typography>

                  {problem && (
                    <Typography variant="caption" color="error" sx={{ gridColumn: '1 / -1', mt: -0.5 }}>
                      {label}: {problem}
                    </Typography>
                  )}
                </Box>
              );
            })}
          </Stack>
        </Paper>
      )}

      {error && (
        <Typography variant="caption" color="error">
          {error}
        </Typography>
      )}
    </Stack>
  );
};

export default DayScheduleEditor;
