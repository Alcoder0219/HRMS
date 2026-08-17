import { useEffect, useRef, useState } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ArrowBackIcon from '@mui/icons-material/ArrowBackOutlined';

import { FormTextField } from '@components/form/FormFields.jsx';
import authService from '@services/modules/auth.service.js';
import { PATHS } from '@routes/paths.js';

/**
 * Confirms an address from the link in a verification email.
 *
 * Verification runs on arrival rather than behind a button: the user already
 * expressed intent by clicking the link, and asking them to click a second one
 * is ceremony. If the token has expired, the page turns into the resend form
 * rather than a dead end.
 */
const VerifyEmailPage = () => {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';

  const [state, setState] = useState(token ? 'verifying' : 'missing');
  const [error, setError] = useState(null);
  const [email, setEmail] = useState('');
  const [resent, setResent] = useState(false);
  const [resending, setResending] = useState(false);

  // React runs effects twice in development. Verification consumes a one-shot
  // token, so the second run would always report "already used".
  const attempted = useRef(false);

  useEffect(() => {
    if (!token || attempted.current) return;
    attempted.current = true;

    authService
      .verifyEmail(token)
      .then(() => setState('verified'))
      .catch((rejection) => {
        setError(rejection?.message ?? 'That link is no longer valid');
        setState('failed');
      });
  }, [token]);

  const handleResend = async (event) => {
    event.preventDefault();
    setResending(true);

    try {
      await authService.resendVerification(email.trim());
      setResent(true);
    } catch (rejection) {
      setError(rejection?.message ?? 'The message could not be sent');
    } finally {
      setResending(false);
    }
  };

  const backToSignIn = (
    <Button component={RouterLink} to={PATHS.auth.login} startIcon={<ArrowBackIcon />} size="small">
      Back to sign in
    </Button>
  );

  if (state === 'verifying') {
    return (
      <Stack spacing={2} alignItems="center" sx={{ py: 4 }}>
        <CircularProgress />
        <Typography variant="body2" color="text.secondary">
          Confirming your address…
        </Typography>
      </Stack>
    );
  }

  if (state === 'verified') {
    return (
      <Stack spacing={3}>
        <Alert severity="success">
          <AlertTitle>Email confirmed</AlertTitle>
          Your address is verified. You can sign in now.
        </Alert>

        <Button component={RouterLink} to={PATHS.auth.login} variant="contained" size="large">
          Go to sign in
        </Button>
      </Stack>
    );
  }

  return (
    <Box component="form" onSubmit={handleResend}>
      <Stack spacing={3}>
        <Alert severity={state === 'missing' ? 'warning' : 'error'}>
          <AlertTitle>{state === 'missing' ? 'That link is not complete' : 'That link did not work'}</AlertTitle>
          {state === 'missing'
            ? 'It is missing its verification token. Copy the whole link out of the email.'
            : error}
        </Alert>

        {resent ? (
          <Alert severity="success">
            If <strong>{email.trim()}</strong> is waiting to be verified, a new link is on its way.
          </Alert>
        ) : (
          <>
            <Typography variant="body2" color="text.secondary">
              Send yourself a fresh link:
            </Typography>

            <FormTextField label="Email address" type="email" value={email} onChange={setEmail} size="medium" required />

            <Button type="submit" variant="contained" disabled={resending || !email.trim()}>
              {resending ? 'Sending…' : 'Send a new link'}
            </Button>
          </>
        )}

        {backToSignIn}
      </Stack>
    </Box>
  );
};

export default VerifyEmailPage;
