import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import LockIcon from '@mui/icons-material/LockResetOutlined';

import PageHeader from '@components/common/PageHeader.jsx';
import { FormTextField } from '@components/form/FormFields.jsx';
import { useToast } from '@contexts/ToastContext.jsx';
import { useAppDispatch, useAppSelector } from '@hooks/useRedux.js';
import { fetchCurrentUser, selectCurrentUser } from '@redux/slices/authSlice.js';
import authService from '@services/modules/auth.service.js';
import { PATHS } from '@routes/paths.js';

const RULES = [
  { test: (value) => value.length >= 10, label: 'At least 10 characters' },
  { test: (value) => /[a-z]/.test(value), label: 'A lowercase letter' },
  { test: (value) => /[A-Z]/.test(value), label: 'An uppercase letter' },
  { test: (value) => /[0-9]/.test(value), label: 'A digit' },
];

/**
 * Changes the signed-in account's own password.
 *
 * This screen is what makes `mustChangePassword` survivable. The API refuses
 * every route except `/auth/*` while that flag is set, so an account created
 * with a temporary password had no way forward at all until this existed --
 * it could sign in and then get a 403 on everything, including the dashboard.
 */
const ChangePasswordPage = () => {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const toast = useToast();
  const user = useAppSelector(selectCurrentUser);

  const forced = Boolean(user?.mustChangePassword);

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const unmet = RULES.filter((rule) => !rule.test(next));
  const mismatch = confirm.length > 0 && confirm !== next;
  const reused = next.length > 0 && next === current;
  const ready = current && unmet.length === 0 && confirm === next && !reused;

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      await authService.changePassword({
        currentPassword: current,
        newPassword: next,
        confirmPassword: confirm,
      });

      // The flag is cleared server-side; refreshing the session is what lets
      // the rest of the app become reachable again without a sign-out.
      await dispatch(fetchCurrentUser());

      toast.success('Password changed. Other devices have been signed out.');
      navigate(PATHS.dashboard);
    } catch (rejection) {
      setError(rejection?.message ?? 'The password could not be changed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box>
      <PageHeader
        title="Change Password"
        subtitle="Choose a new password for your account"
        breadcrumbs={forced ? [] : [{ label: 'Home', to: PATHS.dashboard }, { label: 'Change Password' }]}
      />

      {forced && (
        <Alert severity="warning" icon={<LockIcon />} sx={{ mb: 2 }}>
          <AlertTitle>A new password is required</AlertTitle>
          This account was set up with a temporary password. The rest of the application stays locked until you
          replace it.
        </Alert>
      )}

      <Card variant="outlined" sx={{ maxWidth: 480 }}>
        <CardContent>
          <Box component="form" onSubmit={handleSubmit}>
            <Stack spacing={2.5}>
              {error && <Alert severity="error">{error}</Alert>}

              <FormTextField
                label="Current password"
                type="password"
                value={current}
                onChange={setCurrent}
                required
                autoFocus
              />

              <FormTextField
                label="New password"
                type="password"
                value={next}
                onChange={setNext}
                required
                error={reused ? 'The new password must be different from the current one' : null}
              />

              <FormTextField
                label="Confirm new password"
                type="password"
                value={confirm}
                onChange={setConfirm}
                required
                error={mismatch ? 'The two passwords do not match' : null}
              />

              {next.length > 0 && unmet.length > 0 && (
                <Alert severity="info" sx={{ py: 0.5 }}>
                  Still needed: {unmet.map((rule) => rule.label.toLowerCase()).join(', ')}
                </Alert>
              )}

              <Typography variant="caption" color="text.secondary">
                Changing your password signs out every other device.
              </Typography>

              <Button type="submit" variant="contained" disabled={!ready || submitting}>
                {submitting ? 'Saving…' : 'Change password'}
              </Button>
            </Stack>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
};

export default ChangePasswordPage;
