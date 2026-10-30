import { useCallback, useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import ConfirmDialog from '@components/feedback/ConfirmDialog.jsx';
import { TableSkeleton } from '@components/common/Skeletons.jsx';
import { useToast } from '@contexts/ToastContext.jsx';
import attendanceService from '@services/modules/attendance.service.js';
import { ATTENDANCE_STATUSES, toHoursMinutes } from '../attendanceConstants.js';
import { employeeIdentifiers } from '@utils/dataGrid.js';
import { fromAttendanceClock, toAttendanceClock } from '@utils/attendanceTime.js';

/**
 * Manual attendance correction for one employee's month.
 *
 * Every row posts to the existing `POST /attendance/manual` endpoint, which
 * stores exactly what is sent and writes the audit entry. What the
 * administrator chooses is what the day becomes: no shift, policy or holiday
 * calendar is consulted, and nothing re-derives the values afterwards.
 *
 * Working hours and overtime are shown as they are typed, from the two lines of
 * arithmetic the server also uses -- out time less in time, and that less the
 * employee's standard duty hours. They are still stored by the server rather
 * than posted from here, so a figure can never disagree with the times it was
 * supposedly calculated from.
 *
 * Only days the user actually touched are sent. Posting all thirty-one would
 * rewrite untouched days through the manual path, replacing their biometric
 * punches and marking them MANUAL -- which would quietly destroy the import
 * this feature is not allowed to disturb.
 */

/**
 * `Date` to the `HH:mm` a time input expects, on the attendance clock -- not
 * the browser's, so the same punch reads the same wherever it is edited.
 */
const toTimeInput = (value) => {
  const date = toAttendanceClock(value);
  if (!date) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

/** `HH:mm` back to the instant at that time, on the attendance clock, on the given day. */
const fromTimeInput = (dayIso, time) => {
  if (!time) return null;
  const [hours, minutes] = time.split(':').map(Number);
  const day = toAttendanceClock(dayIso);
  return fromAttendanceClock(day.getFullYear(), day.getMonth() + 1, day.getDate(), hours, minutes).toISOString();
};

/** The company default, for an employee saved before duty hours existed. */
const DEFAULT_DUTY_MINUTES = 510;

/**
 * Working hours: the plain span between the two times.
 *
 * Mirrors helpers/manualAttendance.helper.js on the server, including reading
 * an out time earlier than the in time as the following morning. Duplicated
 * rather than fetched because the whole point is that the figure updates on
 * every keystroke, and a round trip per keystroke is not that.
 */
const workedMinutesBetween = (checkIn, checkOut) => {
  if (!checkIn || !checkOut) return 0;

  const [inHours, inMinutes] = checkIn.split(':').map(Number);
  const [outHours, outMinutes] = checkOut.split(':').map(Number);
  if ([inHours, inMinutes, outHours, outMinutes].some((part) => !Number.isFinite(part))) return 0;

  const span = outHours * 60 + outMinutes - (inHours * 60 + inMinutes);
  return span < 0 ? span + 1440 : span;
};

/**
 * The status the server will settle on when the administrator has not chosen
 * one -- "Set from In/Out times" in the dropdown.
 *
 * Mirrors `statusFromTimes` on the server. Needed here because the rest-day
 * rule keys on the status: a Sunday given two times and left on the blank
 * option is stored PRESENT, and the preview has to price it the same way.
 */
const statusFromTimes = (checkIn, checkOut) => {
  if (checkIn && checkOut) return 'PRESENT';
  if (checkIn || checkOut) return 'MISSING_PUNCH';
  return 'ABSENT';
};

/** Statuses that mean the employee actually worked the day. Mirrors the server. */
const WORKED_STATUSES = new Set(['PRESENT', 'HALF_DAY', 'ON_DUTY', 'WORK_FROM_HOME']);

/**
 * Whether this row is work done on one of the employee's rest days.
 *
 * `weeklyOffDays` comes from the monthly register, which resolves it from the
 * employee's shift or attendance policy -- so an employee who rests on a
 * Saturday gets Saturday. An employee whose roster did not come through is left
 * on the status-only rule rather than being given a Sunday by assumption.
 */
const isRestDayWork = (status, dateIso, weeklyOffDays) => {
  if (status === 'WEEKLY_OFF') return true;
  if (!WORKED_STATUSES.has(status)) return false;
  if (!Array.isArray(weeklyOffDays) || !weeklyOffDays.length) return false;

  const date = toAttendanceClock(dateIso);
  return date ? weeklyOffDays.includes(date.getDay()) : false;
};

/**
 * Overtime: everything past the employee's own duty hours, and none if they are
 * not eligible -- except on a rest day, where the whole of it is overtime.
 *
 * Mirrors `overtimeMinutesFor` in helpers/manualAttendance.helper.js, including
 * the weekly-off rule, so the figure shown as the administrator types is the
 * one the server will store. The server remains the authority: nothing here is
 * posted.
 */
const overtimeMinutesFor = (workedMinutes, employee, status = null, dateIso = null) => {
  if (!employee?.overtimeEligible) return 0;

  const worked = Math.max(0, Number(workedMinutes) || 0);
  if (!worked) return 0;

  // No duty hours are owed on a rest day, so the whole of it is overtime.
  if (isRestDayWork(status, dateIso, employee.weeklyOffDays)) return worked;
  return Math.max(0, worked - (employee.standardDutyMinutes ?? DEFAULT_DUTY_MINUTES));
};

const EditAttendanceDialog = ({ open, employee, year, month, onClose, onSaved }) => {
  const toast = useToast();

  const [rows, setRows] = useState([]);
  const [edits, setEdits] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [reason, setReason] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);

  const employeeId = employee?.id ?? null;

  const load = useCallback(async () => {
    if (!open || !employeeId) return;

    setLoading(true);
    setError(null);
    setEdits({});

    /**
     * The previous month's rows are dropped before the fetch, not after.
     *
     * MUI keeps a closed dialog's children mounted, so `rows` survives a close
     * and reopen. Leaving them on screen while the new request is in flight
     * showed the state as it was BEFORE the last save -- which looks exactly
     * like a save that did not take -- and, when a different employee was
     * opened, briefly showed the previous employee's days.
     */
    setRows([]);

    // Plain calendar dates, which the server reads as exactly these days in
    // its own zone. Browser-local instants shifted the range with the viewer.
    const daysInMonth = new Date(year, month, 0).getDate();
    const monthPart = String(month).padStart(2, '0');

    try {
      const response = await attendanceService.list({
        employeeId,
        from: `${year}-${monthPart}-01`,
        to: `${year}-${monthPart}-${String(daysInMonth).padStart(2, '0')}`,
        limit: 200,
        sortBy: 'date',
        sortOrder: 'asc',
      });

      const byDay = new Map(
        (response.data ?? []).map((record) => [toAttendanceClock(record.date).getDate(), record]),
      );

      // Every day of the month is listed, including those with no record at
      // all -- an absence with no punch is exactly what a correction is for,
      // and it would be invisible if only stored days were shown.
      setRows(
        Array.from({ length: daysInMonth }, (_, index) => {
          const dayNumber = index + 1;
          const record = byDay.get(dayNumber);
          const date = new Date(year, month - 1, dayNumber);

          return {
            dayNumber,
            // Midnight on the attendance clock: the instant the server keys this day at.
            dateIso: fromAttendanceClock(year, month, dayNumber).toISOString(),
            weekday: date.toLocaleDateString(['en-TZ', 'en-GB'], { weekday: 'short' }),
            status: record?.status ?? '',
            checkIn: toTimeInput(record?.checkInAt),
            checkOut: toTimeInput(record?.checkOutAt),
            workedMinutes: record?.workedMinutes ?? 0,
            overtimeMinutes: record?.overtimeMinutes ?? 0,
            remarks: record?.remarks ?? '',
            isLocked: Boolean(record?.isLocked),
          };
        }),
      );
    } catch (rejection) {
      setError(rejection?.message ?? 'Could not load this employee’s attendance');
    } finally {
      setLoading(false);
    }
  }, [open, employeeId, year, month]);

  useEffect(() => {
    load();
  }, [load]);

  const patch = (dayNumber, field, value) =>
    setEdits((current) => ({
      ...current,
      [dayNumber]: { ...(current[dayNumber] ?? {}), [field]: value },
    }));

  const valueOf = (row, field) => edits[row.dayNumber]?.[field] ?? row[field];

  const changedDays = useMemo(
    () =>
      Object.keys(edits)
        .map(Number)
        .filter((dayNumber) => {
          const row = rows.find((entry) => entry.dayNumber === dayNumber);
          if (!row) return false;

          const edit = edits[dayNumber];
          return ['status', 'checkIn', 'checkOut', 'remarks'].some(
            (field) => edit[field] !== undefined && edit[field] !== row[field],
          );
        })
        .sort((a, b) => a - b),
    [edits, rows],
  );

  const save = async () => {
    setConfirmOpen(false);
    setSaving(true);
    setProgress(0);
    setError(null);

    let done = 0;
    const failed = [];

    // Sequential rather than parallel: each day is upserted and recomputed
    // server-side, and firing thirty at once against the same employee invites
    // write contention for no gain on a set this small.
    for (const dayNumber of changedDays) {
      const row = rows.find((entry) => entry.dayNumber === dayNumber);
      const edit = edits[dayNumber] ?? {};

      /**
       * Only the fields the administrator actually touched are sent.
       *
       * Resending everything looked harmless but was not: an edit to the times
       * alone would pin the day's existing status as a permanent override, and
       * an edit to the status alone would resend the times as manual punches,
       * replacing the biometric log the device wrote. Omitting a field leaves
       * it exactly as it was.
       */
      const changed = (field) => edit[field] !== undefined && edit[field] !== row[field];

      const payload = { employeeId, date: row.dateIso, reason: reason || null };

      if (changed('status')) payload.status = edit.status || null;
      if (changed('remarks')) payload.remarks = edit.remarks || null;

      // Times travel together: the engine reads a day as a span, and sending
      // one without the other would measure it against a stale counterpart.
      if (changed('checkIn') || changed('checkOut')) {
        payload.checkIn = fromTimeInput(row.dateIso, valueOf(row, 'checkIn'));
        payload.checkOut = fromTimeInput(row.dateIso, valueOf(row, 'checkOut'));
      }

      try {
        await attendanceService.markManual(payload);
      } catch (rejection) {
        failed.push(`${dayNumber}: ${rejection?.message ?? 'failed'}`);
      }

      done += 1;
      setProgress(Math.round((done / changedDays.length) * 100));
    }

    setSaving(false);

    if (failed.length) {
      setError(`${failed.length} day(s) could not be saved — ${failed.join('; ')}`);
      toast.error(`${failed.length} of ${changedDays.length} day(s) failed`);
    } else {
      toast.success(
        `${changedDays.length} day(s) saved exactly as entered.`,
      );
    }

    // Reloads either way: a partial save must show what actually landed.
    await load();
    onSaved?.();

    if (!failed.length) onClose();
  };

  const anyLocked = rows.some((row) => row.isLocked);

  return (
    <>
      <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="xl" fullWidth>
        <DialogTitle>
          Edit Attendance
          <Typography variant="body2" color="text.secondary">
            {employee?.fullName} · {employeeIdentifiers(employee)}
            {` · duty ${toHoursMinutes(employee?.standardDutyMinutes ?? DEFAULT_DUTY_MINUTES)}`}
            {employee?.overtimeEligible === false ? ' · not eligible for overtime' : ''}
          </Typography>
        </DialogTitle>

        <DialogContent dividers sx={{ p: 0 }}>
          {saving && <LinearProgress variant="determinate" value={progress} />}

          {error && (
            <Alert severity="error" sx={{ m: 2 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          {anyLocked && (
            <Alert severity="warning" sx={{ m: 2 }}>
              Some days fall in a locked period and cannot be changed.
            </Alert>
          )}

          {loading ? (
            <TableSkeleton columns={7} rows={10} />
          ) : (
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ minWidth: 90 }}>Date</TableCell>
                    <TableCell sx={{ minWidth: 150 }}>Status</TableCell>
                    <TableCell sx={{ minWidth: 110 }}>In Time</TableCell>
                    <TableCell sx={{ minWidth: 110 }}>Out Time</TableCell>
                    <TableCell align="right" sx={{ minWidth: 100 }}>Working Hours</TableCell>
                    <TableCell align="right" sx={{ minWidth: 90 }}>Overtime</TableCell>
                    <TableCell sx={{ minWidth: 200 }}>Remarks</TableCell>
                  </TableRow>
                </TableHead>

                <TableBody>
                  {rows.map((row) => {
                    const touched = changedDays.includes(row.dayNumber);

                    // Computed from what is on screen, not from what was
                    // loaded, so both columns follow the times as they change.
                    const checkIn = valueOf(row, 'checkIn');
                    const checkOut = valueOf(row, 'checkOut');
                    const workedMinutes = workedMinutesBetween(checkIn, checkOut);
                    const overtimeMinutes = overtimeMinutesFor(
                      workedMinutes,
                      employee,
                      // A blank status is not "no status": the server derives
                      // one from the times, so the preview derives the same.
                      valueOf(row, 'status') || statusFromTimes(checkIn, checkOut),
                      row.dateIso,
                    );

                    return (
                      <TableRow
                        key={row.dayNumber}
                        sx={touched ? { bgcolor: 'action.selected' } : undefined}
                      >
                        <TableCell>
                          <Typography variant="body2" fontWeight={touched ? 700 : 500}>
                            {String(row.dayNumber).padStart(2, '0')}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {row.weekday}
                          </Typography>
                        </TableCell>

                        <TableCell>
                          <TextField
                            select
                            size="small"
                            fullWidth
                            value={valueOf(row, 'status')}
                            onChange={(event) => patch(row.dayNumber, 'status', event.target.value)}
                            disabled={row.isLocked || saving}
                          >
                            <MenuItem value="">
                              <em>Set from In/Out times</em>
                            </MenuItem>
                            {ATTENDANCE_STATUSES.map((status) => (
                              <MenuItem key={status.value} value={status.value}>
                                {status.label}
                              </MenuItem>
                            ))}
                          </TextField>
                        </TableCell>

                        <TableCell>
                          <TextField
                            type="time"
                            size="small"
                            fullWidth
                            value={valueOf(row, 'checkIn')}
                            onChange={(event) => patch(row.dayNumber, 'checkIn', event.target.value)}
                            disabled={row.isLocked || saving}
                            slotProps={{ inputLabel: { shrink: true } }}
                          />
                        </TableCell>

                        <TableCell>
                          <TextField
                            type="time"
                            size="small"
                            fullWidth
                            value={valueOf(row, 'checkOut')}
                            onChange={(event) => patch(row.dayNumber, 'checkOut', event.target.value)}
                            disabled={row.isLocked || saving}
                            slotProps={{ inputLabel: { shrink: true } }}
                          />
                        </TableCell>

                        {/* Read-only: both follow arithmetically from the two
                            times, so a typed-in total could only ever be a
                            total that disagrees with them. */}
                        <TableCell align="right">
                          <Typography variant="body2">{toHoursMinutes(workedMinutes)}</Typography>
                        </TableCell>

                        <TableCell align="right">
                          <Typography
                            variant="body2"
                            color={overtimeMinutes > 0 ? 'success.main' : 'text.secondary'}
                          >
                            {toHoursMinutes(overtimeMinutes)}
                          </Typography>
                        </TableCell>

                        <TableCell>
                          <TextField
                            size="small"
                            fullWidth
                            placeholder="—"
                            value={valueOf(row, 'remarks')}
                            onChange={(event) => patch(row.dayNumber, 'remarks', event.target.value)}
                            disabled={row.isLocked || saving}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Box>
          )}
        </DialogContent>

        <DialogActions sx={{ px: 3, py: 2 }}>
          <Stack direction="row" spacing={2} alignItems="center" sx={{ flex: 1, minWidth: 0 }}>
            <Chip
              size="small"
              color={changedDays.length ? 'primary' : 'default'}
              label={changedDays.length ? `${changedDays.length} day(s) changed` : 'No changes'}
            />
            <TextField
              size="small"
              label="Reason for the correction"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              disabled={saving}
              sx={{ flex: 1, maxWidth: 380 }}
              helperText="Recorded in the audit trail"
            />
          </Stack>

          <Button onClick={onClose} color="inherit" disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={() => setConfirmOpen(true)}
            disabled={saving || changedDays.length === 0}
          >
            {saving ? `Saving ${progress}%` : 'Save changes'}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={confirmOpen}
        title={`Save ${changedDays.length} corrected day(s)?`}
        message={`Days ${changedDays.join(', ')} will be recorded as manual corrections for ${employee?.fullName}. Working hours, overtime, payable days and the monthly summary are recalculated, and payroll will read the new figures. Every change is written to the audit trail.`}
        confirmLabel="Save changes"
        confirmColor="primary"
        loading={saving}
        onConfirm={save}
        onClose={() => setConfirmOpen(false)}
      />
    </>
  );
};

export default EditAttendanceDialog;
