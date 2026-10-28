import { useCallback, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import Snackbar from '@mui/material/Snackbar';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/AddOutlined';
import BlockIcon from '@mui/icons-material/BlockOutlined';
import PlayIcon from '@mui/icons-material/PlayCircleOutlined';
import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import EditIcon from '@mui/icons-material/EditOutlined';
import InsightsIcon from '@mui/icons-material/InsightsOutlined';
import LinkIcon from '@mui/icons-material/LinkOutlined';
import SyncIcon from '@mui/icons-material/SyncOutlined';
import WifiIcon from '@mui/icons-material/WifiTetheringOutlined';

import DataTable from '@components/common/DataTable.jsx';
import ConfirmDialog from '@components/feedback/ConfirmDialog.jsx';
import usePermissions from '@hooks/usePermissions.js';
import { RESOURCES, ACTIONS } from '@utils/permissions.js';
import adminService from '@services/modules/admin.service.js';
import { formatRelative, emptyDash } from '@utils/format.js';

import BiometricActivityDialog, { ConnectionChip } from './BiometricActivityDialog.jsx';
import BiometricDeviceDialog from './BiometricDeviceDialog.jsx';
import BiometricMappingDialog from './BiometricMappingDialog.jsx';

/**
 * Biometric terminals, as a section of the System Settings page.
 *
 * A component rather than more lines in `SystemSettingsPage` because it owns
 * state that has nothing to do with payroll settings: its own load, its own
 * four dialogs, and a save per action. The page renders it; everything below
 * belongs to it.
 *
 * Deliberately NOT wired into the page's Save button. Adding a terminal and
 * changing the NSSF rate are unrelated acts, and a shared Save would mean
 * either could not be done without the other.
 */

/** Which per-row action is in flight, so only that button shows a spinner. */
const IDLE = { deviceId: null, action: null };

const BiometricDevicesSection = () => {
  const { can } = usePermissions();
  const canRead = can(RESOURCES.TENANT, ACTIONS.READ);
  const canEdit = can(RESOURCES.TENANT, ACTIONS.UPDATE);
  const canDelete = can(RESOURCES.TENANT, ACTIONS.DELETE);

  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(IDLE);
  const [toast, setToast] = useState(null);
  // Kept apart from `toast`: a diagnosis the user has to act on must stay on
  // screen until they dismiss it, not vanish on a timer.
  const [notice, setNotice] = useState(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);

  const [mappingFor, setMappingFor] = useState(null);
  const [activityFor, setActivityFor] = useState(null);
  const [syncResult, setSyncResult] = useState(null);
  const [deleting, setDeleting] = useState(null);
  // A serial calling in unregistered, offered as the starting point of a new device.
  const [prefill, setPrefill] = useState(null);
  const [integration, setIntegration] = useState(null);

  const load = useCallback(() => {
    if (!canRead) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    adminService
      .listBiometricDevices()
      .then((response) => setDevices(response.data ?? []))
      .catch((rejection) => {
        setDevices([]);
        setError(rejection?.message ?? 'Could not load the biometric devices');
      })
      .finally(() => setLoading(false));

    // Best effort: the device list is usable without it.
    adminService
      .biometricIntegrationStatus()
      .then((response) => setIntegration(response.data ?? null))
      .catch(() => setIntegration(null));
  }, [canRead]);

  useEffect(() => {
    load();
  }, [load]);

  const isBusy = (deviceId, action) => busy.deviceId === deviceId && busy.action === action;

  /* ------------------------------------------------------------ actions -- */

  const handleTest = async (device) => {
    setBusy({ deviceId: device._id, action: 'test' });

    try {
      const response = await adminService.testBiometricDevice(device._id);
      const result = response.data ?? {};

      if (result.connected) {
        // A WDMS server reports terminals, an ADMS terminal its last contact,
        // and a polled terminal its own counts.
        const detail =
          result.info?.serverType === 'WDMS'
            ? `${result.info.terminalCount ?? 0} terminal(s) registered`
            : result.info?.serverType === 'ADMS'
              ? `last contact ${formatRelative(result.info.lastSeenAt)}${result.info.lastSeenIp ? ` from ${result.info.lastSeenIp}` : ''}`
              : `${result.info?.userCount ?? '?'} enrolled user(s), ${result.info?.logCount ?? '?'} log(s) stored`;

        setToast({ severity: 'success', message: `${device.name} responded — ${detail}` });
      } else {
        /**
         * A failure with a suggestion is shown as a persistent warning, not a
         * transient error toast.
         *
         * The commonest failure here is a protocol that cannot reach the
         * address at all, and the fix is a specific settings change. That is
         * too much to read in a snackbar that disappears after six seconds.
         */
        if (result.suggestion) {
          setNotice({ severity: 'warning', message: `${result.error} — ${result.suggestion}` });
        } else {
          setToast({ severity: 'error', message: `${device.name} could not be reached: ${result.error}` });
        }
      }

      load();
    } catch (rejection) {
      setToast({ severity: 'error', message: rejection?.message ?? 'The test failed' });
    } finally {
      setBusy(IDLE);
    }
  };

  const handleSync = async (device) => {
    setBusy({ deviceId: device._id, action: 'sync' });

    try {
      const response = await adminService.syncBiometricDevice(device._id);
      setSyncResult({ device, ...(response.data ?? {}) });
      load();
    } catch (rejection) {
      setToast({ severity: 'error', message: rejection?.message ?? 'The sync failed' });
    } finally {
      setBusy(IDLE);
    }
  };

  const handleSaveDevice = async (payload) => {
    setSaving(true);
    setFormError(null);

    try {
      if (editing) await adminService.updateBiometricDevice(editing._id, payload);
      else await adminService.addBiometricDevice(payload);

      setFormOpen(false);
      setEditing(null);
      setToast({ severity: 'success', message: editing ? 'Device updated' : 'Device added' });
      load();
    } catch (rejection) {
      setFormError(rejection?.message ?? 'The device could not be saved');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (device) => {
    setBusy({ deviceId: device._id, action: 'toggle' });

    try {
      await adminService.updateBiometricDevice(device._id, { isActive: !device.isActive });
      setToast({ severity: 'success', message: `${device.name} ${device.isActive ? 'disabled' : 'enabled'}` });
      load();
    } catch (rejection) {
      setToast({ severity: 'error', message: rejection?.message ?? 'The device could not be updated' });
    } finally {
      setBusy(IDLE);
    }
  };

  const handleDelete = async () => {
    const device = deleting;
    setDeleting(null);
    setBusy({ deviceId: device._id, action: 'delete' });

    try {
      await adminService.removeBiometricDevice(device._id);
      setToast({ severity: 'success', message: `${device.name} removed` });
      load();
    } catch (rejection) {
      setToast({ severity: 'error', message: rejection?.message ?? 'The device could not be removed' });
    } finally {
      setBusy(IDLE);
    }
  };

  /* ------------------------------------------------------------ columns -- */

  const columns = [
    {
      key: 'name',
      label: 'Device',
      render: (row) => (
        <Box>
          <Typography variant="body2">{row.name}</Typography>
          <Typography variant="caption" color="text.secondary" fontFamily="monospace" display="block">
            {row.protocol === 'ADMS_PUSH' ? `SN ${row.serialNumber}` : `${row.ipAddress}:${row.port}`}
          </Typography>
          {row.location && (
            <Typography variant="caption" color="text.secondary">
              {row.location}
            </Typography>
          )}
        </Box>
      ),
    },
    {
      key: 'protocol',
      label: 'Protocol',
      render: (row) => (
        <Typography variant="caption" fontFamily="monospace">
          {row.protocol}
        </Typography>
      ),
    },
    {
      key: 'isActive',
      label: 'Status',
      render: (row) => (
        <Stack direction="row" spacing={0.5}>
          <Chip
            size="small"
            variant="outlined"
            color={row.isActive ? 'success' : 'default'}
            label={row.isActive ? 'Active' : 'Inactive'}
          />
          {row.protocol === 'ADMS_PUSH' ? (
            <Tooltip title="The terminal pushes each punch as it happens">
              <Chip size="small" variant="outlined" label="Push" />
            </Tooltip>
          ) : (
            row.autoSync &&
            row.isActive && (
              <Tooltip title={`Polled every ${row.syncIntervalMinutes} minute(s)`}>
                <Chip size="small" variant="outlined" label={`Auto ${row.syncIntervalMinutes}m`} />
              </Tooltip>
            )
          )}
        </Stack>
      ),
    },
    {
      key: 'mappedUserCount',
      label: 'Mapped',
      align: 'right',
      render: (row) =>
        row.mappedUserCount > 0 ? (
          row.mappedUserCount
        ) : (
          // A device with no mappings reads punches and discards every one of
          // them, which is worth saying rather than showing as a quiet zero.
          <Tooltip title="No enrolments are mapped, so this device imports nothing">
            <Chip size="small" color="warning" variant="outlined" label="None" />
          </Tooltip>
        ),
    },
    {
      key: 'lastSyncAt',
      label: 'Last sync',
      render: (row) => (
        <Box>
          <Typography variant="body2">
            {row.lastSyncAt ? formatRelative(row.lastSyncAt) : 'Never'}
          </Typography>
          {row.lastSyncMessage && (
            <Tooltip title={row.lastSyncMessage}>
              <Typography variant="caption" color="text.secondary" noWrap sx={{ maxWidth: 200, display: 'block' }}>
                {row.lastSyncMessage}
              </Typography>
            </Tooltip>
          )}
        </Box>
      ),
    },
    {
      key: 'lastSyncStatus',
      // A push device is judged by its heartbeat, a pull device by its last sync.
      label: 'Connection',
      render: (row) => (
        <Box>
          <ConnectionChip device={row} />
          {row.protocol === 'ADMS_PUSH' && (
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
              {row.adms?.lastSeenAt ? `Seen ${formatRelative(row.adms.lastSeenAt)}` : 'Not seen yet'}
            </Typography>
          )}
        </Box>
      ),
    },
    {
      key: 'punches',
      label: 'Punches',
      render: (row) => {
        const punches = row.punches ?? {};
        return (
          <Tooltip
            title={`${punches.received ?? 0} received · ${punches.imported ?? 0} imported · ${punches.unmapped ?? 0} unmapped · ${punches.held ?? 0} held · ${punches.failed ?? 0} failed`}
          >
            <Stack direction="row" spacing={0.5} alignItems="center">
              <Typography variant="body2">
                {punches.imported ?? 0}/{punches.received ?? 0}
              </Typography>
              {punches.unmapped > 0 && (
                <Chip size="small" color="warning" variant="outlined" label={`${punches.unmapped} unmapped`} />
              )}
              {punches.failed > 0 && <Chip size="small" color="error" variant="outlined" label={`${punches.failed} failed`} />}
            </Stack>
          </Tooltip>
        );
      },
    },
    {
      key: 'actions',
      label: 'Actions',
      align: 'right',
      render: (row) => (
        <Stack direction="row" spacing={0.5} justifyContent="flex-end">
          <Tooltip title="Status, events, sync logs and unmapped users">
            <span>
              <Button size="small" startIcon={<InsightsIcon />} onClick={() => setActivityFor(row)}>
                Activity
              </Button>
            </span>
          </Tooltip>

          <Tooltip title={row.protocol === 'ADMS_PUSH' ? 'Check when the terminal last called in' : 'Test the connection'}>
            <span>
              <Button
                size="small"
                startIcon={isBusy(row._id, 'test') ? <CircularProgress size={14} /> : <WifiIcon />}
                disabled={!canEdit || busy.deviceId === row._id}
                onClick={() => handleTest(row)}
              >
                Test
              </Button>
            </span>
          </Tooltip>

          {/* A push terminal cannot be pulled from; its re-upload request lives under Activity. */}
          {row.protocol !== 'ADMS_PUSH' && (
            <Tooltip title="Pull logs now">
              <span>
                <Button
                  size="small"
                  startIcon={isBusy(row._id, 'sync') ? <CircularProgress size={14} /> : <SyncIcon />}
                  disabled={!canEdit || busy.deviceId === row._id}
                  onClick={() => handleSync(row)}
                >
                  Sync
                </Button>
              </span>
            </Tooltip>
          )}

          <Tooltip title="Match enrolments to employees">
            <span>
              <Button
                size="small"
                startIcon={<LinkIcon />}
                disabled={!canEdit || busy.deviceId === row._id}
                onClick={() => setMappingFor(row)}
              >
                Map
              </Button>
            </span>
          </Tooltip>

          <Tooltip title="Edit">
            <span>
              <Button
                size="small"
                disabled={!canEdit || busy.deviceId === row._id}
                onClick={() => {
                  setEditing(row);
                  setFormError(null);
                  setFormOpen(true);
                }}
              >
                <EditIcon fontSize="small" />
              </Button>
            </span>
          </Tooltip>

          {/* Disabling stops a push device being served and a pull device being
              polled; its history and mappings are kept, unlike Remove. */}
          <Tooltip title={row.isActive ? 'Disable — stop accepting punches from it' : 'Enable'}>
            <span>
              <Button
                size="small"
                color={row.isActive ? 'warning' : 'success'}
                disabled={!canEdit || busy.deviceId === row._id}
                onClick={() => handleToggleActive(row)}
              >
                {isBusy(row._id, 'toggle') ? (
                  <CircularProgress size={14} />
                ) : row.isActive ? (
                  <BlockIcon fontSize="small" />
                ) : (
                  <PlayIcon fontSize="small" />
                )}
              </Button>
            </span>
          </Tooltip>

          <Tooltip title="Remove">
            <span>
              <Button
                size="small"
                color="error"
                disabled={!canDelete || busy.deviceId === row._id}
                onClick={() => setDeleting(row)}
              >
                <DeleteIcon fontSize="small" />
              </Button>
            </span>
          </Tooltip>
        </Stack>
      ),
    },
  ];

  if (!canRead) return null;

  return (
    <Card variant="outlined" sx={{ mb: 2 }}>
      <CardContent>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          justifyContent="space-between"
          alignItems={{ sm: 'flex-start' }}
          spacing={1}
        >
          <Box>
            <Typography variant="h6">Biometric devices</Typography>
            <Typography variant="caption" color="text.secondary">
              Attendance terminals that are polled in the background or push to this HRMS (ADMS). Every punch is
              stored, de-duplicated and passed through the same attendance rules, whichever way it arrives.
            </Typography>
          </Box>

          {canEdit && (
            <Button
              variant="contained"
              size="small"
              startIcon={<AddIcon />}
              onClick={() => {
                setEditing(null);
                setFormError(null);
                setFormOpen(true);
              }}
            >
              Add device
            </Button>
          )}
        </Stack>

        <Divider sx={{ my: 2 }} />

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {notice && (
          <Alert severity={notice.severity} sx={{ mb: 2 }} onClose={() => setNotice(null)}>
            {notice.message}
          </Alert>
        )}

        <IntegrationBanner
          integration={integration}
          hasPushDevice={devices.some((device) => device.protocol === 'ADMS_PUSH')}
          canEdit={canEdit}
          onRegister={(serialNumber) => {
            setEditing(null);
            setFormError(null);
            setPrefill({ protocol: 'ADMS_PUSH', serialNumber });
            setFormOpen(true);
          }}
        />

        <DataTable
          columns={columns}
          rows={devices}
          loading={loading}
          onRetry={load}
          emptyTitle="No biometric devices configured"
          emptyMessage="Add a terminal to pull attendance from it automatically."
        />

        {devices.some(
          (device) => device.isActive && (device.autoSync || device.protocol === 'ADMS_PUSH') && !device.mappedUserCount,
        ) && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            One or more active devices have no user mappings. Their punches are stored but none reach
            attendance until the enrolments are mapped to employees — then use Activity → Import pending punches.
          </Alert>
        )}
      </CardContent>

      {/* ------------------------------------------------------- dialogs -- */}

      <BiometricDeviceDialog
        open={formOpen}
        device={editing}
        prefill={prefill}
        deviceSettings={integration?.receiver?.deviceSettings ?? null}
        canEditReceiver={canEdit}
        onReceiverSaved={load}
        submitting={saving}
        error={formError}
        onSubmit={handleSaveDevice}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
          setPrefill(null);
        }}
      />

      <BiometricActivityDialog
        open={Boolean(activityFor)}
        device={activityFor}
        onClose={() => setActivityFor(null)}
        onChanged={load}
        onMapUsers={(device) => setMappingFor(device)}
      />

      <BiometricMappingDialog
        open={Boolean(mappingFor)}
        device={mappingFor}
        onClose={() => setMappingFor(null)}
        onSaved={(message) => {
          setMappingFor(null);
          // Mapped punches are not imported until reprocessed; say so where it is acted on.
          setToast({
            severity: 'success',
            message: `${message}. Use Activity → Import pending punches to apply any stored punches.`,
          });
          load();
        }}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        title={`Remove ${deleting?.name ?? 'this device'}?`}
        message="The device stops being polled. Attendance already imported from it is not affected."
        confirmLabel="Remove"
        onConfirm={handleDelete}
        onClose={() => setDeleting(null)}
      />

      <SyncResultDialog result={syncResult} onClose={() => setSyncResult(null)} />

      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={6000}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={toast?.severity ?? 'info'} variant="filled" onClose={() => setToast(null)}>
          {toast?.message}
        </Alert>
      </Snackbar>
    </Card>
  );
};

/**
 * What the server says about the integration as a whole.
 *
 * Shown only when there is something to act on: a receiver that is off while
 * a push device is configured, a production receiver with no network check, a
 * time-zone mismatch that would grade every shift wrongly, or a terminal
 * calling in under a serial nobody has registered.
 */
const SECURITY_LABEL = {
  GATEWAY_TOKEN: 'office gateway token',
  IP_ALLOWLIST: 'office IP allowlist',
  GATEWAY_TOKEN_AND_IP_ALLOWLIST: 'gateway token and IP allowlist',
  SERIAL_ONLY: 'serial number only (LAN or development)',
};

const IntegrationBanner = ({ integration, hasPushDevice, canEdit, onRegister }) => {
  if (!integration) return null;

  const { receiver, time, unregisteredDevices = [] } = integration;
  const alerts = [];

  if (hasPushDevice && !receiver.enabled) {
    alerts.push(
      <Alert key="off" severity="warning">
        An ADMS push device is configured but the receiver is switched off on the server. Set ADMS_ENABLED=true on the
        backend before pointing the terminal at it.
      </Alert>,
    );
  }

  if (receiver.securityMode === 'MISCONFIGURED') {
    alerts.push(
      <Alert key="security" severity="error">
        The ADMS receiver is enabled but refusing every device: in production it needs ADMS_GATEWAY_TOKEN or
        ADMS_ALLOWED_IPS on the backend.
      </Alert>,
    );
  } else if (receiver.enabled && hasPushDevice) {
    alerts.push(
      <Alert key="mode" severity="info" variant="outlined">
        ADMS receiver active at <code>/iclock</code>, protected by {SECURITY_LABEL[receiver.securityMode] ?? receiver.securityMode}.
        Heartbeat every {receiver.pollDelaySeconds}s.
      </Alert>,
    );
  }

  (time?.warnings ?? []).forEach((warning) =>
    alerts.push(
      <Alert key={warning} severity="warning">
        {warning}
      </Alert>,
    ),
  );

  if (unregisteredDevices.length) {
    alerts.push(
      <Alert key="unregistered" severity="warning">
        <Typography variant="body2" gutterBottom>
          {unregisteredDevices.length === 1 ? 'A terminal is' : 'Terminals are'} calling in with a serial number that is
          not registered. Their requests are refused until registered:
        </Typography>
        <Stack spacing={0.5}>
          {unregisteredDevices.map((entry) => (
            <Stack key={entry.serialNumber} direction="row" spacing={1} alignItems="center">
              <Typography variant="caption" fontFamily="monospace">
                {entry.serialNumber}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {entry.requests} request(s), last {formatRelative(entry.lastSeenAt)}
                {entry.lastSeenIp ? ` from ${entry.lastSeenIp}` : ''}
              </Typography>
              {canEdit && (
                <Button size="small" onClick={() => onRegister(entry.serialNumber)}>
                  Register
                </Button>
              )}
            </Stack>
          ))}
        </Stack>
      </Alert>,
    );
  }

  if (!alerts.length) return null;

  return (
    <Stack spacing={1} sx={{ mb: 2 }}>
      {alerts}
    </Stack>
  );
};

/**
 * What one sync actually did.
 *
 * Reports the gap between found and synced explicitly rather than showing a
 * single success count. "1,400 punches found, 0 synced" is the shape of an
 * unmapped device, and it is the single most likely thing to be wrong here --
 * a dialog that only said "0 synced" would leave nobody any wiser.
 */
const SyncResultDialog = ({ result, onClose }) => {
  if (!result) return null;

  const line = (label, value) => (
    <Stack direction="row" justifyContent="space-between" sx={{ py: 0.5 }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" fontWeight={500}>
        {value}
      </Typography>
    </Stack>
  );

  const skipped = result.punchesFound - result.punchesSynced - (result.duplicates ?? 0) - (result.held ?? 0);

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>
        Sync result — {result.device?.name}
        <Typography variant="caption" color="text.secondary" display="block">
          {result.success ? 'The device answered' : 'The device could not be synced'}
        </Typography>
      </DialogTitle>

      <DialogContent dividers>
        {line('Punches on device', result.punchesFound ?? 0)}
        {line('Punches imported', result.punchesSynced ?? 0)}
        {line('Attendance days updated', result.daysUpdated ?? 0)}
        {result.duplicates > 0 && line('Already imported', result.duplicates)}
        {result.held > 0 && line('Held (locked or corrected days)', result.held)}
        {skipped > 0 &&
          line(
            'Not imported',
            // Older than the high-water mark, or unmapped.
            `${skipped} (before the last sync, or unmapped)`,
          )}

        {result.unmappedUserIds?.length > 0 && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            <Typography variant="body2" gutterBottom>
              {result.unmappedUserIds.length} device user ID(s) are not mapped to an employee. Their punches
              are stored — map them, then use Activity → Import pending punches:
            </Typography>
            <Typography variant="caption" fontFamily="monospace">
              {result.unmappedUserIds.join(', ')}
            </Typography>
          </Alert>
        )}

        {result.unknownEmployeeCodes?.length > 0 && (
          <Alert severity="error" sx={{ mt: 2 }}>
            Mapped to employee codes that do not exist: {result.unknownEmployeeCodes.join(', ')}
          </Alert>
        )}

        {result.errors?.length > 0 && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {result.errors.map((message) => (
              <Typography key={message} variant="caption" display="block">
                {emptyDash(message)}
              </Typography>
            ))}
          </Alert>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};

export default BiometricDevicesSection;
