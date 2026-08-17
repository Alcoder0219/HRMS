import { useCallback, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';

import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';

import PageHeader from '@components/common/PageHeader.jsx';
import DataTable from '@components/common/DataTable.jsx';
import authService from '@services/modules/auth.service.js';
import adminService from '@services/modules/admin.service.js';
import { formatDateTime, formatRelative, humanize } from '@utils/format.js';
import { PATHS } from '@routes/paths.js';

const STATUS_COLOR = { SUCCESS: 'success', FAILED: 'error', FAILURE: 'error', BLOCKED: 'warning' };

/**
 * Sign-in activity, for the whole organisation or for the signed-in account.
 *
 * Two tabs rather than one screen, because they are two different disclosures:
 * everyone's history needs `audit:read`, your own needs nothing beyond being
 * signed in. The organisation tab simply fails to load for a role without the
 * grant, which is the honest outcome.
 */
const LoginHistoryPage = () => {
  const [tab, setTab] = useState('everyone');
  const [rows, setRows] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [meta, setMeta] = useState({ page: 1, limit: 25, total: 0 });
  const [filters, setFilters] = useState({ search: '', status: '', event: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    if (tab === 'sessions') return;

    setLoading(true);
    setError(null);

    const request =
      tab === 'everyone'
        ? adminService.loginHistory({ page: meta.page, limit: meta.limit, ...filters })
        : authService.loginHistory({ page: meta.page, limit: meta.limit });

    request
      .then((response) => {
        setRows(response.data ?? []);
        setMeta((previous) => ({ ...previous, total: response.meta?.total ?? 0 }));
      })
      .catch((rejection) => setError(rejection?.message ?? 'Could not load the login history'))
      .finally(() => setLoading(false));
  }, [tab, meta.page, meta.limit, filters]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    authService
      .sessions()
      .then((response) => setSessions(response.data ?? []))
      .catch(() => setSessions([]));
  }, []);

  const HISTORY_COLUMNS = [
    { key: 'occurredAt', label: 'When', render: (row) => formatDateTime(row.occurredAt) },
    // Only meaningful on the organisation tab; your own history is all you.
    ...(tab === 'everyone' ? [{ key: 'email', label: 'Account' }] : []),
    { key: 'event', label: 'Event', render: (row) => humanize(row.event) },
    {
      key: 'status',
      label: 'Result',
      render: (row) => (
        <Box>
          <Chip label={humanize(row.status)} size="small" color={STATUS_COLOR[row.status] ?? 'default'} variant="outlined" />
          {row.failureReason && (
            <Typography variant="caption" display="block" color="text.secondary">
              {humanize(row.failureReason)}
            </Typography>
          )}
        </Box>
      ),
    },
    { key: 'ip', label: 'IP', render: (row) => row.ip ?? '—' },
    {
      key: 'userAgent',
      label: 'Client',
      render: (row) => (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', maxWidth: 340 }} noWrap>
          {row.userAgent ?? '—'}
        </Typography>
      ),
    },
  ];

  const SESSION_COLUMNS = [
    {
      key: 'device',
      label: 'Device',
      render: (row) => (
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="body2">{row.device ?? 'Unknown device'}</Typography>
          {row.current && <Chip label="This device" size="small" color="primary" />}
        </Stack>
      ),
    },
    { key: 'ip', label: 'IP', render: (row) => row.ip ?? '—' },
    { key: 'createdAt', label: 'Signed in', render: (row) => formatDateTime(row.createdAt) },
    { key: 'lastUsedAt', label: 'Last used', render: (row) => formatRelative(row.lastUsedAt) },
    { key: 'expiresAt', label: 'Expires', render: (row) => formatDateTime(row.expiresAt) },
    {
      key: 'rememberMe',
      label: 'Remembered',
      render: (row) => (row.rememberMe ? <Chip label="Yes" size="small" variant="outlined" /> : 'No'),
    },
  ];

  return (
    <Box>
      <PageHeader
        title="Login History"
        subtitle="Who signed in, when, and from where"
        breadcrumbs={[
          { label: 'Home', to: PATHS.dashboard },
          { label: 'Administration' },
          { label: 'Login History' },
        ]}
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Tabs
        value={tab}
        onChange={(_event, next) => {
          setTab(next);
          setMeta((previous) => ({ ...previous, page: 1 }));
        }}
        sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab value="everyone" label="Everyone" />
        <Tab value="mine" label="My account" />
        <Tab value="sessions" label={`My sessions (${sessions.length})`} />
      </Tabs>

      {tab === 'everyone' && (
        <Stack direction="row" spacing={1} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap data-print="hide">
          <TextField
            size="small"
            label="Search by email"
            value={filters.search}
            onChange={(event) => {
              setFilters((previous) => ({ ...previous, search: event.target.value }));
              setMeta((previous) => ({ ...previous, page: 1 }));
            }}
            sx={{ width: 240 }}
          />

          <TextField
            select
            size="small"
            label="Result"
            value={filters.status}
            onChange={(event) => setFilters((previous) => ({ ...previous, status: event.target.value }))}
            sx={{ width: 160 }}
          >
            <MenuItem value="">Any result</MenuItem>
            <MenuItem value="SUCCESS">Successful</MenuItem>
            <MenuItem value="FAILED">Failed</MenuItem>
          </TextField>

          <TextField
            select
            size="small"
            label="Event"
            value={filters.event}
            onChange={(event) => setFilters((previous) => ({ ...previous, event: event.target.value }))}
            sx={{ width: 190 }}
          >
            <MenuItem value="">Any event</MenuItem>
            {['LOGIN', 'LOGOUT', 'TOKEN_REFRESH', 'PASSWORD_CHANGE', 'PASSWORD_RESET'].map((event) => (
              <MenuItem key={event} value={event}>
                {humanize(event)}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      )}

      {tab !== 'sessions' ? (
        <DataTable
          columns={HISTORY_COLUMNS}
          rows={rows}
          loading={loading}
          emptyMessage="No sign-in activity recorded."
          page={meta.page}
          limit={meta.limit}
          total={meta.total}
          onPageChange={(page) => setMeta((previous) => ({ ...previous, page }))}
          onLimitChange={(limit) => setMeta((previous) => ({ ...previous, limit, page: 1 }))}
        />
      ) : (
        <DataTable
          columns={SESSION_COLUMNS}
          rows={sessions}
          getKey={(row) => row.id}
          emptyMessage="No active sessions."
        />
      )}
    </Box>
  );
};

export default LoginHistoryPage;
