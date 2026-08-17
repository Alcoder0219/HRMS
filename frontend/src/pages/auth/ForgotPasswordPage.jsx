import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ArrowBackIcon from '@mui/icons-material/ArrowBackOutlined';

import { FormTextField } from '@components/form/FormFields.jsx';
import authService from '@services/modules/auth.service.js';
import { PATHS } from '@routes/paths.js';

const looksLikeEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

/**
 * Requests a password reset link.
 *
 * The response is deliberately the same whether or not the address has an
 * account. Saying "no such user" here turns the form into a way to discover
 * which of a list of addresses are registered, which is exactly what an
 * attacker wants before trying passwords.
 */
const ForgotPasswordPage = () => {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      await authService.forgotPassword(email.trim());
      setSent(true);
    } catch (rejection) {
      // A rate limit or an outage is worth showing; a rejected address is not,
      // and the API does not distinguish them either.
      setError(rejection?.message ?? 'The request could not be sent. Try again in a moment.');
    } finally {
      setSubmitting(false);
    }
  };

  if (sent) {
    return (
      <Stack spacing={3}>
        <Alert severity="success">
          <AlertTitle>Check your email</AlertTitle>
          If <strong>{email.trim()}</strong> has an account, a reset link is on its way. The link is valid for a
          limited time and can be used once.
        </Alert>

        <Typography variant="body2" color="text.secondary">
          Nothing arrived? Check the spam folder, then{' '}
          <Link component="button" type="button" onClick={() => setSent(false)}>
            try a different address
          </Link>
          .
        </Typography>

        <Button component={RouterLink} to={PATHS.auth.login} startIcon={<ArrowBackIcon />}>
          Back to sign in
        </Button>
      </Stack>
    );
  }

  return (
    <Box component="form" onSubmit={handleSubmit}>
      <Stack spacing={3}>
        <Box>
          <Typography variant="h5" fontWeight={600}>
            Forgot your password?
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Enter the address you sign in with and we will send a link to set a new password.
          </Typography>
        </Box>

        {error && <Alert severity="error">{error}</Alert>}

        <FormTextField
          label="Email address"
          type="email"
          value={email}
          onChange={setEmail}
          autoFocus
          required
          size="medium"
        />

        <Button type="submit" variant="contained" size="large" disabled={submitting || !looksLikeEmail(email)}>
          {submitting ? 'Sending…' : 'Send reset link'}
        </Button>

        <Button component={RouterLink} to={PATHS.auth.login} startIcon={<ArrowBackIcon />} size="small">
          Back to sign in
        </Button>
      </Stack>
    </Box>
  );
};

export default ForgotPasswordPage;
