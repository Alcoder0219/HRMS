import { useCallback, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import LinkIcon from '@mui/icons-material/LinkOutlined';
import ReplayIcon from '@mui/icons-material/ReplayOutlined';
import CloudDownloadIcon from '@mui/icons-material/CloudDownloadOutlined';

import DataTable from '@components/common/DataTable.jsx';
import StatCard from '@components/common/StatCard.jsx';
import { LoadingState, ErrorState } from '@components/common/StateBlock.jsx';
import usePermissions from '@hooks/usePermissions.js';
import { RESOURCES, ACTIONS } from '@utils/permissions.js';
import adminService from '@services/modules/admin.service.js';
import { formatDateTime, formatRelative, emptyDash } from '@utils/format.js';

/**
 * One device's integration, in full: is it talking to us, what has it sent,
 * and what became of every punch.
 *
 * The counters answer the question this whole screen exists for -- "why is
 * this person's attendance missing?" -- without anyone reading a log file.
 * Every punch the device sent is in the Events tab with a status and a reason;
 * nothing a terminal reports is ever silently dropped.
 */

const EVENT_STATUS = {
  IMPORTED: { color: 'success', label: 'Imported' },
  UNMAPPED: { color: 'warning', label: 'Unmapped' },
  HELD: { color: 'info', label: 'Held' },
  IGNORED: { color: 'default', label: 'Ignored' },
  FAILED: { color: 'error', label: 'Failed' },
  PENDING: { color: 'default', label: 'Pending' },
};

const COMMAND_LABEL = {
  QUERY_ATTLOG: 'Upload attendance',
  QUERY_USERINFO: 'Send user list',
  INFO: 'Send device info',
};

const PUNCH_TYPE = { 0: 'Check-in', 1: 'Check-out', 2: 'Break-out', 3: 'Break-in', 4: 'OT-in', 5: 'OT-out' };

const toDateInput = (value) => (value ? new Date(value).toISOString().slice(0, 10) : '');
const startOfLocalDay = (text) => new Date(`${text}T00:00:00`).toISOString();
const endOfLocalDay = (text) => new Date(`${text}T23:59:59`).toISOString();

/** The link indicator: a push device by its heartbeat, a pull device by its last sync. */
export const ConnectionChip = ({ device }) => {
  if (device.protocol === 'ADMS_PUSH') {
    if (!device.adms?.lastSeenAt) {
      return (
        <Tooltip title="This serial number has never contacted the HRMS">
          <Chip size="small" variant="outlined" label="Never connected" />
        </Tooltip>
      );
    }
    return (
      <Tooltip title={`Last contact ${formatDateTime(device.adms.lastSeenAt)}${device.adms.lastSeenIp ? ` from ${device.adms.lastSeenIp}` : ''}`}>
        <Chip
          size="small"
          color={device.adms.online ? 'success' : 'error'}
          label={device.adms.online ? 'Online' : `Offline · ${formatRelative(device.adms.lastSeenAt)}`}
        />
      </Tooltip>
    );
  }

  const color = { SUCCESS: 'success', PARTIAL: 'warning', FAILED: 'error' }[device.lastSyncStatus] ?? 'default';
  return <Chip size="small" color={color} variant={color === 'default' ? 'outlined' : 'filled'} label={device.lastSyncStatus ?? 'NEVER'} />;
};

const Line = ({ label, children }) => (
  <Stack direction="row" justifyContent="space-between" spacing={2} sx={{ py: 0.5 }}>
    <Typography variant="body2" color="text.secondary">
      {label}
    </Typography>
    <Typography variant="body2" fontWeight={500} textAlign="right" sx={{ wordBreak: 'break-word' }}>
      {children}
    </Typography>
  </Stack>
);

const BiometricActivityDialog = ({ open, device: initial, onClose, onChanged, onMapUsers }) => {
  const { can } = usePermissions();
  const canEdit = can(RESOURCES.TENANT, ACTIONS.UPDATE);
  // Re-applying held punches overrides a correction -- the server demands
  // attendance approval for it, and the option is not offered without it.
  const canOverride = can(RESOURCES.ATTENDANCE, ACTIONS.APPROVE);

  const [tab, setTab] = useState('overview');
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [events, setEvents] = useState({ items: [], total: 0, page: 1, limit: 25 });
  const [eventFilter, setEventFilter] = useState('');
  const [eventsLoading, setEventsLoading] = useState(false);

  const [logs, setLogs] = useState({ items: [], total: 0, page: 1, limit: 25 });
  const [logsLoading, setLogsLoading] = useState(false);

  const [includeHeld, setIncludeHeld] = useState(false);
  const [backlogFrom, setBacklogFrom] = useState('');
  const [working, setWorking] = useState(null);

  const today = new Date().toISOString().slice(0, 10);
  const [uploadFrom, setUploadFrom] = useState(today);
  const [uploadTo, setUploadTo] = useState(today);

  const deviceId = initial?._id;
  const device = status?.device ?? initial;
  const isPush = device?.protocol === 'ADMS_PUSH';

  const loadStatus = useCallback(() => {
    if (!deviceId) return;
    setLoading(true);
    setError(null);

    adminService
      .biometricDeviceStatus(deviceId)
      .then((response) => {
        setStatus(response.data ?? null);
        setBacklogFrom(toDateInput(response.data?.device?.acceptPunchesFrom));
      })
      .catch((rejection) => setError(rejection?.message ?? 'Could not load the device status'))
      .finally(() => setLoading(false));
  }, [deviceId]);

  const loadEvents = useCallback(
    (page = 1, limit = 25) => {
      if (!deviceId) return;
      setEventsLoading(true);

      adminService
        .biometricDeviceEvents(deviceId, { page, limit, ...(eventFilter ? { status: eventFilter } : {}) })
        .then((response) => setEvents(response.data ?? { items: [], total: 0, page, limit }))
        .catch((rejection) => setNotice({ severity: 'error', message: rejection?.message ?? 'Could not load events' }))
        .finally(() => setEventsLoading(false));
    },
    [deviceId, eventFilter],
  );

  const loadLogs = useCallback(
    (page = 1, limit = 25) => {
      if (!deviceId) return;
      setLogsLoading(true);

      adminService
        .biometricDeviceLogs(deviceId, { page, limit })
        .then((response) => setLogs(response.data ?? { items: [], total: 0, page, limit }))
        .catch((rejection) => setNotice({ severity: 'error', message: rejection?.message ?? 'Could not load logs' }))
        .finally(() => setLogsLoading(false));
    },
    [deviceId],
  );

  useEffect(() => {
    if (!open) return;
    setTab('overview');
    setStatus(null);
    setNotice(null);
    setIncludeHeld(false);
    setEventFilter('');
    loadStatus();
  }, [open, loadStatus]);

  useEffect(() => {
    if (open && tab === 'events') loadEvents(1, events.limit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab, eventFilter]);

  useEffect(() => {
    if (open && tab === 'logs') loadLogs(1, logs.limit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab]);

  /* ------------------------------------------------------------ actions -- */

  const reprocess = async (options, label) => {
    setWorking(label);
    setNotice(null);

    try {
      const response = await adminService.reprocessBiometricDevice(deviceId, options);
      const result = response.data ?? {};
      setNotice({
        severity: result.failed ? 'warning' : 'success',
        message:
          `${result.imported ?? 0} of ${result.received ?? 0} stored punch(es) imported into attendance` +
          (result.unmapped ? ` · ${result.unmapped} still unmapped` : '') +
          (result.held ? ` · ${result.held} held` : '') +
          (result.ignored ? ` · ${result.ignored} before the accept-from date` : '') +
          (result.failed ? ` · ${result.failed} failed — see the Events tab` : '') +
          (result.limited ? ' · more remain, run again' : ''),
      });
      loadStatus();
      onChanged?.();
    } catch (rejection) {
      setNotice({ severity: 'error', message: rejection?.message ?? 'Reprocessing failed' });
    } finally {
      setWorking(null);
    }
  };

  const queue = async (payload, label) => {
    setWorking(label);
    setNotice(null);

    try {
      await adminService.queueBiometricCommand(deviceId, payload);
      setNotice({
        severity: 'success',
        message: 'Request queued. The terminal collects it on its next heartbeat; anything it sends is imported and de-duplicated automatically.',
      });
      loadStatus();
    } catch (rejection) {
      setNotice({ severity: 'error', message: rejection?.message ?? 'The request could not be queued' });
    } finally {
      setWorking(null);
    }
  };

  /* ------------------------------------------------------------ columns -- */

  const eventColumns = [
    { key: 'punchTime', label: 'Punch time', render: (row) => formatDateTime(row.punchTime) },
    {
      key: 'deviceLocalTime',
      label: 'Device clock',
      render: (row) => (
        <Typography variant="caption" fontFamily="monospace">
          {emptyDash(row.deviceLocalTime)}
        </Typography>
      ),
    },
    {
      key: 'deviceUserId',
      label: 'Device user',
      render: (row) => (
        <Typography variant="caption" fontFamily="monospace">
          {row.deviceUserId}
        </Typography>
      ),
    },
    { key: 'employeeCode', label: 'Employee', render: (row) => emptyDash(row.employeeCode) },
    {
      key: 'punchType',
      label: 'Type',
      render: (row) => PUNCH_TYPE[row.punchType] ?? (row.punchType ?? row.direction),
    },
    {
      key: 'status',
      label: 'Status',
      render: (row) => (
        <Tooltip title={row.statusReason ?? ''}>
          <Chip size="small" color={EVENT_STATUS[row.status]?.color ?? 'default'} label={EVENT_STATUS[row.status]?.label ?? row.status} />
        </Tooltip>
      ),
    },
    {
      key: 'attendanceDate',
      label: 'Attendance day',
      render: (row) => (row.attendanceDate ? formatDateTime(row.attendanceDate).split(',')[0] : '—'),
    },
  ];

  const logColumns = [
    { key: 'createdAt', label: 'When', render: (row) => formatDateTime(row.createdAt) },
    { key: 'kind', label: 'Kind', render: (row) => <Chip size="small" variant="outlined" label={row.kind} /> },
    { key: 'received', label: 'Received', align: 'right' },
    { key: 'imported', label: 'Imported', align: 'right' },
    { key: 'duplicate', label: 'Duplicate', align: 'right' },
    { key: 'unmapped', label: 'Unmapped', align: 'right' },
    { key: 'held', label: 'Held', align: 'right' },
    { key: 'rejected', label: 'Rejected', align: 'right' },
    { key: 'failed', label: 'Failed', align: 'right' },
    {
      key: 'message',
      label: 'Detail',
      render: (row) => (
        <Tooltip title={[row.message, ...(row.errorMessages ?? [])].filter(Boolean).join('\n')}>
          <Typography
            variant="caption"
            color={row.success ? 'text.secondary' : 'error'}
            noWrap
            sx={{ maxWidth: 260, display: 'block' }}
          >
            {row.errorMessages?.[0] ?? row.message ?? '—'}
          </Typography>
        </Tooltip>
      ),
    },
  ];

  const commandColumns = [
    { key: 'commandId', label: '#', render: (row) => row.commandId },
    { key: 'type', label: 'Request', render: (row) => COMMAND_LABEL[row.type] ?? row.type },
    {
      key: 'window',
      label: 'Range',
      render: (row) => (row.from ? `${formatDateTime(row.from)} → ${formatDateTime(row.to)}` : '—'),
    },
    { key: 'queuedAt', label: 'Queued', render: (row) => formatRelative(row.queuedAt) },
    {
      key: 'status',
      label: 'Status',
      render: (row) => {
        const color = { DONE: 'success', FAILED: 'error', EXPIRED: 'default', SENT: 'info', QUEUED: 'default' }[row.status];
        // -1 on an attendance query is the device saying "no records in that
        // range", which is an answer, not a breakdown.
        const hint =
          row.status === 'FAILED' && row.returnCode === -1 && row.type === 'QUERY_ATTLOG'
            ? 'The device reported no records in that range, or does not support this request'
            : row.returnCode !== null && row.returnCode !== undefined
              ? `Device returned ${row.returnCode}`
              : '';
        return (
          <Tooltip title={hint}>
            <Chip size="small" color={color} variant={color === 'default' ? 'outlined' : 'filled'} label={row.status} />
          </Tooltip>
        );
      },
    },
  ];

  if (!open || !initial) return null;

  const stats = status?.stats;
  const unmapped = status?.unmappedUsers ?? [];

  return (
    <Dialog open onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <span>{device.name}</span>
          <ConnectionChip device={device} />
        </Stack>
        <Typography variant="caption" color="text.secondary" display="block" fontFamily="monospace">
          {isPush ? `ADMS push · SN ${device.serialNumber}` : `${device.protocol} · ${device.ipAddress}:${device.port}`}
        </Typography>
      </DialogTitle>

      <Tabs value={tab} onChange={(_event, value) => setTab(value)} sx={{ px: 3 }} variant="scrollable" allowScrollButtonsMobile>
        <Tab value="overview" label="Overview" />
        <Tab value="events" label="Events" />
        <Tab value="logs" label="Sync logs" />
        {isPush && <Tab value="upload" label="Request upload" />}
      </Tabs>

      <DialogContent dividers sx={{ minHeight: 420 }}>
        {notice && (
          <Alert severity={notice.severity} sx={{ mb: 2 }} onClose={() => setNotice(null)}>
            {notice.message}
          </Alert>
        )}

        {/* ------------------------------------------------------ overview -- */}
        {tab === 'overview' && (
          <>
            {loading && !status && <LoadingState message="Loading device status…" minHeight={240} />}
            {error && <ErrorState message={error} onRetry={loadStatus} />}

            {stats && (
              <Stack spacing={3}>
                <Grid container spacing={2}>
                  {[
                    ['Total events', stats.totalEvents, 'Every punch the device sent'],
                    ['Imported', stats.imported, 'In attendance'],
                    ['Duplicates', stats.duplicateLast90Days, 'Last 90 days, skipped'],
                    ['Rejected', stats.rejectedLast90Days, 'Malformed lines, last 90 days'],
                    ['Unmapped', stats.unmapped, 'Waiting for a mapping'],
                    ['Held', stats.held, 'Locked or corrected days'],
                    ['Ignored', stats.ignored, 'Before accept-from'],
                    ['Failed', stats.failed, 'Retried by reprocess'],
                  ].map(([label, value, caption]) => (
                    <Grid key={label} size={{ xs: 6, sm: 3 }}>
                      <StatCard label={label} value={value} caption={caption} />
                    </Grid>
                  ))}
                </Grid>

                <Grid container spacing={3}>
                  <Grid size={{ xs: 12, md: 6 }}>
                    <Typography variant="subtitle2" gutterBottom>
                      Device
                    </Typography>
                    <Line label="Name">{device.name}</Line>
                    <Line label="Identifier">{device.serialNumber ?? `${device.ipAddress}:${device.port}`}</Line>
                    <Line label="Protocol">{device.protocol}</Line>
                    {isPush && (
                      <>
                        <Line label="Last contact">
                          {device.adms?.lastSeenAt ? `${formatDateTime(device.adms.lastSeenAt)} (${formatRelative(device.adms.lastSeenAt)})` : 'Never'}
                        </Line>
                        <Line label="Calling from">{emptyDash(device.adms?.lastSeenIp)}</Line>
                        <Line label="Firmware">{emptyDash(device.adms?.firmware)}</Line>
                        <Line label="Push protocol">{emptyDash(device.adms?.pushVersion)}</Line>
                        <Line label="Accepting punches from">
                          {device.acceptPunchesFrom ? formatDateTime(device.acceptPunchesFrom) : 'All dates'}
                        </Line>
                      </>
                    )}
                  </Grid>

                  <Grid size={{ xs: 12, md: 6 }}>
                    <Typography variant="subtitle2" gutterBottom>
                      Synchronisation
                    </Typography>
                    <Line label="Last successful sync">
                      {stats.lastSuccessfulSyncAt ? formatDateTime(stats.lastSuccessfulSyncAt) : 'Never'}
                    </Line>
                    <Line label="Last event">
                      {stats.lastEvent
                        ? `${formatDateTime(stats.lastEvent.punchTime)} · user ${stats.lastEvent.deviceUserId}${stats.lastEvent.employeeCode ? ` (${stats.lastEvent.employeeCode})` : ''}`
                        : 'None yet'}
                    </Line>
                    <Line label="Last result">{emptyDash(device.lastSyncMessage)}</Line>
                    <Line label="Mapped users">{device.mappedUserCount ?? 0}</Line>
                  </Grid>
                </Grid>

                <Divider />

                {/* -------------------------------------------- review queue -- */}
                <Box>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                    <Typography variant="subtitle2">Unmapped device users</Typography>
                    {canEdit && (
                      <Button size="small" startIcon={<LinkIcon />} onClick={() => onMapUsers?.(device)}>
                        Map users
                      </Button>
                    )}
                  </Stack>

                  {unmapped.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      Every device user who has punched is mapped to an employee.
                    </Typography>
                  ) : (
                    <>
                      <Alert severity="warning" sx={{ mb: 1 }}>
                        These IDs have punched on the device but are not mapped to an employee. Their punches are stored,
                        not lost — map them, then use “Import pending punches”. Employees are never matched or created
                        automatically.
                      </Alert>
                      <DataTable
                        getKey={(row) => row.deviceUserId}
                        columns={[
                          {
                            key: 'deviceUserId',
                            label: 'Device user ID',
                            render: (row) => (
                              <Typography variant="caption" fontFamily="monospace">
                                {row.deviceUserId}
                              </Typography>
                            ),
                          },
                          { key: 'name', label: 'Name on device', render: (row) => emptyDash(row.name) },
                          { key: 'punches', label: 'Stored punches', align: 'right' },
                          { key: 'lastPunchAt', label: 'Last punch', render: (row) => formatDateTime(row.lastPunchAt) },
                        ]}
                        rows={unmapped}
                      />
                    </>
                  )}
                </Box>

                {/* ---------------------------------------------- reprocess -- */}
                {canEdit && (
                  <Box>
                    <Typography variant="subtitle2" gutterBottom>
                      Import stored punches
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                      Re-applies stored punches that are not yet in attendance — unmapped ones after a mapping is saved,
                      and any that failed. Safe to run repeatedly: a punch is never imported twice.
                    </Typography>

                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
                      <Button
                        variant="contained"
                        size="small"
                        startIcon={working === 'reprocess' ? <CircularProgress size={14} color="inherit" /> : <ReplayIcon />}
                        disabled={Boolean(working)}
                        onClick={() => reprocess({ includeHeld }, 'reprocess')}
                      >
                        Import pending punches
                      </Button>

                      {canOverride && stats.held > 0 && (
                        <FormControlLabel
                          control={<Checkbox size="small" checked={includeHeld} onChange={(event) => setIncludeHeld(event.target.checked)} />}
                          label={
                            <Typography variant="body2">
                              Also apply {stats.held} held punch(es) over manually corrected days
                            </Typography>
                          }
                        />
                      )}
                    </Stack>

                    {includeHeld && (
                      <Alert severity="warning" sx={{ mt: 1.5 }}>
                        Held punches replace a manual correction or regularization with the device’s punches, and the day
                        is recomputed by the attendance rules. Days locked for payroll stay untouched. This is recorded in
                        the audit trail.
                      </Alert>
                    )}

                    {isPush && (
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }} sx={{ mt: 2 }}>
                        <TextField
                          label="Accept punches from"
                          type="date"
                          size="small"
                          value={backlogFrom}
                          onChange={(event) => setBacklogFrom(event.target.value)}
                          slotProps={{ inputLabel: { shrink: true } }}
                          helperText={`${stats.ignored} stored punch(es) are older than the current date`}
                        />
                        <Button
                          size="small"
                          variant="outlined"
                          disabled={Boolean(working) || !backlogFrom}
                          startIcon={working === 'backlog' ? <CircularProgress size={14} /> : <ReplayIcon />}
                          onClick={() =>
                            reprocess({ acceptPunchesFrom: startOfLocalDay(backlogFrom), includeIgnored: true }, 'backlog')
                          }
                        >
                          Move date and import backlog
                        </Button>
                      </Stack>
                    )}
                  </Box>
                )}
              </Stack>
            )}
          </>
        )}

        {/* -------------------------------------------------------- events -- */}
        {tab === 'events' && (
          <Stack spacing={2}>
            <TextField
              select
              size="small"
              label="Status"
              value={eventFilter}
              onChange={(event) => setEventFilter(event.target.value)}
              sx={{ maxWidth: 220 }}
            >
              <MenuItem value="">All</MenuItem>
              {Object.entries(EVENT_STATUS).map(([value, { label }]) => (
                <MenuItem key={value} value={value}>
                  {label}
                </MenuItem>
              ))}
            </TextField>

            <DataTable
              columns={eventColumns}
              rows={events.items}
              loading={eventsLoading}
              page={events.page}
              limit={events.limit}
              total={events.total}
              onPageChange={(page) => loadEvents(page, events.limit)}
              onLimitChange={(limit) => loadEvents(1, limit)}
              emptyTitle="No events"
              emptyMessage="Punches appear here the moment the device sends them."
            />
          </Stack>
        )}

        {/* ---------------------------------------------------------- logs -- */}
        {tab === 'logs' && (
          <DataTable
            columns={logColumns}
            rows={logs.items}
            loading={logsLoading}
            page={logs.page}
            limit={logs.limit}
            total={logs.total}
            onPageChange={(page) => loadLogs(page, logs.limit)}
            onLimitChange={(limit) => loadLogs(1, limit)}
            emptyTitle="No synchronisation yet"
            emptyMessage="Each upload, pull and reprocess is logged here, kept for 90 days."
          />
        )}

        {/* -------------------------------------------------------- upload -- */}
        {tab === 'upload' && isPush && (
          <Stack spacing={2}>
            <Alert severity="info">
              The HRMS cannot connect to an ADMS terminal; it can only leave a request for the terminal to collect on its
              next heartbeat. Support for re-uploading a date range depends on the firmware — the device’s answer is shown
              below once it replies. Anything re-sent is de-duplicated, so asking twice is harmless.
            </Alert>

            {canEdit && (
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
                <TextField
                  label="From"
                  type="date"
                  size="small"
                  value={uploadFrom}
                  onChange={(event) => setUploadFrom(event.target.value)}
                  slotProps={{ inputLabel: { shrink: true } }}
                />
                <TextField
                  label="To"
                  type="date"
                  size="small"
                  value={uploadTo}
                  onChange={(event) => setUploadTo(event.target.value)}
                  slotProps={{ inputLabel: { shrink: true } }}
                />
                <Button
                  variant="contained"
                  size="small"
                  startIcon={working === 'upload' ? <CircularProgress size={14} color="inherit" /> : <CloudDownloadIcon />}
                  disabled={Boolean(working) || !uploadFrom || !uploadTo || uploadFrom > uploadTo}
                  onClick={() =>
                    queue({ type: 'QUERY_ATTLOG', from: startOfLocalDay(uploadFrom), to: endOfLocalDay(uploadTo) }, 'upload')
                  }
                >
                  Request upload
                </Button>
                <Button
                  size="small"
                  disabled={Boolean(working)}
                  onClick={() => queue({ type: 'QUERY_USERINFO' }, 'users')}
                >
                  Request user list
                </Button>
              </Stack>
            )}

            <DataTable
              getKey={(row) => row.commandId}
              columns={commandColumns}
              rows={device.adms?.recentCommands ?? []}
              emptyTitle="No requests yet"
              emptyMessage="Requests you queue, and the device’s reply to each, appear here."
            />
          </Stack>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={loadStatus} disabled={loading}>
          Refresh
        </Button>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};

export default BiometricActivityDialog;
