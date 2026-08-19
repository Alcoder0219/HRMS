import { Fragment, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CalculateIcon from '@mui/icons-material/CalculateOutlined';

import FormDialog from '@components/common/FormDialog.jsx';
import CurrencyAdornment from '@components/common/CurrencyAdornment.jsx';
import payrollService from '@services/modules/payroll.service.js';
import { formatCurrency } from '@utils/format.js';

const today = () => new Date().toISOString().slice(0, 10);

/** The component fields, in the order the payslip states them. */
const COMPONENTS = [
  { key: 'basic', label: 'Basic' },
  { key: 'hraAllowance', label: 'HRA' },
  { key: 'foodAllowance', label: 'Food' },
  { key: 'transportationAllowance', label: 'Transportation' },
  { key: 'communicationAllowance', label: 'Communication' },
  { key: 'mediclaim', label: 'Mediclaim' },
  { key: 'schoolFeesAllowance', label: 'School fees' },
  // Per annum by entitlement; this dialog, like the model, holds the monthly
  // twelfth so it sits alongside the other figures without being paid twelve
  // times over.
  { key: 'annualLeaveAllowance', label: 'Annual leave (monthly)' },
  { key: 'performanceIncentive', label: 'Performance incentive' },
];

const EMPTY = {
  effectiveFrom: today(),
  annualCtc: '',
  ...Object.fromEntries(COMPONENTS.map(({ key }) => [key, ''])),
  nssfApplicable: true,
  nhifApplicable: true,
  payeApplicable: true,
  overtimeEligible: true,
  overtimeMultiplier: '2',
  revisionReason: '',
};

/**
 * Sets or revises an employee's salary structure.
 *
 * Structures are effective-dated rather than overwritten: a payslip issued last
 * March must still be reproducible from the figures that applied then, so
 * saving adds a row and closes the previous one. That is why this is "revise",
 * never "edit".
 *
 * The split can be seeded from the server's own CTC preview
 * (GET /payroll/structures/preview) so the arithmetic that will price the
 * payslip is the arithmetic that filled the form.
 */
const SalaryStructureDialog = ({ open, employee, current, onClose, onSaved }) => {
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    if (!open) return;

    setError(null);
    // A revision starts from what is in force today, so only what changes has
    // to be retyped.
    setForm(
      current
        ? {
            ...EMPTY,
            effectiveFrom: today(),
            annualCtc: String(current.annualCtc ?? ''),
            ...Object.fromEntries(
              COMPONENTS.map(({ key }) => [key, String(current[key] ?? '')]),
            ),
            nssfApplicable: current.nssfApplicable ?? true,
            nhifApplicable: current.nhifApplicable ?? true,
            payeApplicable: current.payeApplicable ?? true,
            overtimeEligible: current.overtimeEligible ?? true,
            overtimeMultiplier: String(current.overtimeMultiplier ?? 2),
            revisionReason: '',
          }
        : EMPTY,
    );
  }, [open, current]);

  const set = (field) => (event) =>
    setForm((previous) => ({
      ...previous,
      [field]: event.target.type === 'checkbox' ? event.target.checked : event.target.value,
    }));

  /** Asks the server to split the CTC, rather than duplicating its formula here. */
  const runPreview = async () => {
    const annualCtc = Number(form.annualCtc);
    if (!annualCtc) return;

    setPreviewing(true);
    setError(null);

    try {
      /**
       * The server's own defaults are used -- no percentages are sent.
       *
       * Under the Tanzanian split every percentage is expressed against basic
       * and basic is solved for, so a client that named its own `basicPercent`
       * would be describing a split the server does not compute. The preview
       * exists precisely so the arithmetic that prices the payslip is the
       * arithmetic that fills this form.
       */
      const response = await payrollService.ctcPreview({ annualCtc });
      const split = response.data ?? {};

      setForm((previous) => ({
        ...previous,
        ...Object.fromEntries(
          COMPONENTS.map(({ key }) => [
            key,
            String(Math.round(Number(split[key] ?? previous[key]) || 0)),
          ]),
        ),
      }));
    } catch (rejection) {
      setError(rejection?.message ?? 'The preview could not be calculated');
    } finally {
      setPreviewing(false);
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);

    try {
      await payrollService.createStructure({
        employeeId: employee,
        effectiveFrom: form.effectiveFrom,
        annualCtc: Number(form.annualCtc),
        ...Object.fromEntries(COMPONENTS.map(({ key }) => [key, Number(form[key]) || 0])),
        nssfApplicable: form.nssfApplicable,
        nhifApplicable: form.nhifApplicable,
        payeApplicable: form.payeApplicable,
        overtimeEligible: form.overtimeEligible,
        overtimeMultiplier: Number(form.overtimeMultiplier) || 2,
        revisionReason: form.revisionReason.trim() || null,
      });

      onSaved(current ? 'Salary revised' : 'Salary structure set');
    } catch (rejection) {
      setError(rejection?.message ?? 'The structure could not be saved');
    } finally {
      setSubmitting(false);
    }
  };

  const monthly = COMPONENTS.reduce((sum, { key }) => sum + (Number(form[key]) || 0), 0);

  const expectedMonthly = (Number(form.annualCtc) || 0) / 12;
  // A gap here means the components do not add up to the CTC being promised.
  const drift = Math.abs(monthly - expectedMonthly);
  const mismatch = Number(form.annualCtc) > 0 && drift > 1;

  const money = (label, field, extra = {}) => (
    <Grid size={{ xs: 12, sm: 6, md: 3 }}>
      <TextField
        label={label}
        type="number"
        size="small"
        fullWidth
        value={form[field]}
        onChange={set(field)}
        slotProps={{
          input: {
            startAdornment: <CurrencyAdornment />,
            inputProps: { min: 0, ...extra },
          },
        }}
      />
    </Grid>
  );

  const toggle = (label, field) => (
    <Grid size={{ xs: 6, sm: 4, md: 3 }}>
      <FormControlLabel control={<Switch checked={form[field]} onChange={set(field)} />} label={label} />
    </Grid>
  );

  return (
    <FormDialog
      open={open}
      title={current ? 'Revise salary' : 'Set salary structure'}
      subtitle="Effective-dated — the previous structure is closed, not replaced"
      error={error}
      submitting={submitting}
      submitLabel={current ? 'Save revision' : 'Set structure'}
      disabled={!Number(form.annualCtc) || !Number(form.basic) || !form.effectiveFrom}
      onSubmit={handleSubmit}
      onClose={onClose}
      maxWidth="md"
    >
      <Grid container spacing={2} sx={{ pt: 0.5 }}>
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField
            label="Effective from"
            type="date"
            size="small"
            fullWidth
            required
            value={form.effectiveFrom}
            onChange={set('effectiveFrom')}
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </Grid>

        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField
            label="Annual CTC"
            type="number"
            size="small"
            fullWidth
            required
            value={form.annualCtc}
            onChange={set('annualCtc')}
            slotProps={{
              input: {
                startAdornment: <CurrencyAdornment />,
                inputProps: { min: 0 },
              },
            }}
          />
        </Grid>

        <Grid size={{ xs: 12, sm: 4 }}>
          <Button
            fullWidth
            variant="outlined"
            startIcon={<CalculateIcon />}
            onClick={runPreview}
            disabled={!Number(form.annualCtc) || previewing}
            sx={{ height: 40 }}
          >
            {previewing ? 'Calculating…' : 'Split the CTC'}
          </Button>
        </Grid>

        <Grid size={12}>
          <Divider sx={{ my: 1 }}>
            <Typography variant="caption" color="text.secondary">
              Monthly components
            </Typography>
          </Divider>
        </Grid>

        {COMPONENTS.map(({ key, label }) => (
          <Fragment key={key}>{money(label, key)}</Fragment>
        ))}

        <Grid size={12}>
          <Alert severity={mismatch ? 'warning' : 'info'} icon={false}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3}>
              <Box>
                <Typography variant="caption" color="text.secondary" display="block">
                  Components total
                </Typography>
                <Typography variant="h6">{formatCurrency(monthly)}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary" display="block">
                  Monthly CTC
                </Typography>
                <Typography variant="h6">{formatCurrency(expectedMonthly)}</Typography>
              </Box>
            </Stack>
            {mismatch && (
              <Typography variant="caption">
                The components are {formatCurrency(drift)} away from the monthly CTC. The server derives its
                own monthly figure, so this will be saved as entered.
              </Typography>
            )}
          </Alert>
        </Grid>

        <Grid size={12}>
          <Divider sx={{ my: 1 }}>
            <Typography variant="caption" color="text.secondary">
              Statutory and overtime
            </Typography>
          </Divider>
        </Grid>

        {toggle('NSSF', 'nssfApplicable')}
        {toggle('NHIF', 'nhifApplicable')}
        {toggle('PAYE', 'payeApplicable')}

        <Grid size={12}>
          <Typography variant="caption" color="text.secondary">
            SDL and WCF are levied on the employer&apos;s payroll rather than on the individual, so they have
            no per-employee switch and are never deducted from pay.
          </Typography>
        </Grid>

        {toggle('Overtime eligible', 'overtimeEligible')}

        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField
            label="Overtime multiplier"
            type="number"
            size="small"
            fullWidth
            value={form.overtimeMultiplier}
            onChange={set('overtimeMultiplier')}
            disabled={!form.overtimeEligible}
            slotProps={{ input: { inputProps: { min: 1, max: 4, step: 0.25 } } }}
          />
        </Grid>

        <Grid size={12}>
          <TextField
            label="Reason for this revision"
            size="small"
            fullWidth
            value={form.revisionReason}
            onChange={set('revisionReason')}
            helperText="Appears in the revision history"
          />
        </Grid>
      </Grid>
    </FormDialog>
  );
};

export default SalaryStructureDialog;
