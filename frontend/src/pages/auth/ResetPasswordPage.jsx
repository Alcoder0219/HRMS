import { useState } from 'react';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ArrowBackIcon from '@mui/icons-material/ArrowBackOutlined';

import { FormTextField } from '@components/form/FormFields.jsx';
import authService from '@services/modules/auth.service.js';
import { PATHS } from '@routes/paths.js';

/**
 * The same rule the server enforces, so the failure is shown while typing
 * rather than after a round trip.
 */
const RULES = [
  { test: (value) => value.length >= 10, label: 'At least 10 characters' },
  { test: (value) => /[a-z]/.test(value), label: 'A lowercase letter' },
  { test: (value) => /[A-Z]/.test(value), label: 'An uppercase letter' },
  { test: (value) => /[0-9]/.test(value), label: 'A digit' },
];

/**
 * Consumes the token from a reset email and sets a new password.
 *
 * The token arrives in the query string because that is what the mailer puts
 * in the link. A missing or malformed one is reported here rather than on
 * submit -- there is no point offering a form that cannot succeed.
 */
const ResetPasswordPage = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const token = params.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  const unmet = RULES.filter((rule) => !rule.test(password));
  const mismatch = confirm.length > 0 && confirm !== password;
  const ready = token && unmet.length === 0 && confirm === password;

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      await authService.resetPassword({ token, newPassword: password, confirmPassword: confirm });
      setDone(true);
      // Long enough to read the confirmation, short enough not to feel stuck.
      setTimeout(() => navigate(PATHS.auth.login), 2500);
    } catch (rejection) {
      setError(rejection?.message ?? 'The password could not be reset. The link may have expired.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!token) {
    return (
      <Stack spacing={3}>
        <Alert severity="error">
          <AlertTitle>That link is not complete</AlertTitle>
          It is missing its reset token. Copy the whole link out of the email, or request a new one.
        </Alert>

        <Button component={RouterLink} to={PATHS.auth.forgotPassword} variant="contained">
          Request a new link
        </Button>

        <Button component={RouterLink} to={PATHS.auth.login} startIcon={<ArrowBackIcon />} size="small">
          Back to sign in
        </Button>
      </Stack>
    );
  }

  if (done) {
    return (
      <Stack spacing={3}>
        <Alert severity="success">
          <AlertTitle>Password changed</AlertTitle>
          Every device signed in as this account has been signed out. Taking you to the sign-in page…
        </Alert>
        <LinearProgress />
      </Stack>
    );
  }

  return (
    <Box component="form" onSubmit={handleSubmit}>
      <Stack spacing={3}>
        <Box>
          <Typography variant="h5" fontWeight={600}>
            Choose a new password
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Signing in anywhere else will need the new password.
          </Typography>
        </Box>

        {error && <Alert severity="error">{error}</Alert>}

        <FormTextField
          label="New password"
          type="password"
          value={password}
          onChange={setPassword}
          autoFocus
          required
          size="medium"
        />

        <FormTextField
          label="Confirm new password"
          type="password"
          value={confirm}
          onChange={setConfirm}
          required
          size="medium"
          error={mismatch ? 'The two passwords do not match' : null}
        />

        {password.length > 0 && unmet.length > 0 && (
          <Alert severity="info" sx={{ py: 0.5 }}>
            Still needed: {unmet.map((rule) => rule.label.toLowerCase()).join(', ')}
          </Alert>
        )}

        <Button type="submit" variant="contained" size="large" disabled={!ready || submitting}>
          {submitting ? 'Saving…' : 'Set new password'}
        </Button>

        <Button component={RouterLink} to={PATHS.auth.login} startIcon={<ArrowBackIcon />} size="small">
          Back to sign in
        </Button>
      </Stack>
    </Box>
  );
};

export default ResetPasswordPage;
