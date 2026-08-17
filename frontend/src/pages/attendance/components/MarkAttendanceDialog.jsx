import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Autocomplete from '@mui/material/Autocomplete';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';

import attendanceService from '@services/modules/attendance.service.js';
import employeeService from '@services/modules/employee.service.js';
import { humanize } from '@utils/format.js';
import { getRowId, displayName, employeeIdentifiers } from '@utils/dataGrid.js';

const STATUSES = ['PRESENT', 'HALF_DAY', 'ABSENT', 'ON_DUTY', 'WORK_FROM_HOME', 'ON_LEAVE'];

/**
 * HR marking a day for someone else.
 *
 * The employee picker searches server-side rather than loading the whole
 * directory: at a few thousand people a full list is both slow and unusable.
 */
const MarkAttendanceDialog = ({ open, onClose, onSaved, defaultDate }) => {
  const [options, setOptions] = useState([]);
  const [employee, setEmployee] = useState(null);
  const [form, setForm] = useState({ date: defaultDate ?? '', checkIn: '', checkOut: '', status: '', remarks: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const set = (field) => (event) => setForm((prev) => ({ ...prev, [field]: event.target.value }));

  const search = async (term) => {
    if (!term || term.length < 2) return;
    try {
      const response = await employeeService.list({ search: term, limit: 20 });
      setOptions(response.data ?? []);
    } catch {
      setOptions([]);
    }
  };

  const handleSubmit = async () => {
    setBusy(true);
    setError(null);

    try {
      await attendanceService.markManual({
        // Search results are lean rows: `_id` only, no `id`. Reading `id` here
        // sent `undefined` and the request failed validation.
        employeeId: getRowId(employee),
        date: form.date,
        checkIn: form.checkIn ? `${form.date}T${form.checkIn}:00` : undefined,
        checkOut: form.checkOut ? `${form.date}T${form.checkOut}:00` : undefined,
        status: form.status || undefined,
        remarks: form.remarks || undefined,
      });

      setEmployee(null);
      setForm({ date: defaultDate ?? '', checkIn: '', checkOut: '', status: '', remarks: '' });
      onSaved();
    } catch (rejection) {
      setError(rejection?.message ?? 'The record could not be saved');
    } finally {
      setBusy(false);
    }
  };

  const incomplete = !employee || !form.date || (!form.checkIn && !form.checkOut && !form.status);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Mark attendance</DialogTitle>

      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <Autocomplete
            options={options}
            value={employee}
            onChange={(_event, value) => setEmployee(value)}
            onInputChange={(_event, value) => search(value)}
            getOptionLabel={(option) => `${employeeIdentifiers(option)} — ${displayName(option)}`}
            // Compared on `_id`; comparing `id` made every option equal to
            // every other, because all of them were undefined.
            isOptionEqualToValue={(option, value) => getRowId(option) === getRowId(value)}
            renderInput={(params) => (
              <TextField {...params} label="Employee" placeholder="Search by code or name" required />
            )}
          />

          <TextField
            type="date"
            label="Date"
            value={form.date}
            onChange={set('date')}
            slotProps={{ inputLabel: { shrink: true } }}
            required
          />

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
            label="Override status (optional)"
            value={form.status}
            onChange={set('status')}
            helperText="Leave blank to let the rules engine decide from the times"
          >
            <MenuItem value="">
              <em>Compute from times</em>
            </MenuItem>
            {STATUSES.map((status) => (
              <MenuItem key={status} value={status}>
                {humanize(status)}
              </MenuItem>
            ))}
          </TextField>

          <TextField label="Remarks" value={form.remarks} onChange={set('remarks')} multiline minRows={2} />
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} color="inherit">
          Cancel
        </Button>
        <Button onClick={handleSubmit} variant="contained" disabled={busy || incomplete}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default MarkAttendanceDialog;
