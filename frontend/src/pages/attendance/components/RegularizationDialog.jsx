import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';

import attendanceService from '@services/modules/attendance.service.js';
import { formatDate, humanize, toDateInput } from '@utils/format.js';
import { toAttendanceClock } from '@utils/attendanceTime.js';

const TYPES = [
  'MISSED_PUNCH',
  'FORGOT_TO_PUNCH',
  'WRONG_TIME',
  'ON_DUTY',
  'WORK_FROM_HOME',
  'TECHNICAL_ISSUE',
];

const CLAIMABLE_STATUSES = ['PRESENT', 'HALF_DAY', 'ON_DUTY', 'WORK_FROM_HOME'];

/**
 * Raise a correction for one day.
 *
 * Times are entered as `HH:mm` and combined with the target date before
 * sending -- a bare time would be ambiguous, and asking the user to retype the
 * date they already selected is friction for no gain.
 */
const RegularizationDialog = ({ open, date, onClose, onSubmitted }) => {
  const [form, setForm] = useState({ type: 'MISSED_PUNCH', checkIn: '', checkOut: '', status: '', reason: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const set = (field) => (event) => setForm((prev) => ({ ...prev, [field]: event.target.value }));

  const reset = () => {
    setForm({ type: 'MISSED_PUNCH', checkIn: '', checkOut: '', status: '', reason: '' });
    setError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    setBusy(true);
    setError(null);

    // The day on the attendance clock. A UTC slice would name the previous
    // date, because days are keyed at midnight east of UTC.
    const day = toDateInput(toAttendanceClock(date));

    try {
      await attendanceService.requestRegularization({
        date: day,
        type: form.type,
        requestedCheckIn: form.checkIn ? `${day}T${form.checkIn}:00` : undefined,
        requestedCheckOut: form.checkOut ? `${day}T${form.checkOut}:00` : undefined,
        requestedStatus: form.status || undefined,
        reason: form.reason,
      });

      reset();
      onSubmitted();
    } catch (rejection) {
      setError(rejection?.message ?? 'The request could not be submitted');
    } finally {
      setBusy(false);
    }
  };

  const nothingClaimed = !form.checkIn && !form.checkOut && !form.status;

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
      <DialogTitle>Regularize {date ? formatDate(toAttendanceClock(date)) : ''}</DialogTitle>

      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <TextField select label="Reason type" value={form.type} onChange={set('type')}>
            {TYPES.map((type) => (
              <MenuItem key={type} value={type}>
                {humanize(type)}
              </MenuItem>
            ))}
          </TextField>

          <Stack direction="row" spacing={2}>
            <TextField
              type="time"
              label="Check in"
              value={form.checkIn}
              onChange={set('checkIn')}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              type="time"
              label="Check out"
              value={form.checkOut}
              onChange={set('checkOut')}
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Stack>

          <TextField
            select
            label="Claim status (optional)"
            value={form.status}
            onChange={set('status')}
            helperText="Use for on-duty or work-from-home days with no punches"
          >
            <MenuItem value="">
              <em>None</em>
            </MenuItem>
            {CLAIMABLE_STATUSES.map((status) => (
              <MenuItem key={status} value={status}>
                {humanize(status)}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            label="Reason"
            value={form.reason}
            onChange={set('reason')}
            multiline
            minRows={2}
            required
            helperText="Your approver sees this — at least 5 characters"
          />
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleClose} color="inherit">
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={busy || nothingClaimed || form.reason.trim().length < 5}
        >
          Submit
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default RegularizationDialog;
