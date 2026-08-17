import { useState } from 'react';
import { useNavigate, useLocation, Navigate, Link as RouterLink } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import VisibilityIcon from '@mui/icons-material/VisibilityOutlined';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOffOutlined';

import useAuth from '@hooks/useAuth.js';
import { PATHS } from '@routes/paths.js';

const LoginPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { signIn, isLoading, isAuthenticated, bootstrapped } = useAuth();

  const [form, setForm] = useState({ email: '', password: '', rememberMe: false });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(null);

  // Where the guard bounced them from, so a deep link survives the detour.
  const from = location.state?.from?.pathname ?? PATHS.dashboard;

  if (bootstrapped && isAuthenticated) return <Navigate to={from} replace />;

  const update = (field) => (event) =>
    setForm((previous) => ({
      ...previous,
      [field]: field === 'rememberMe' ? event.target.checked : event.target.value,
    }));

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);

    try {
      await signIn(form);
      navigate(from, { replace: true });
    } catch (rejection) {
      // The API deliberately returns one message for every credential failure;
      // showing it verbatim keeps the client from inventing a distinction.
      setError(rejection?.message ?? 'Unable to sign in');
    }
  };

  return (
    <Box component="form" onSubmit={handleSubmit} noValidate>
      <Typography variant="h4" gutterBottom>
        Sign in
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Use your work account to continue.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Stack spacing={2}>
        <TextField
          label="Email"
          type="email"
          value={form.email}
          onChange={update('email')}
          autoComplete="username"
          size="medium"
          required
          autoFocus
        />

        <TextField
          label="Password"
          type={showPassword ? 'text' : 'password'}
          value={form.password}
          onChange={update('password')}
          autoComplete="current-password"
          size="medium"
          required
          slotProps={{
            input: {
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    onClick={() => setShowPassword((previous) => !previous)}
                    edge="end"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <VisibilityOffIcon /> : <VisibilityIcon />}
                  </IconButton>
                </InputAdornment>
              ),
            },
          }}
        />

        <FormControlLabel
          control={<Checkbox checked={form.rememberMe} onChange={update('rememberMe')} />}
          label={
            <Stack>
              <Typography variant="body2">Keep me signed in</Typography>
              <Typography variant="caption" color="text.secondary">
                Avoid on a shared computer
              </Typography>
            </Stack>
          }
        />

        <Button type="submit" variant="contained" size="large" disabled={isLoading} fullWidth>
          {isLoading ? 'Signing in…' : 'Sign in'}
        </Button>

        <Link component={RouterLink} to={PATHS.auth.forgotPassword} variant="body2" sx={{ alignSelf: 'center' }}>
          Forgot your password?
        </Link>
      </Stack>
    </Box>
  );
};

export default LoginPage;
