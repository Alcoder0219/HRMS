import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import SaveIcon from '@mui/icons-material/SaveOutlined';
import SendIcon from '@mui/icons-material/SendOutlined';

import PageHeader from '@components/common/PageHeader.jsx';
import { FormTextField, FormNumberField, FormSwitch } from '@components/form/FormFields.jsx';
import { CardSkeleton } from '@components/common/Skeletons.jsx';
import adminService from '@services/modules/admin.service.js';
import { useToast } from '@contexts/ToastContext.jsx';
import { formatDateTime } from '@utils/format.js';
import { PATHS } from '@routes/paths.js';

const MASK = '********';

/**
 * Outbound mail.
 *
 * The stored password is never sent to the browser -- the field shows a mask,
 * and saving the mask unchanged leaves the secret alone. That is the only way
 * a form can offer "edit the other fields" without either exposing the
 * password or silently wiping it.
 */
const EmailConfigurationPage = () => {
  const [form, setForm] = useState(null);
  const [server, setServer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [error, setError] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const toast = useToast();

  const load = () => {
    setLoading(true);

    adminService
      .getSettings()
      .then((response) => {
        const email = response.data?.email ?? {};
        setServer(email);
        setForm({
          enabled: email.enabled ?? false,
          host: email.host ?? '',
          port: email.port ?? 587,
          secure: email.secure ?? false,
          username: email.username ?? '',
          password: email.passwordSet ? MASK : '',
          fromName: email.fromName ?? '',
          fromAddress: email.fromAddress ?? '',
          replyTo: email.replyTo ?? '',
        });
      })
      .catch((rejection) => setError(rejection?.message ?? 'Could not load the mail configuration'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const set = (field) => (value) => setForm((previous) => ({ ...previous, [field]: value }));

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    try {
      const payload = { ...form, port: Number(form.port) || 587 };

      // An untouched mask means "keep what is stored"; the server treats it
      // that way, and sending it back is what makes that work.
      if (payload.password === '') delete payload.password;

      const response = await adminService.updateEmail(payload);
      setServer(response.data);
      toast.success('Mail configuration saved');
    } catch (rejection) {
      setError(rejection?.message ?? 'The configuration could not be saved');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);

    try {
      const response = await adminService.testEmail(testTo ? { to: testTo } : {});
      setTestResult(response.data);

      if (response.data?.ok) toast.success(response.data.message);
      else toast.error(response.data?.message ?? 'The mail server refused the connection');
    } catch (rejection) {
      setTestResult({ ok: false, message: rejection?.message ?? 'The test could not be run' });
    } finally {
      setTesting(false);
    }
  };

  const fallback = server?.environmentFallback;

  return (
    <Box>
      <PageHeader
        title="Email Configuration"
        subtitle="The SMTP server the system sends from"
        breadcrumbs={[{ label: 'Home', to: PATHS.dashboard }, { label: 'Administration' }, { label: 'Email' }]}
        actions={
          <Button size="small" variant="contained" startIcon={<SaveIcon />} onClick={handleSave} disabled={saving || !form}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        }
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {loading && (
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 7 }}>
            <CardSkeleton lines={8} />
          </Grid>
          <Grid size={{ xs: 12, md: 5 }}>
            <CardSkeleton lines={4} />
          </Grid>
        </Grid>
      )}

      {!loading && form && (
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 7 }}>
            <Card variant="outlined">
              <CardContent>
                <Typography variant="subtitle1" gutterBottom>
                  Server
                </Typography>

                <Box sx={{ mb: 1 }}>
                  <FormSwitch value={form.enabled} onChange={set('enabled')} label="Send mail using these settings" />
                </Box>

                {!form.enabled && (
                  <Alert severity="info" sx={{ mb: 2 }}>
                    {fallback?.configured
                      ? `Mail is currently sent using the server environment (${fallback.host}).`
                      : 'No mail server is configured. Messages are written to the log instead of being sent.'}
                  </Alert>
                )}

                <Grid container spacing={2}>
                  <Grid size={{ xs: 12, sm: 8 }}>
                    <FormTextField label="SMTP host" value={form.host} onChange={set('host')} />
                  </Grid>

                  <Grid size={{ xs: 6, sm: 4 }}>
                    <FormNumberField label="Port" value={form.port} onChange={set('port')} min={1} max={65535} />
                  </Grid>

                  <Grid size={12}>
                    <FormSwitch
                      value={form.secure}
                      onChange={set('secure')}
                      label="Use TLS on connect"
                      caption="Port 465. Leave off for STARTTLS on 587."
                    />
                  </Grid>

                  <Grid size={{ xs: 12, sm: 6 }}>
                    <FormTextField label="Username" value={form.username} onChange={set('username')} />
                  </Grid>

                  <Grid size={{ xs: 12, sm: 6 }}>
                    <FormTextField
                      label="Password"
                      type="password"
                      value={form.password}
                      onChange={set('password')}
                      helperText={
                        server?.passwordSet
                          ? 'A password is stored. Leave the mask to keep it, or type a new one.'
                          : 'No password stored.'
                      }
                    />
                  </Grid>
                </Grid>

                <Typography variant="subtitle1" sx={{ mt: 3, mb: 1 }}>
                  Sender
                </Typography>

                <Grid container spacing={2}>
                  <Grid size={{ xs: 12, sm: 4 }}>
                    <FormTextField label="From name" value={form.fromName} onChange={set('fromName')} />
                  </Grid>

                  <Grid size={{ xs: 12, sm: 4 }}>
                    <FormTextField label="From address" value={form.fromAddress} onChange={set('fromAddress')} />
                  </Grid>

                  <Grid size={{ xs: 12, sm: 4 }}>
                    <FormTextField label="Reply-to" value={form.replyTo} onChange={set('replyTo')} />
                  </Grid>
                </Grid>
              </CardContent>
            </Card>
          </Grid>

          <Grid size={{ xs: 12, md: 5 }}>
            <Card variant="outlined">
              <CardContent>
                <Typography variant="subtitle1" gutterBottom>
                  Test the connection
                </Typography>

                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  Save first — the test uses the stored settings. Leave the address empty to check the connection
                  without sending anything.
                </Typography>

                <Stack spacing={1.5}>
                  <FormTextField
                    label="Send a test message to (optional)"
                    value={testTo}
                    onChange={setTestTo}
                    type="email"
                  />

                  <Button
                    variant="outlined"
                    startIcon={<SendIcon />}
                    onClick={handleTest}
                    disabled={testing || !server?.host}
                  >
                    {testing ? 'Testing…' : 'Run test'}
                  </Button>
                </Stack>

                {/* The result stays on the page as well as raising a toast: it
                    is diagnostic output someone will want to re-read. */}
                {testResult && (
                  <Alert severity={testResult.ok ? 'success' : 'error'} sx={{ mt: 2 }}>
                    <AlertTitle>{testResult.ok ? 'Connection succeeded' : 'Connection failed'}</AlertTitle>
                    {testResult.message}
                  </Alert>
                )}

                {server?.lastTestedAt && !testResult && (
                  <Stack direction="row" spacing={1} sx={{ mt: 2 }} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Chip
                      size="small"
                      color={server.lastTestOk ? 'success' : 'error'}
                      label={server.lastTestOk ? 'Last test passed' : 'Last test failed'}
                    />
                    <Typography variant="caption" color="text.secondary">
                      {formatDateTime(server.lastTestedAt)}
                    </Typography>
                    {server.lastTestError && (
                      <Typography variant="caption" color="error.main" sx={{ width: '100%' }}>
                        {server.lastTestError}
                      </Typography>
                    )}
                  </Stack>
                )}
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}
    </Box>
  );
};

export default EmailConfigurationPage;
