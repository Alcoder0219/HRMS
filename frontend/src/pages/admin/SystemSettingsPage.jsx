import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid';
import MenuItem from '@mui/material/MenuItem';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import SaveIcon from '@mui/icons-material/SaveOutlined';

import PageHeader from '@components/common/PageHeader.jsx';
import usePermissions from '@hooks/usePermissions.js';
import { RESOURCES, ACTIONS } from '@utils/permissions.js';
import payrollService from '@services/modules/payroll.service.js';
import { formatCurrency } from '@utils/format.js';
import { PATHS } from '@routes/paths.js';

const MONTHS = Array.from({ length: 12 }, (_, index) => ({
  value: index + 1,
  label: new Date(2000, index).toLocaleString([], { month: 'long' }),
}));

/**
 * Organisation-wide payroll and statutory settings.
 *
 * Every deduction in the system is priced from these numbers, which is why the
 * API gates the write on APPROVE rather than UPDATE -- changing the PF ceiling
 * silently re-prices the next run for everyone.
 */
const SystemSettingsPage = () => {
  const { can } = usePermissions();
  const canEdit = can(RESOURCES.PAYROLL, ACTIONS.APPROVE);

  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    payrollService
      .settings()
      .then((response) => setSettings(response.data))
      .catch((rejection) =>
        setNotice({ severity: 'error', message: rejection?.message ?? 'Could not load the settings' }),
      )
      .finally(() => setLoading(false));
  }, []);

  /** Nested path setter, so `pf.employeeRate` edits without clobbering `pf`. */
  const setNested = (group, field) => (event) => {
    const raw = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    const value = event.target.type === 'number' ? Number(raw) : raw;

    setSettings((previous) =>
      group
        ? { ...previous, [group]: { ...previous[group], [field]: value } }
        : { ...previous, [field]: value },
    );
  };

  const handleSave = async () => {
    setSaving(true);
    setNotice(null);

    try {
      // Only the keys the validator accepts. `monthlyWorkingHours` is stored on
      // the document but is not in upsertSettingsSchema, so sending it back
      // would fail the whole request.
      const response = await payrollService.saveSettings({
        currency: settings.currency,
        financialYearStartMonth: settings.financialYearStartMonth,
        payableDaysBasis: settings.payableDaysBasis,
        overtimeMultiplier: settings.overtimeMultiplier,
        requireAttendanceLock: settings.requireAttendanceLock,
        pf: {
          enabled: settings.pf?.enabled,
          employeeRate: settings.pf?.employeeRate,
          employerRate: settings.pf?.employerRate,
          pensionRate: settings.pf?.pensionRate,
          wageCeiling: settings.pf?.wageCeiling,
          applyCeiling: settings.pf?.applyCeiling,
          includeDaInWages: settings.pf?.includeDaInWages,
          establishmentCode: settings.pf?.establishmentCode ?? '',
        },
        esi: {
          enabled: settings.esi?.enabled,
          employeeRate: settings.esi?.employeeRate,
          employerRate: settings.esi?.employerRate,
          grossCeiling: settings.esi?.grossCeiling,
          establishmentCode: settings.esi?.establishmentCode ?? '',
        },
        professionalTax: {
          enabled: settings.professionalTax?.enabled,
          state: settings.professionalTax?.state ?? '',
          februaryAmount: settings.professionalTax?.februaryAmount,
          annualCap: settings.professionalTax?.annualCap,
        },
        incomeTax: {
          enabled: settings.incomeTax?.enabled,
          regime: settings.incomeTax?.regime,
          standardDeduction: settings.incomeTax?.standardDeduction,
          rebateLimit: settings.incomeTax?.rebateLimit,
          rebateAmount: settings.incomeTax?.rebateAmount,
          cessRate: settings.incomeTax?.cessRate,
          tanNumber: settings.incomeTax?.tanNumber ?? '',
        },
        bank: {
          format: settings.bank?.format,
          companyAccountNumber: settings.bank?.companyAccountNumber ?? '',
          companyName: settings.bank?.companyName ?? '',
          ifsc: settings.bank?.ifsc ?? '',
          debitNarration: settings.bank?.debitNarration ?? 'SALARY',
        },
      });

      setSettings(response.data);
      setNotice({ severity: 'success', message: 'Settings saved. They apply from the next payroll run.' });
    } catch (rejection) {
      setNotice({ severity: 'error', message: rejection?.message ?? 'Could not save the settings' });
    } finally {
      setSaving(false);
    }
  };

  const field = (label, group, key, { type = 'number', helper = null, width = 3, extra = {} } = {}) => (
    <Grid size={{ xs: 12, sm: 6, md: width }}>
      <TextField
        label={label}
        type={type}
        size="small"
        fullWidth
        disabled={!canEdit}
        helperText={helper}
        value={(group ? settings?.[group]?.[key] : settings?.[key]) ?? ''}
        onChange={setNested(group, key)}
        slotProps={{ input: { inputProps: extra } }}
      />
    </Grid>
  );

  const toggle = (label, group, key) => (
    <Grid size={{ xs: 12, sm: 6, md: 3 }}>
      <FormControlLabel
        control={
          <Switch
            checked={Boolean(group ? settings?.[group]?.[key] : settings?.[key])}
            onChange={setNested(group, key)}
            disabled={!canEdit}
          />
        }
        label={label}
      />
    </Grid>
  );

  const section = (title, description, children) => (
    <Card variant="outlined" sx={{ mb: 2 }}>
      <CardContent>
        <Typography variant="h6">{title}</Typography>
        <Typography variant="caption" color="text.secondary">
          {description}
        </Typography>
        <Divider sx={{ my: 2 }} />
        <Grid container spacing={2} alignItems="center">
          {children}
        </Grid>
      </CardContent>
    </Card>
  );

  if (loading) {
    return (
      <Box>
        <PageHeader title="System Settings" subtitle="Loading…" />
      </Box>
    );
  }

  if (!settings) {
    return (
      <Box>
        <PageHeader
          title="System Settings"
          breadcrumbs={[{ label: 'Home', to: PATHS.dashboard }, { label: 'Administration' }, { label: 'Settings' }]}
        />
        <Alert severity="info">
          No payroll settings have been configured. Statutory calculations fall back to the built-in
          statutory defaults until they are.
        </Alert>
      </Box>
    );
  }

  return (
    <Box>
      <PageHeader
        title="System Settings"
        subtitle="Statutory rates and payroll defaults for the organisation"
        breadcrumbs={[
          { label: 'Home', to: PATHS.dashboard },
          { label: 'Administration' },
          { label: 'System Settings' },
        ]}
        actions={
          canEdit && (
            <Button variant="contained" startIcon={<SaveIcon />} onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save settings'}
            </Button>
          )
        }
      />

      {notice && (
        <Alert severity={notice.severity} sx={{ mb: 2 }} onClose={() => setNotice(null)}>
          {notice.message}
        </Alert>
      )}

      {!canEdit && (
        <Alert severity="info" sx={{ mb: 2 }}>
          You can read these settings. Changing them needs payroll approval rights, because every
          deduction in the system is priced from them.
        </Alert>
      )}

      {section(
        'General',
        'Currency, financial year and how a payable day is counted.',
        <>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <TextField
              select
              size="small"
              fullWidth
              label="Financial year starts"
              value={settings.financialYearStartMonth ?? 4}
              onChange={setNested(null, 'financialYearStartMonth')}
              disabled={!canEdit}
            >
              {MONTHS.map((month) => (
                <MenuItem key={month.value} value={month.value}>
                  {month.label}
                </MenuItem>
              ))}
            </TextField>
          </Grid>

          {field('Currency', null, 'currency', { type: 'text', extra: { maxLength: 3 } })}

          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <TextField
              select
              size="small"
              fullWidth
              label="Payable days basis"
              value={settings.payableDaysBasis ?? 'CALENDAR'}
              onChange={setNested(null, 'payableDaysBasis')}
              disabled={!canEdit}
            >
              <MenuItem value="CALENDAR">Calendar days</MenuItem>
              <MenuItem value="WORKING">Working days</MenuItem>
            </TextField>
          </Grid>

          {field('Overtime multiplier', null, 'overtimeMultiplier', {
            helper: 'Organisation default',
            extra: { min: 1, max: 4, step: 0.25 },
          })}

          {toggle('Require attendance lock before payroll', null, 'requireAttendanceLock')}

          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <TextField
              label="Monthly working hours"
              size="small"
              fullWidth
              value={settings.monthlyWorkingHours ?? ''}
              slotProps={{ input: { readOnly: true } }}
              helperText="Read-only here — the divisor for hourly rates"
            />
          </Grid>
        </>,
      )}

      {section(
        'Provident fund',
        'Rates, the wage ceiling and whether it is applied.',
        <>
          {toggle('PF enabled', 'pf', 'enabled')}
          {field('Employee rate %', 'pf', 'employeeRate', { extra: { min: 0, max: 100, step: 0.01 } })}
          {field('Employer rate %', 'pf', 'employerRate', { extra: { min: 0, max: 100, step: 0.01 } })}
          {field('Pension rate %', 'pf', 'pensionRate', { extra: { min: 0, max: 100, step: 0.01 } })}
          {field('Wage ceiling', 'pf', 'wageCeiling', {
            helper: formatCurrency(settings.pf?.wageCeiling),
            extra: { min: 0 },
          })}
          {toggle('Apply the ceiling', 'pf', 'applyCeiling')}
          {toggle('Include DA in PF wages', 'pf', 'includeDaInWages')}
          {field('Establishment code', 'pf', 'establishmentCode', { type: 'text' })}
        </>,
      )}

      {section(
        'ESI',
        'Rates and the gross ceiling above which ESI stops applying.',
        <>
          {toggle('ESI enabled', 'esi', 'enabled')}
          {field('Employee rate %', 'esi', 'employeeRate', { extra: { min: 0, max: 100, step: 0.01 } })}
          {field('Employer rate %', 'esi', 'employerRate', { extra: { min: 0, max: 100, step: 0.01 } })}
          {field('Gross ceiling', 'esi', 'grossCeiling', {
            helper: formatCurrency(settings.esi?.grossCeiling),
            extra: { min: 0 },
          })}
          {field('Establishment code', 'esi', 'establishmentCode', { type: 'text' })}
        </>,
      )}

      {section(
        'Professional tax',
        `State slabs are managed through the API. ${settings.professionalTax?.slabs?.length ?? 0} slab(s) configured.`,
        <>
          {toggle('PT enabled', 'professionalTax', 'enabled')}
          {field('State', 'professionalTax', 'state', { type: 'text' })}
          {field('February amount', 'professionalTax', 'februaryAmount', { extra: { min: 0 } })}
          {field('Annual cap', 'professionalTax', 'annualCap', { extra: { min: 0 } })}
        </>,
      )}

      {section(
        'Income tax',
        `Slab table is managed through the API. ${settings.incomeTax?.slabs?.length ?? 0} slab(s) configured.`,
        <>
          {toggle('TDS enabled', 'incomeTax', 'enabled')}
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <TextField
              select
              size="small"
              fullWidth
              label="Default regime"
              value={settings.incomeTax?.regime ?? 'NEW'}
              onChange={setNested('incomeTax', 'regime')}
              disabled={!canEdit}
            >
              <MenuItem value="NEW">New regime</MenuItem>
              <MenuItem value="OLD">Old regime</MenuItem>
            </TextField>
          </Grid>
          {field('Standard deduction', 'incomeTax', 'standardDeduction', { extra: { min: 0 } })}
          {field('Rebate limit', 'incomeTax', 'rebateLimit', { extra: { min: 0 } })}
          {field('Rebate amount', 'incomeTax', 'rebateAmount', { extra: { min: 0 } })}
          {field('Cess %', 'incomeTax', 'cessRate', { extra: { min: 0, max: 100, step: 0.1 } })}
          {field('TAN', 'incomeTax', 'tanNumber', { type: 'text' })}
        </>,
      )}

      {section(
        'Bank transfer file',
        'How the payment instruction is written for the bank.',
        <>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <TextField
              select
              size="small"
              fullWidth
              label="Format"
              value={settings.bank?.format ?? 'GENERIC_CSV'}
              onChange={setNested('bank', 'format')}
              disabled={!canEdit}
            >
              {/* Mirrors BANK_FILE_FORMATS in backend/utils/constants.js —
                  an extra bank here would fail validation, not add support. */}
              <MenuItem value="GENERIC_CSV">Generic CSV</MenuItem>
              <MenuItem value="HDFC">HDFC</MenuItem>
              <MenuItem value="ICICI">ICICI</MenuItem>
              <MenuItem value="SBI">SBI</MenuItem>
            </TextField>
          </Grid>
          {field('Company name', 'bank', 'companyName', { type: 'text' })}
          {field('Company account number', 'bank', 'companyAccountNumber', { type: 'text' })}
          {field('IFSC', 'bank', 'ifsc', { type: 'text' })}
          {field('Debit narration', 'bank', 'debitNarration', { type: 'text' })}
        </>,
      )}
    </Box>
  );
};

export default SystemSettingsPage;
