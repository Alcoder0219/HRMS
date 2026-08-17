import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import FormDialog from '@components/common/FormDialog.jsx';
import attendanceService from '@services/modules/attendance.service.js';

const firstOfLastMonth = () => {
  const date = new Date();
  date.setMonth(date.getMonth() - 1, 1);
  return date.toISOString().slice(0, 10);
};

const lastOfLastMonth = () => {
  const date = new Date();
  date.setDate(0);
  return date.toISOString().slice(0, 10);
};

/**
 * Freezes a date range once payroll has consumed it.
 *
 * Without this, a regularization approved after payday silently changes a
 * figure that has already been paid -- the attendance says one thing and the
 * payslip another, and nothing records which is right.
 *
 * Defaults to the previous calendar month, which is the range being closed
 * almost every time this is opened.
 */
const LockPeriodDialog = ({ open, onClose, onLocked }) => {
  const [range, setRange] = useState({ from: firstOfLastMonth(), to: lastOfLastMonth() });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setRange({ from: firstOfLastMonth(), to: lastOfLastMonth() });
      setError(null);
    }
  }, [open]);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);

    try {
      const response = await attendanceService.lockPeriod(range);
      onLocked(response.message ?? `${response.data?.locked ?? 0} day(s) locked`);
    } catch (rejection) {
      setError(rejection?.message ?? 'The period could not be locked');
    } finally {
      setSubmitting(false);
    }
  };

  const invalid = !range.from || !range.to || range.to < range.from;

  return (
    <FormDialog
      open={open}
      title="Lock a period"
      subtitle="Stops attendance in this range from being changed"
      error={error}
      submitting={submitting}
      submitLabel="Lock period"
      submitColor="warning"
      disabled={invalid}
      onSubmit={handleSubmit}
      onClose={onClose}
    >
      <Grid container spacing={2} sx={{ pt: 0.5 }}>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            label="From"
            type="date"
            value={range.from}
            onChange={(event) => setRange((previous) => ({ ...previous, from: event.target.value }))}
            fullWidth
            required
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </Grid>

        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            label="To"
            type="date"
            value={range.to}
            onChange={(event) => setRange((previous) => ({ ...previous, to: event.target.value }))}
            fullWidth
            required
            error={Boolean(range.to && range.from && range.to < range.from)}
            helperText={range.to && range.from && range.to < range.from ? 'Must be on or after the start' : null}
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </Grid>

        <Grid size={12}>
          <Alert severity="warning">
            <Typography variant="body2">
              Locked days cannot be marked, imported or regularized. Do this once payroll for the period has
              been processed — a correction after that changes a figure that has already been paid.
            </Typography>
          </Alert>
        </Grid>
      </Grid>
    </FormDialog>
  );
};

export default LockPeriodDialog;
