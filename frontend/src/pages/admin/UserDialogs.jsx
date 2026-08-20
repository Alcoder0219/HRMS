import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import FormDialog from '@components/common/FormDialog.jsx';
import DataTable from '@components/common/DataTable.jsx';
import StatusChip from '@components/common/StatusChip.jsx';
import EmployeePicker from '@components/common/EmployeePicker.jsx';
import adminService from '@services/modules/admin.service.js';
import { formatDateTime, humanize } from '@utils/format.js';
import { employeeIdentifiers } from '@utils/dataGrid.js';

export const ACCOUNT_STATUSES = ['PENDING', 'ACTIVE', 'SUSPENDED', 'LOCKED', 'DEACTIVATED'];

/**
 * The same rule the server enforces, stated once here, now over the live role
 * catalogue rather than a fixed list -- a custom role is exactly as
 * assignable (or not) as a built-in one, by rank.
 *
 * The client copy is a courtesy -- it stops someone filling in a form that was
 * always going to be refused. The server check is the one that matters.
 */
export const assignableRoles = (myRole, roles = []) => {
  const myRank = roles.find((role) => role.code === myRole)?.rank ?? 0;
  return roles.filter((role) => myRank > role.rank);
};

const PASSWORD_RULE = 'At least 10 characters, with an uppercase letter, a lowercase letter and a digit.';

const validPassword = (value) =>
  value.length >= 10 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /[0-9]/.test(value);

/* -------------------------------------------------------------------------- */
/*                             Create and edit                                */
/* -------------------------------------------------------------------------- */

export const UserFormDialog = ({ open, user = null, myRole, roles = [], onClose, onSaved }) => {
  const editing = Boolean(user);

  const [form, setForm] = useState({});
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;

    setError(null);
    setForm(
      editing
        ? {
            firstName: user.firstName ?? '',
            lastName: user.lastName ?? '',
            phone: user.phone ?? '',
            role: user.role ?? 'EMPLOYEE',
            employeeId: user.employee?._id ?? user.employeeId ?? '',
            mustChangePassword: user.mustChangePassword ?? false,
          }
        : {
            email: '',
            password: '',
            firstName: '',
            lastName: '',
            phone: '',
            role: 'EMPLOYEE',
            employeeId: '',
            mustChangePassword: true,
          },
    );
  }, [open, editing, user]);

  const set = (field) => (event) =>
    setForm((previous) => ({
      ...previous,
      [field]: event.target.type === 'checkbox' ? event.target.checked : event.target.value,
    }));

  const options = assignableRoles(myRole, roles);

  const handleSubmit = async () => {
    setSaving(true);
    setError(null);

    try {
      const payload = { ...form };
      if (!payload.employeeId) payload.employeeId = null;
      if (payload.phone === '') delete payload.phone;

      if (editing) {
        await adminService.updateUser(user._id, payload);
      } else {
        await adminService.createUser(payload);
      }

      onSaved();
      onClose();
    } catch (rejection) {
      setError(rejection?.message ?? 'The account could not be saved');
    } finally {
      setSaving(false);
    }
  };

  const complete =
    form.firstName?.trim() &&
    form.lastName?.trim() &&
    form.role &&
    (editing || (form.email?.trim() && validPassword(form.password ?? '')));

  return (
    <FormDialog
      open={open}
      title={editing ? `Edit ${user?.email}` : 'New user account'}
      submitLabel={editing ? 'Save' : 'Create account'}
      onClose={onClose}
      onSubmit={handleSubmit}
      submitting={saving}
      disabled={!complete}
      error={error}
      maxWidth="sm"
    >
      <Grid container spacing={2}>
        {!editing && (
          <>
            <Grid size={12}>
              <TextField
                fullWidth
                size="small"
                label="Email address"
                type="email"
                value={form.email ?? ''}
                onChange={set('email')}
                required
              />
            </Grid>

            <Grid size={12}>
              <TextField
                fullWidth
                size="small"
                label="Initial password"
                type="password"
                value={form.password ?? ''}
                onChange={set('password')}
                required
                error={Boolean(form.password) && !validPassword(form.password)}
                helperText={PASSWORD_RULE}
              />
            </Grid>
          </>
        )}

        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField fullWidth size="small" label="First name" value={form.firstName ?? ''} onChange={set('firstName')} required />
        </Grid>

        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField fullWidth size="small" label="Last name" value={form.lastName ?? ''} onChange={set('lastName')} required />
        </Grid>

        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField fullWidth size="small" label="Phone" value={form.phone ?? ''} onChange={set('phone')} />
        </Grid>

        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField fullWidth select size="small" label="Role" value={form.role ?? ''} onChange={set('role')} required>
            {options.map((role) => (
              <MenuItem key={role.code} value={role.code}>
                {role.label}
              </MenuItem>
            ))}
          </TextField>
        </Grid>

        <Grid size={12}>
          <EmployeePicker
            label="Linked employee (optional)"
            value={form.employeeId ?? ''}
            onChange={(value) => setForm((previous) => ({ ...previous, employeeId: value }))}
          />
          <Typography variant="caption" color="text.secondary">
            Linking lets this account see its own attendance, payslips and leave. Accounts for people who are not on
            the payroll can be left unlinked.
          </Typography>
        </Grid>

        <Grid size={12}>
          <FormControlLabel
            control={<Switch checked={Boolean(form.mustChangePassword)} onChange={set('mustChangePassword')} />}
            label="Require a password change at next sign-in"
          />
        </Grid>

        {options.length === 0 && (
          <Grid size={12}>
            <Alert severity="warning">Your role cannot create accounts.</Alert>
          </Grid>
        )}
      </Grid>
    </FormDialog>
  );
};

/* -------------------------------------------------------------------------- */
/*                              Password reset                                */
/* -------------------------------------------------------------------------- */

export const ResetPasswordDialog = ({ open, user, onClose, onDone }) => {
  const [password, setPassword] = useState('');
  const [notify, setNotify] = useState(false);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPassword('');
    setNotify(false);
    setError(null);
  }, [open]);

  const handleSubmit = async () => {
    setSaving(true);
    setError(null);

    try {
      const response = await adminService.resetUserPassword(user._id, { password, notify });
      onDone(
        `Password reset. ${response.data?.sessionsRevoked ?? 0} session(s) signed out.` +
          (notify ? (response.data?.emailed ? ' The user was emailed.' : ' The notification email failed.') : ''),
      );
      onClose();
    } catch (rejection) {
      setError(rejection?.message ?? 'The password could not be reset');
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormDialog
      open={open}
      title={`Reset password for ${user?.email ?? ''}`}
      submitLabel="Reset password"
      onClose={onClose}
      onSubmit={handleSubmit}
      submitting={saving}
      disabled={!validPassword(password)}
      error={error}
      maxWidth="xs"
    >
      <Alert severity="warning" sx={{ mb: 2 }}>
        Every device signed in as this account will be signed out, and the user must choose a new password at their
        next sign-in.
      </Alert>

      <TextField
        fullWidth
        size="small"
        type="password"
        label="New password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        error={Boolean(password) && !validPassword(password)}
        helperText={PASSWORD_RULE}
        autoFocus
      />

      <FormControlLabel
        sx={{ mt: 1 }}
        control={<Switch checked={notify} onChange={(event) => setNotify(event.target.checked)} />}
        label="Email the user that their password changed"
      />
    </FormDialog>
  );
};

/* -------------------------------------------------------------------------- */
/*                                   Detail                                   */
/* -------------------------------------------------------------------------- */

export const UserDetailDialog = ({ open, userId, onClose }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !userId) return;

    setLoading(true);
    adminService
      .getUser(userId)
      .then((response) => setUser(response.data))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, [open, userId]);

  const rows = [
    ['Email', user?.email],
    ['Role', humanize(user?.role ?? '')],
    ['Linked employee', user?.employee ? `${employeeIdentifiers(user.employee)} — ${user.employee.firstName} ${user.employee.lastName}` : 'Not linked'],
    ['Department', user?.department?.name ?? '—'],
    ['Email verified', user?.isEmailVerified ? 'Yes' : 'No'],
    ['Must change password', user?.mustChangePassword ? 'Yes' : 'No'],
    ['Failed sign-ins', user?.failedLoginAttempts ?? 0],
    ['Active sessions', user?.activeSessions ?? 0],
    ['Last sign-in', user?.lastLoginAt ? formatDateTime(user.lastLoginAt) : 'Never'],
    ['Last address', user?.lastLoginIp ?? '—'],
  ];

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Stack direction="row" spacing={1} alignItems="center">
          <span>{user?.fullName ?? 'User'}</span>
          {user?.status && <StatusChip status={user.status} />}
          {user?.isLocked && <Chip label="Locked" size="small" color="error" />}
        </Stack>
      </DialogTitle>

      <DialogContent dividers>
        {loading && <Typography variant="body2">Loading…</Typography>}

        {!loading && user && (
          <>
            <Grid container spacing={1}>
              {rows.map(([label, value]) => (
                <Grid key={label} size={{ xs: 12, sm: 6 }}>
                  <Typography variant="caption" color="text.secondary" display="block">
                    {label}
                  </Typography>
                  <Typography variant="body2">{value ?? '—'}</Typography>
                </Grid>
              ))}
            </Grid>

            <Divider sx={{ my: 2 }} />

            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Recent sign-in activity
            </Typography>

            <DataTable
              columns={[
                { key: 'occurredAt', label: 'When', render: (row) => formatDateTime(row.occurredAt) },
                { key: 'event', label: 'Event', render: (row) => humanize(row.event) },
                { key: 'status', label: 'Result', render: (row) => <StatusChip status={row.status} /> },
                { key: 'ip', label: 'Address', render: (row) => row.ip ?? '—' },
              ]}
              rows={user.recentLogins ?? []}
              emptyTitle="This account has never signed in"
            />
          </>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};

export default { UserFormDialog, ResetPasswordDialog, UserDetailDialog, assignableRoles, ACCOUNT_STATUSES };
