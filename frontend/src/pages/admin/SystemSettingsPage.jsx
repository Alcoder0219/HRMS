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
import { PATHS } from '@routes/paths.js';
import BiometricDevicesSection from './components/BiometricDevicesSection.jsx';

const MONTHS = Array.from({ length: 12 }, (_, index) => ({
  value: index + 1,
  label: new Date(2000, index).toLocaleString([], { month: 'long' }),
}));

/**
 * Organisation-wide payroll and statutory settings.
 *
 * Every deduction in the system is priced from these numbers, which is why the
 * API gates the write on APPROVE rather than UPDATE -- changing the NSSF rate
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

  /** Nested path setter, so `nssf.employeeRate` edits without clobbering `nssf`. */
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
        nssf: {
          enabled: settings.nssf?.enabled,
          employeeRate: settings.nssf?.employeeRate,
          employerRate: settings.nssf?.employerRate,
          registrationNumber: settings.nssf?.registrationNumber ?? '',
        },
        // The band table is not sent: it is edited through the API, and posting
        // it back from a screen that does not render it would replace the
        // stored bands with whatever this page happened to be holding.
        nhif: {
          enabled: settings.nhif?.enabled,
          registrationNumber: settings.nhif?.registrationNumber ?? '',
        },
        sdl: {
          enabled: settings.sdl?.enabled,
          rate: settings.sdl?.rate,
        },
        wcf: {
          enabled: settings.wcf?.enabled,
          rate: settings.wcf?.rate,
        },
        paye: {
          enabled: settings.paye?.enabled,
          tinNumber: settings.paye?.tinNumber ?? '',
        },
        bank: {
          format: settings.bank?.format,
          companyAccountNumber: settings.bank?.companyAccountNumber ?? '',
          companyName: settings.bank?.companyName ?? '',
          swiftCode: settings.bank?.swiftCode ?? '',
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

  /**
   * A tenant with no payroll settings yet still gets the device section.
   *
   * The two are independent: biometric terminals are read through their own
   * endpoints and saved per action, and hiding them behind an unconfigured
   * payroll would make attendance hardware unreachable on a fresh install --
   * which is exactly when somebody is setting the terminals up.
   */
  if (!settings) {
    return (
      <Box>
        <PageHeader
          title="System Settings"
          breadcrumbs={[{ label: 'Home', to: PATHS.dashboard }, { label: 'Administration' }, { label: 'Settings' }]}
        />
        <Alert severity="info" sx={{ mb: 2 }}>
          No payroll settings have been configured. Statutory calculations fall back to the built-in
          statutory defaults until they are.
        </Alert>

        <BiometricDevicesSection />
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
        'NSSF',
        'Social security, charged on gross. Both sides contribute at their own rate.',
        <>
          {toggle('NSSF enabled', 'nssf', 'enabled')}
          {field('Employee rate %', 'nssf', 'employeeRate', { extra: { min: 0, max: 100, step: 0.01 } })}
          {field('Employer rate %', 'nssf', 'employerRate', { extra: { min: 0, max: 100, step: 0.01 } })}
          {field('Employer registration number', 'nssf', 'registrationNumber', { type: 'text' })}
        </>,
      )}

      {section(
        'NHIF',
        `A flat monthly amount per salary band, not a rate. The band table is managed through the API — ${settings.nhif?.slabs?.length ?? 0} band(s) configured.`,
        <>
          {toggle('NHIF enabled', 'nhif', 'enabled')}
          {field('Employer registration number', 'nhif', 'registrationNumber', { type: 'text' })}
        </>,
      )}

      {section(
        'Employer levies',
        'SDL and WCF are charged on the payroll, not on the individual — neither is ever deducted from anybody’s pay.',
        <>
          {toggle('SDL enabled', 'sdl', 'enabled')}
          {field('SDL rate %', 'sdl', 'rate', { extra: { min: 0, max: 100, step: 0.01 } })}
          {toggle('WCF enabled', 'wcf', 'enabled')}
          {field('WCF rate %', 'wcf', 'rate', { extra: { min: 0, max: 100, step: 0.01 } })}
        </>,
      )}

      {section(
        'PAYE',
        `Progressive monthly slabs, assessed month by month. The slab table is managed through the API — ${settings.paye?.slabs?.length ?? 0} slab(s) configured.`,
        <>
          {toggle('PAYE enabled', 'paye', 'enabled')}
          {field('Employer TIN', 'paye', 'tinNumber', { type: 'text', width: 4 })}
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
              <MenuItem value="CRDB">CRDB</MenuItem>
              <MenuItem value="NMB">NMB</MenuItem>
              <MenuItem value="NBC">NBC</MenuItem>
            </TextField>
          </Grid>
          {field('Company name', 'bank', 'companyName', { type: 'text' })}
          {field('Company account number', 'bank', 'companyAccountNumber', { type: 'text' })}
          {field('SWIFT code', 'bank', 'swiftCode', { type: 'text' })}
          {field('Debit narration', 'bank', 'debitNarration', { type: 'text' })}
        </>,
      )}

      {/*
        Devices own their own state and save per action, so they sit outside
        the payroll form and its Save button rather than inside `section()`.
      */}
      <BiometricDevicesSection />
    </Box>
  );
};

export default SystemSettingsPage;
