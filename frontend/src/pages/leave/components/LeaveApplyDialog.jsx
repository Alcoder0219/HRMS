import { useCallback, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import FormDialog from '@components/common/FormDialog.jsx';
import EmployeePicker from '@components/common/EmployeePicker.jsx';
import leaveService from '@services/modules/leave.service.js';
import { formatDate } from '@utils/format.js';
import { getRowId } from '@utils/dataGrid.js';

const today = () => new Date().toISOString().slice(0, 10);

const EMPTY = {
  leaveTypeId: '',
  from: today(),
  to: today(),
  isHalfDay: false,
  session: 'FIRST_HALF',
  reason: '',
  contactDuringLeave: '',
};

/**
 * Applies for leave, with a live preview of what it will cost.
 *
 * The preview is the server's own dry run rather than arithmetic done here.
 * Which days count depends on the shift's weekly offs, the holiday calendar and
 * the leave type's rules -- three things the browser would have to duplicate
 * and would eventually get wrong. Asking is cheaper than guessing.
 */
const LeaveApplyDialog = ({ open, types = [], onBehalf = false, onClose, onSaved }) => {
  const [form, setForm] = useState(EMPTY);
  const [employee, setEmployee] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(EMPTY);
      setEmployee(null);
      setPreview(null);
      setError(null);
    }
  }, [open]);

  const set = (field) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;

    setForm((previous) => {
      const next = { ...previous, [field]: value };
      // A half day is a single date by definition; the model refuses anything else.
      if (field === 'isHalfDay' && value) next.to = next.from;
      if (field === 'from' && previous.isHalfDay) next.to = value;
      return next;
    });
  };

  const selectedType = types.find((type) => getRowId(type) === form.leaveTypeId);

  const runPreview = useCallback(async () => {
    if (!form.leaveTypeId || !form.from || !form.to) {
      setPreview(null);
      return;
    }

    if (onBehalf && !employee) {
      setPreview(null);
      return;
    }

    setPreviewing(true);

    try {
      const response = await leaveService.preview({
        leaveTypeId: form.leaveTypeId,
        ...(employee ? { employeeId: getRowId(employee) } : {}),
        from: form.from,
        to: form.to,
        isHalfDay: form.isHalfDay,
        session: form.isHalfDay ? form.session : null,
        reason: form.reason || null,
      });

      setPreview(response.data);
    } catch (rejection) {
      setPreview(null);
      setError(rejection?.message ?? 'The preview could not be calculated');
    } finally {
      setPreviewing(false);
    }
  }, [form.leaveTypeId, form.from, form.to, form.isHalfDay, form.session, form.reason, employee, onBehalf]);

  // Debounced, so dragging a date field does not fire a request per keystroke.
  useEffect(() => {
    if (!open) return undefined;

    const timer = setTimeout(runPreview, 350);
    return () => clearTimeout(timer);
  }, [open, runPreview]);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);

    try {
      await leaveService.apply({
        leaveTypeId: form.leaveTypeId,
        ...(employee ? { employeeId: getRowId(employee) } : {}),
        from: form.from,
        to: form.to,
        isHalfDay: form.isHalfDay,
        session: form.isHalfDay ? form.session : null,
        reason: form.reason.trim(),
        contactDuringLeave: form.contactDuringLeave.trim() || null,
      });

      onSaved('Leave applied for');
    } catch (rejection) {
      setError(rejection?.message ?? 'The application could not be submitted');
    } finally {
      setSubmitting(false);
    }
  };

  const blocked = (preview?.problems?.length ?? 0) > 0;
  const incomplete = !form.leaveTypeId || !form.reason.trim() || (onBehalf && !employee);

  return (
    <FormDialog
      open={open}
      title="Apply for leave"
      subtitle={onBehalf ? 'Raised on behalf of an employee' : 'Your own leave'}
      error={error}
      submitting={submitting}
      submitLabel={preview?.days ? `Apply for ${preview.days} day(s)` : 'Apply'}
      disabled={incomplete || blocked || !preview?.days}
      onSubmit={handleSubmit}
      onClose={onClose}
      maxWidth="md"
    >
      <Grid container spacing={2} sx={{ pt: 0.5 }}>
        {onBehalf && (
          <Grid size={12}>
            <EmployeePicker value={employee} onChange={setEmployee} label="Employee" size="medium" required />
          </Grid>
        )}

        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField select label="Leave type" value={form.leaveTypeId} onChange={set('leaveTypeId')} fullWidth required>
            {types.map((type) => (
              <MenuItem key={getRowId(type)} value={getRowId(type)}>
                {type.name}
                {!type.isPaid ? ' (unpaid)' : ''}
              </MenuItem>
            ))}
          </TextField>
        </Grid>

        <Grid size={{ xs: 12, sm: 6 }}>
          <FormControlLabel
            control={
              <Switch
                checked={form.isHalfDay}
                onChange={set('isHalfDay')}
                disabled={selectedType && !selectedType.allowHalfDay}
              />
            }
            label="Half day"
            sx={{ mt: 1 }}
          />
          {selectedType && !selectedType.allowHalfDay && (
            <Typography variant="caption" color="text.secondary" display="block">
              {selectedType.name} cannot be taken as a half day
            </Typography>
          )}
        </Grid>

        <Grid size={{ xs: 12, sm: form.isHalfDay ? 6 : 6 }}>
          <TextField
            label="From"
            type="date"
            value={form.from}
            onChange={set('from')}
            fullWidth
            required
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </Grid>

        {form.isHalfDay ? (
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField select label="Which half" value={form.session} onChange={set('session')} fullWidth>
              <MenuItem value="FIRST_HALF">First half</MenuItem>
              <MenuItem value="SECOND_HALF">Second half</MenuItem>
            </TextField>
          </Grid>
        ) : (
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="To"
              type="date"
              value={form.to}
              onChange={set('to')}
              fullWidth
              required
              error={Boolean(form.to && form.from && form.to < form.from)}
              helperText={form.to && form.from && form.to < form.from ? 'Must be on or after the start' : null}
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Grid>
        )}

        <Grid size={12}>
          <TextField
            label="Reason"
            value={form.reason}
            onChange={set('reason')}
            fullWidth
            required
            multiline
            rows={2}
          />
        </Grid>

        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            label="Contact while away"
            value={form.contactDuringLeave}
            onChange={set('contactDuringLeave')}
            fullWidth
            size="small"
          />
        </Grid>

        <Grid size={12}>
          <Divider sx={{ my: 1 }} />
          {previewing && <LinearProgress sx={{ mb: 1 }} />}

          {preview && (
            <>
              <Stack direction="row" spacing={3} sx={{ mb: 1 }} flexWrap="wrap" useFlexGap>
                <Box>
                  <Typography variant="caption" color="text.secondary" display="block">
                    This request costs
                  </Typography>
                  <Typography variant="h5">{preview.days} day(s)</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Available after pending
                  </Typography>
                  <Typography variant="h5">{preview.balance?.usable ?? 0}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Balance
                  </Typography>
                  <Typography variant="h5">{preview.balance?.available ?? 0}</Typography>
                </Box>
              </Stack>

              {/* Days inside the range that cost nothing, so a five-date request
                  showing three days is explained rather than surprising. */}
              {preview.breakdown?.some((day) => day.days === 0) && (
                <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
                  {preview.breakdown
                    .filter((day) => day.days === 0)
                    .map((day) => (
                      <Chip
                        key={day.date}
                        label={`${formatDate(day.date)} — ${day.reason}`}
                        size="small"
                        variant="outlined"
                      />
                    ))}
                </Stack>
              )}

              {blocked && (
                <Alert severity="error">
                  <AlertTitle>This cannot be submitted</AlertTitle>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {preview.problems.map((problem) => (
                      <li key={problem}>{problem}</li>
                    ))}
                  </ul>
                </Alert>
              )}
            </>
          )}

          {!preview && !previewing && (
            <Typography variant="caption" color="text.secondary">
              Choose a leave type and dates to see what the request will cost.
            </Typography>
          )}
        </Grid>
      </Grid>
    </FormDialog>
  );
};

export default LeaveApplyDialog;
