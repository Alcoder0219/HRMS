import { useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import FormDialog from '@components/common/FormDialog.jsx';
import EmployeePicker from '@components/common/EmployeePicker.jsx';
import CurrencyAdornment from '@components/common/CurrencyAdornment.jsx';
import payrollService from '@services/modules/payroll.service.js';
import { formatCurrency, humanize } from '@utils/format.js';
import { getRowId } from '@utils/dataGrid.js';

export const LOAN_TYPES = ['PERSONAL', 'SALARY_ADVANCE', 'EMERGENCY', 'VEHICLE', 'HOUSING', 'OTHER'];

const MONTHS = Array.from({ length: 12 }, (_, index) => ({
  value: index + 1,
  label: new Date(2000, index).toLocaleString([], { month: 'long' }),
}));

const now = new Date();
const YEARS = Array.from({ length: 4 }, (_, index) => now.getFullYear() + index);

const EMPTY = {
  type: 'PERSONAL',
  principal: '',
  interestRate: '0',
  tenureMonths: '12',
  recoveryStartYear: now.getFullYear(),
  recoveryStartMonth: now.getMonth() + 2 > 12 ? 1 : now.getMonth() + 2,
  purpose: '',
};

/**
 * Raise a loan or salary advance.
 *
 * The EMI shown is a preview only. The server recomputes it and builds the
 * instalment schedule from its own arithmetic -- a figure the browser derived
 * must never be what gets recovered from someone's salary.
 */
const LoanFormDialog = ({ open, onClose, onSaved }) => {
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

  const set = (field) => (event) => setForm((previous) => ({ ...previous, [field]: event.target.value }));

  /** Flat-rate preview: principal plus simple interest over the tenure. */
  const preview = useMemo(() => {
    const principal = Number(form.principal) || 0;
    const rate = Number(form.interestRate) || 0;
    const months = Number(form.tenureMonths) || 0;

    if (!principal || !months) return null;

    const interest = (principal * rate * (months / 12)) / 100;
    const payable = principal + interest;

    return { interest, payable, emi: payable / months };
  }, [form.principal, form.interestRate, form.tenureMonths]);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);

    try {
      await payrollService.createLoan({
        employeeId: getRowId(employee),
        type: form.type,
        principal: Number(form.principal),
        interestRate: Number(form.interestRate) || 0,
        tenureMonths: Number(form.tenureMonths),
        recoveryStartYear: Number(form.recoveryStartYear),
        recoveryStartMonth: Number(form.recoveryStartMonth),
        purpose: form.purpose.trim() || null,
      });

      onSaved('Loan raised and sent for approval');
    } catch (rejection) {
      setError(rejection?.message ?? 'The loan could not be raised');
    } finally {
      setSubmitting(false);
    }
  };

  const incomplete = !employee || !Number(form.principal) || !Number(form.tenureMonths);

  return (
    <FormDialog
      open={open}
      title="Raise a loan"
      subtitle="Recovered from salary in monthly instalments"
      error={error}
      submitting={submitting}
      submitLabel="Raise loan"
      disabled={incomplete}
      onSubmit={handleSubmit}
      onClose={onClose}
      maxWidth="md"
    >
      <Grid container spacing={2} sx={{ pt: 0.5 }}>
        <Grid size={{ xs: 12, sm: 8 }}>
          <EmployeePicker value={employee} onChange={setEmployee} label="Employee" size="medium" required />
        </Grid>

        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField select label="Type" value={form.type} onChange={set('type')} fullWidth>
            {LOAN_TYPES.map((type) => (
              <MenuItem key={type} value={type}>
                {humanize(type)}
              </MenuItem>
            ))}
          </TextField>
        </Grid>

        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField
            label="Principal"
            type="number"
            value={form.principal}
            onChange={set('principal')}
            fullWidth
            required
            slotProps={{
              input: {
                startAdornment: <CurrencyAdornment />,
                inputProps: { min: 1 },
              },
            }}
          />
        </Grid>

        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField
            label="Interest rate"
            type="number"
            value={form.interestRate}
            onChange={set('interestRate')}
            fullWidth
            helperText="Annual, flat. 0 for interest-free"
            slotProps={{
              input: {
                endAdornment: <InputAdornment position="end">%</InputAdornment>,
                inputProps: { min: 0, max: 100, step: 0.25 },
              },
            }}
          />
        </Grid>

        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField
            label="Tenure"
            type="number"
            value={form.tenureMonths}
            onChange={set('tenureMonths')}
            fullWidth
            required
            slotProps={{
              input: {
                endAdornment: <InputAdornment position="end">months</InputAdornment>,
                inputProps: { min: 1, max: 120 },
              },
            }}
          />
        </Grid>

        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            select
            label="Recovery starts — month"
            value={form.recoveryStartMonth}
            onChange={set('recoveryStartMonth')}
            fullWidth
          >
            {MONTHS.map((month) => (
              <MenuItem key={month.value} value={month.value}>
                {month.label}
              </MenuItem>
            ))}
          </TextField>
        </Grid>

        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField select label="Year" value={form.recoveryStartYear} onChange={set('recoveryStartYear')} fullWidth>
            {YEARS.map((year) => (
              <MenuItem key={year} value={year}>
                {year}
              </MenuItem>
            ))}
          </TextField>
        </Grid>

        <Grid size={12}>
          <TextField label="Purpose" value={form.purpose} onChange={set('purpose')} fullWidth multiline rows={2} />
        </Grid>

        {preview && (
          <Grid size={12}>
            <Alert severity="info" icon={false}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3}>
                <Box>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Estimated EMI
                  </Typography>
                  <Typography variant="h6">{formatCurrency(preview.emi)}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Interest
                  </Typography>
                  <Typography variant="h6">{formatCurrency(preview.interest)}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Total payable
                  </Typography>
                  <Typography variant="h6">{formatCurrency(preview.payable)}</Typography>
                </Box>
              </Stack>
              <Typography variant="caption" color="text.secondary">
                Indicative. The server recalculates the schedule when the loan is approved.
              </Typography>
            </Alert>
          </Grid>
        )}
      </Grid>
    </FormDialog>
  );
};

export default LoanFormDialog;
