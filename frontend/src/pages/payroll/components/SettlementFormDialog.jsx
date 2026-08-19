import { useEffect, useState } from 'react';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid';
import MenuItem from '@mui/material/MenuItem';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import FormDialog from '@components/common/FormDialog.jsx';
import EmployeePicker from '@components/common/EmployeePicker.jsx';
import CurrencyAdornment from '@components/common/CurrencyAdornment.jsx';
import payrollService from '@services/modules/payroll.service.js';
import { humanize } from '@utils/format.js';
import { getRowId } from '@utils/dataGrid.js';

export const SETTLEMENT_TRIGGERS = [
  'RESIGNATION',
  'TERMINATION',
  'RETIREMENT',
  'ABSCONDING',
  'DEATH',
  'END_OF_CONTRACT',
];

const EMPTY = {
  trigger: 'RESIGNATION',
  lastWorkingDate: '',
  resignationDate: '',
  lastPaidUpto: '',
  exitReason: '',
  rehireEligible: true,
  requiredDays: '',
  servedDays: '',
  waivedDays: '',
  employerWaived: false,
  encashableDays: '',
  excessDays: '',
  bonus: '',
  incentive: '',
  arrears: '',
  reimbursement: '',
  remarks: '',
};

/**
 * Opens a full and final settlement.
 *
 * Nothing here computes money. Severance, notice recovery and leave encashment
 * are all derived server-side from the employee's structure and service, and
 * the sheet is recalculated whenever these inputs change -- so this form only
 * collects the facts of the exit that the system cannot know on its own.
 *
 * Both dates fall back to the lifecycle dates already on the employee record
 * when left blank, which is why neither is marked required.
 */
const SettlementFormDialog = ({ open, onClose, onSaved }) => {
  const [employee, setEmployee] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setEmployee(null);
      setForm(EMPTY);
      setError(null);
    }
  }, [open]);

  const set = (field) => (event) =>
    setForm((previous) => ({
      ...previous,
      [field]: event.target.type === 'checkbox' ? event.target.checked : event.target.value,
    }));

  /** Drops blanks -- the validator rejects an empty string where it wants a number. */
  const numeric = (value) => (value === '' || value === null ? undefined : Number(value));

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);

    try {
      const response = await payrollService.createSettlement({
        employeeId: getRowId(employee),
        trigger: form.trigger,
        ...(form.lastWorkingDate ? { lastWorkingDate: form.lastWorkingDate } : {}),
        ...(form.resignationDate ? { resignationDate: form.resignationDate } : {}),
        ...(form.lastPaidUpto ? { lastPaidUpto: form.lastPaidUpto } : {}),
        exitReason: form.exitReason.trim() || null,
        rehireEligible: form.rehireEligible,

        notice: {
          requiredDays: numeric(form.requiredDays),
          servedDays: numeric(form.servedDays),
          waivedDays: numeric(form.waivedDays),
          employerWaived: form.employerWaived,
        },

        leave: {
          encashableDays: numeric(form.encashableDays),
          excessDays: numeric(form.excessDays),
        },

        extras: {
          bonus: numeric(form.bonus),
          incentive: numeric(form.incentive),
          arrears: numeric(form.arrears),
          reimbursement: numeric(form.reimbursement),
        },

        remarks: form.remarks.trim() || null,
      });

      onSaved('Settlement created', response.data);
    } catch (rejection) {
      setError(rejection?.message ?? 'The settlement could not be created');
    } finally {
      setSubmitting(false);
    }
  };

  const money = (label, field, helper = null) => (
    <Grid size={{ xs: 12, sm: 6, md: 3 }}>
      <TextField
        label={label}
        type="number"
        value={form[field]}
        onChange={set(field)}
        fullWidth
        size="small"
        helperText={helper}
        slotProps={{
          input: {
            startAdornment: <CurrencyAdornment />,
            inputProps: { min: 0 },
          },
        }}
      />
    </Grid>
  );

  const days = (label, field, helper = null) => (
    <Grid size={{ xs: 12, sm: 6, md: 3 }}>
      <TextField
        label={label}
        type="number"
        value={form[field]}
        onChange={set(field)}
        fullWidth
        size="small"
        helperText={helper}
        slotProps={{ input: { inputProps: { min: 0, max: 365 } } }}
      />
    </Grid>
  );

  return (
    <FormDialog
      open={open}
      title="Open a settlement"
      subtitle="Facts of the exit — every figure is calculated by the server"
      error={error}
      submitting={submitting}
      submitLabel="Create settlement"
      disabled={!employee}
      onSubmit={handleSubmit}
      onClose={onClose}
      maxWidth="md"
    >
      <Grid container spacing={2} sx={{ pt: 0.5 }}>
        <Grid size={{ xs: 12, sm: 8 }}>
          <EmployeePicker value={employee} onChange={setEmployee} label="Employee" size="medium" required />
        </Grid>

        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField select label="Trigger" value={form.trigger} onChange={set('trigger')} fullWidth>
            {SETTLEMENT_TRIGGERS.map((trigger) => (
              <MenuItem key={trigger} value={trigger}>
                {humanize(trigger)}
              </MenuItem>
            ))}
          </TextField>
        </Grid>

        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField
            label="Last working date"
            type="date"
            value={form.lastWorkingDate}
            onChange={set('lastWorkingDate')}
            fullWidth
            size="small"
            helperText="Blank uses the employee record"
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </Grid>

        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField
            label="Resignation date"
            type="date"
            value={form.resignationDate}
            onChange={set('resignationDate')}
            fullWidth
            size="small"
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </Grid>

        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField
            label="Salary paid up to"
            type="date"
            value={form.lastPaidUpto}
            onChange={set('lastPaidUpto')}
            fullWidth
            size="small"
            helperText="Drives pending salary"
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </Grid>

        <Grid size={12}>
          <Divider sx={{ my: 1 }}>
            <Typography variant="caption" color="text.secondary">
              Notice period
            </Typography>
          </Divider>
        </Grid>

        {days('Required days', 'requiredDays', 'Per contract')}
        {days('Served days', 'servedDays')}
        {days('Waived days', 'waivedDays')}

        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <FormControlLabel
            control={<Switch checked={form.employerWaived} onChange={set('employerWaived')} />}
            label="Employer waived"
          />
        </Grid>

        <Grid size={12}>
          <Divider sx={{ my: 1 }}>
            <Typography variant="caption" color="text.secondary">
              Leave
            </Typography>
          </Divider>
        </Grid>

        {days('Encashable days', 'encashableDays', 'Balance to pay out — capped at the statutory 28-day cycle')}
        {days('Excess days taken', 'excessDays', 'Recovered')}

        <Grid size={12}>
          <Divider sx={{ my: 1 }}>
            <Typography variant="caption" color="text.secondary">
              Additional amounts
            </Typography>
          </Divider>
        </Grid>

        {money('Bonus', 'bonus')}
        {money('Incentive', 'incentive')}
        {money('Arrears', 'arrears')}
        {money('Reimbursement', 'reimbursement')}

        <Grid size={12}>
          <TextField
            label="Exit reason"
            value={form.exitReason}
            onChange={set('exitReason')}
            fullWidth
            size="small"
            multiline
            rows={2}
          />
        </Grid>

        <Grid size={{ xs: 12, sm: 8 }}>
          <TextField label="Remarks" value={form.remarks} onChange={set('remarks')} fullWidth size="small" />
        </Grid>

        <Grid size={{ xs: 12, sm: 4 }}>
          <FormControlLabel
            control={<Switch checked={form.rehireEligible} onChange={set('rehireEligible')} />}
            label="Eligible for rehire"
          />
        </Grid>
      </Grid>
    </FormDialog>
  );
};

export default SettlementFormDialog;
