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

import { STATUS_TRANSITIONS } from '@utils/employeeOptions.js';
import { humanize } from '@utils/format.js';

/**
 * Lifecycle transition dialog.
 *
 * Only the moves the server will accept are offered. The server enforces the
 * same table -- this just avoids presenting a choice that is guaranteed to
 * fail.
 */
const StatusChangeDialog = ({ open, employee, onClose, onSubmit, busy }) => {
  const [form, setForm] = useState({ status: '', effectiveDate: '', lastWorkingDate: '', noticePeriodDays: '', reason: '' });
  const [error, setError] = useState(null);

  const allowed = STATUS_TRANSITIONS[employee?.status] ?? [];
  const isTermination = form.status === 'TERMINATED';
  const isExit = ['NOTICE_PERIOD', 'RESIGNED', 'TERMINATED', 'RETIRED'].includes(form.status);

  const set = (field) => (event) => setForm((previous) => ({ ...previous, [field]: event.target.value }));

  const handleSubmit = async () => {
    setError(null);
    try {
      await onSubmit(
        Object.fromEntries(Object.entries(form).filter(([, value]) => value !== '')),
      );
      setForm({ status: '', effectiveDate: '', lastWorkingDate: '', noticePeriodDays: '', reason: '' });
    } catch (rejection) {
      setError(rejection?.message ?? 'The status could not be changed');
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Change status</DialogTitle>

      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          {allowed.length === 0 ? (
            <Alert severity="info">
              {humanize(employee?.status)} is a final state. Reversing it is an administrative
              correction, not a status change.
            </Alert>
          ) : (
            <>
              <TextField select label="New status" value={form.status} onChange={set('status')} required>
                {allowed.map((status) => (
                  <MenuItem key={status} value={status}>
                    {humanize(status)}
                  </MenuItem>
                ))}
              </TextField>

              <TextField
                type="date"
                label="Effective date"
                value={form.effectiveDate}
                onChange={set('effectiveDate')}
                slotProps={{ inputLabel: { shrink: true } }}
                helperText="Defaults to today"
              />

              {isExit && (
                <TextField
                  type="date"
                  label="Last working date"
                  value={form.lastWorkingDate}
                  onChange={set('lastWorkingDate')}
                  slotProps={{ inputLabel: { shrink: true } }}
                />
              )}

              {form.status === 'NOTICE_PERIOD' && (
                <TextField
                  type="number"
                  label="Notice period (days)"
                  value={form.noticePeriodDays}
                  onChange={set('noticePeriodDays')}
                />
              )}

              <TextField
                label="Reason"
                value={form.reason}
                onChange={set('reason')}
                multiline
                minRows={2}
                required={isTermination}
                helperText={
                  isTermination ? 'Required for a termination' : 'Recorded in the audit trail'
                }
              />
            </>
          )}
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} color="inherit">
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={busy || !form.status || (isTermination && !form.reason.trim())}
        >
          Apply
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default StatusChangeDialog;
