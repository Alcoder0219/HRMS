import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import SaveIcon from '@mui/icons-material/SaveOutlined';

import PageHeader from '@components/common/PageHeader.jsx';
import { FormSwitch, FormTextField, FormSelect } from '@components/form/FormFields.jsx';
import { CardSkeleton } from '@components/common/Skeletons.jsx';
import adminService from '@services/modules/admin.service.js';
import { useToast } from '@contexts/ToastContext.jsx';
import { PATHS } from '@routes/paths.js';

/**
 * Which events send mail.
 *
 * Grouped by module, because the person turning payroll notifications off is
 * rarely the person thinking about interview invitations.
 */
const GROUPS = [
  {
    title: 'Leave',
    switches: [
      ['leaveRequested', 'A leave request is submitted', 'Goes to the approver'],
      ['leaveDecided', 'A leave request is approved or rejected', 'Goes to the employee'],
    ],
  },
  {
    title: 'Attendance',
    switches: [
      ['attendanceMissing', 'A punch is missing', 'Daily, to the employee'],
      ['regularizationRaised', 'A regularisation is raised', 'Goes to the approver'],
    ],
  },
  {
    title: 'Payroll',
    switches: [
      ['payslipPublished', 'A payslip is published', 'Goes to the employee'],
      ['loanDecided', 'A loan is approved or rejected', 'Goes to the applicant'],
      ['settlementApproved', 'A settlement is approved', 'Goes to the leaver'],
    ],
  },
  {
    title: 'Recruitment',
    switches: [
      ['offerSent', 'An offer is sent', 'Goes to the candidate'],
      ['interviewScheduled', 'An interview is scheduled', 'Goes to the panel and the candidate'],
    ],
  },
  {
    title: 'Security',
    switches: [
      ['accountLocked', 'An account is locked out', 'Goes to the account holder'],
      ['passwordChanged', 'A password changes', 'Goes to the account holder'],
    ],
  },
];

const HOURS = Array.from({ length: 24 }, (_, hour) => ({
  value: hour,
  label: `${String(hour).padStart(2, '0')}:00`,
}));

const NotificationSettingsPage = () => {
  const [form, setForm] = useState(null);
  const [original, setOriginal] = useState(null);
  const [recipients, setRecipients] = useState('');
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const toast = useToast();

  const load = () => {
    setLoading(true);

    adminService
      .getSettings()
      .then((response) => {
        const notifications = response.data?.notifications ?? {};
        setForm(notifications);
        setOriginal(notifications);
        setRecipients((notifications.adminRecipients ?? []).join(', '));
        setEmailEnabled(
          Boolean(response.data?.email?.enabled) || Boolean(response.data?.email?.environmentFallback?.configured),
        );
      })
      .catch((rejection) => setError(rejection?.message ?? 'Could not load notification settings'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const toggle = (key) => (checked) => setForm((previous) => ({ ...previous, [key]: checked }));

  const parsedRecipients = recipients
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  const dirty =
    form &&
    original &&
    (Object.keys(form).some((key) => key !== 'adminRecipients' && form[key] !== original[key]) ||
      parsedRecipients.join(',') !== (original.adminRecipients ?? []).join(','));

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    try {
      const payload = { ...form, adminRecipients: parsedRecipients };
      delete payload._id;

      const response = await adminService.updateNotifications(payload);
      setForm(response.data);
      setOriginal(response.data);
      setRecipients((response.data?.adminRecipients ?? []).join(', '));
      toast.success('Notification settings saved');
    } catch (rejection) {
      setError(rejection?.message ?? 'The settings could not be saved');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box>
      <PageHeader
        title="Notification Settings"
        subtitle="Which events send mail, and to whom"
        breadcrumbs={[{ label: 'Home', to: PATHS.dashboard }, { label: 'Administration' }, { label: 'Notifications' }]}
        actions={
          <Button size="small" variant="contained" startIcon={<SaveIcon />} onClick={handleSave} disabled={!dirty || saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        }
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Stays on the page rather than becoming a toast: it is a standing
          condition the reader needs while deciding, not the outcome of a click. */}
      {!loading && !emailEnabled && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          No mail server is configured, so nothing will actually be sent. These switches take effect once{' '}
          <strong>Email Configuration</strong> is set up.
        </Alert>
      )}

      {loading && (
        <Grid container spacing={2}>
          {GROUPS.map((group) => (
            <Grid key={group.title} size={{ xs: 12, md: 6 }}>
              <CardSkeleton lines={group.switches.length * 2} />
            </Grid>
          ))}
        </Grid>
      )}

      {!loading && form && (
        <Grid container spacing={2}>
          {GROUPS.map((group) => (
            <Grid key={group.title} size={{ xs: 12, md: 6 }}>
              <Card variant="outlined" sx={{ height: '100%' }}>
                <CardContent>
                  <Typography variant="subtitle1" gutterBottom>
                    {group.title}
                  </Typography>

                  <Stack divider={<Divider flexItem />}>
                    {group.switches.map(([key, label, caption]) => (
                      <Box key={key} sx={{ py: 0.5 }}>
                        <FormSwitch value={form[key]} onChange={toggle(key)} label={label} caption={caption} />
                      </Box>
                    ))}
                  </Stack>
                </CardContent>
              </Card>
            </Grid>
          ))}

          <Grid size={12}>
            <Card variant="outlined">
              <CardContent>
                <Typography variant="subtitle1" gutterBottom>
                  Administrators copied on everything
                </Typography>

                <Grid container spacing={2} alignItems="flex-start">
                  <Grid size={{ xs: 12, md: 8 }}>
                    <FormTextField
                      label="Email addresses"
                      placeholder="ops@example.com, hr@example.com"
                      value={recipients}
                      onChange={setRecipients}
                      helperText="Comma separated, up to ten."
                    />

                    {parsedRecipients.length > 0 && (
                      <Stack direction="row" spacing={0.5} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
                        {parsedRecipients.map((address) => (
                          <Chip key={address} label={address} size="small" variant="outlined" />
                        ))}
                      </Stack>
                    )}
                  </Grid>

                  <Grid size={{ xs: 12, md: 4 }}>
                    <FormSelect
                      label="Daily digest"
                      value={form.dailyDigestHour ?? ''}
                      onChange={(value) =>
                        setForm((previous) => ({
                          ...previous,
                          dailyDigestHour: value === '' ? null : Number(value),
                        }))
                      }
                      options={HOURS}
                      emptyLabel="Off"
                      helperText="A single summary instead of one mail per event."
                    />
                  </Grid>
                </Grid>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}
    </Box>
  );
};

export default NotificationSettingsPage;
