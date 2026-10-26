import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid';
import MenuItem from '@mui/material/MenuItem';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import FormDialog from '@components/common/FormDialog.jsx';

/**
 * Add or revise one attendance terminal.
 *
 * The same dialog for both, pre-filled when editing: the fields are identical,
 * and two dialogs would be two places to add the next one.
 */

/**
 * Mirrors the enum on `biometricDeviceSchema`. A value not in this list would
 * fail validation rather than add support for a device.
 *
 * The help text leads with REACHABILITY, because that is the choice being made
 * here and the one that is invisible until it fails. The two socket protocols
 * cannot cross NAT, so pointing either at a public address produces a timeout
 * indistinguishable from a switched-off device.
 */
const PROTOCOLS = [
  {
    value: 'ZK_UDP',
    label: 'ZKTeco SDK — UDP',
    help: 'The usual SDK transport on port 4370. Requires LAN access — does not work over the internet.',
  },
  {
    value: 'ZK_TCP',
    label: 'ZKTeco SDK — TCP',
    help: 'TCP SDK transport on port 4370. Requires LAN access — does not work over the internet.',
  },
  {
    value: 'ZK_WEB',
    label: 'ZKTeco terminal — Web API',
    help: 'HTTP API on port 8081. Works over the internet — no LAN required.',
  },
  {
    value: 'GENERIC_API',
    label: 'Generic HTTP API',
    help: 'Any endpoint serving ZKTeco-style tab-separated data over HTTP.',
  },
  {
    value: 'WDMS_API',
    label: 'ZKTeco WDMS / BioTime server',
    help: 'A server that terminals push to, not a terminal itself. Works over the internet; needs a username and password.',
  },
  {
    value: 'ADMS_PUSH',
    label: 'ZKTeco ADMS push — terminal calls this HRMS',
    help: 'The terminal’s Cloud Server setting (Server Mode: ADMS) points at this HRMS or the office gateway. Nothing is polled; the device is recognised by its serial number.',
  },
];

/** Socket protocols answer on 4370; every HTTP one on 8081. */
const DEFAULT_PORT = { ZK_UDP: 4370, ZK_TCP: 4370, ZK_WEB: 8081, GENERIC_API: 8081, WDMS_API: 8081, ADMS_PUSH: 8081 };

/** `yyyy-MM-dd` for a date input, from whatever the API sent. */
const toDateInput = (value) => (value ? new Date(value).toISOString().slice(0, 10) : '');

/** What a saved password is shown as. Posting it back means "leave it alone". */
const MASK = '********';

const EMPTY = {
  name: '',
  ipAddress: '',
  port: '4370',
  protocol: 'ZK_UDP',
  serialNumber: '',
  username: '',
  password: '',
  wdmsTerminalSerial: '',
  acceptPunchesFrom: '',
  isActive: true,
  autoSync: true,
  syncIntervalMinutes: '5',
};

/**
 * `prefill` seeds a NEW device -- the settings screen passes a serial that
 * called in unregistered, so registering it is one click rather than retyping.
 */
const BiometricDeviceDialog = ({ open, device, prefill = null, submitting, error, onSubmit, onClose }) => {
  const [form, setForm] = useState(EMPTY);

  useEffect(() => {
    if (!open) return;

    setForm(
      device
        ? {
            name: device.name ?? '',
            ipAddress: device.ipAddress ?? '',
            port: String(device.port ?? 4370),
            protocol: device.protocol ?? 'ZK_UDP',
            serialNumber: device.serialNumber ?? '',
            username: device.username ?? '',
            // The real password never leaves the server. The mask stands in for
            // it, and posting the mask back leaves the stored one alone.
            password: device.passwordSet ? MASK : '',
            wdmsTerminalSerial: device.wdmsTerminalSerial ?? '',
            acceptPunchesFrom: toDateInput(device.acceptPunchesFrom),
            isActive: device.isActive ?? true,
            autoSync: device.autoSync ?? true,
            syncIntervalMinutes: String(device.syncIntervalMinutes ?? 5),
          }
        : {
            ...EMPTY,
            ...(prefill?.protocol ? { protocol: prefill.protocol, port: String(DEFAULT_PORT[prefill.protocol]) } : {}),
            ...(prefill?.serialNumber ? { serialNumber: prefill.serialNumber } : {}),
          },
    );
  }, [open, device, prefill]);

  const set = (field) => (event) =>
    setForm((previous) => ({
      ...previous,
      [field]: event.target.type === 'checkbox' ? event.target.checked : event.target.value,
    }));

  /**
   * Changing the protocol moves the port with it -- but only while the port is
   * still the previous protocol's default. A number somebody typed themselves
   * is theirs and is left alone.
   */
  const setProtocol = (event) => {
    const protocol = event.target.value;

    setForm((previous) => ({
      ...previous,
      protocol,
      port: Object.values(DEFAULT_PORT).includes(Number(previous.port))
        ? String(DEFAULT_PORT[protocol])
        : previous.port,
    }));
  };

  const chosen = PROTOCOLS.find((entry) => entry.value === form.protocol);
  const needsCredentials = form.protocol === 'WDMS_API';
  // A push terminal calls in: it has no address to type, nothing to poll, and
  // its serial number is its whole identity.
  const isPush = form.protocol === 'ADMS_PUSH';

  const handleSubmit = () =>
    onSubmit({
      name: form.name.trim(),
      ...(isPush ? {} : { ipAddress: form.ipAddress.trim() }),
      port: Number(form.port) || DEFAULT_PORT[form.protocol],
      protocol: form.protocol,
      serialNumber: form.serialNumber.trim() || null,
      isActive: form.isActive,
      autoSync: isPush ? false : form.autoSync,
      syncIntervalMinutes: Number(form.syncIntervalMinutes) || 5,
      ...(isPush
        ? {
            // Midnight local time on the chosen day; blank means "accept everything".
            acceptPunchesFrom: form.acceptPunchesFrom ? new Date(`${form.acceptPunchesFrom}T00:00:00`).toISOString() : null,
          }
        : {}),

      /**
       * Credentials go only with the protocol that uses them.
       *
       * An unchanged password is sent as the mask, which the server reads as
       * "leave it as it is" -- the form never held the real value to resend.
       */
      ...(needsCredentials
        ? {
            username: form.username.trim(),
            password: form.password,
            wdmsTerminalSerial: form.wdmsTerminalSerial.trim() || null,
          }
        : {}),
    });

  // A new WDMS device needs real credentials; an existing one may keep the ones
  // already stored, which is what the mask stands for.
  const credentialsMissing =
    needsCredentials && (!form.username.trim() || !form.password || form.password === '');

  return (
    <FormDialog
      open={open}
      title={device ? `Edit ${device.name}` : 'Add biometric device'}
      subtitle="The terminal is polled on its own interval and its punches feed straight into attendance"
      error={error}
      submitting={submitting}
      submitLabel={device ? 'Save device' : 'Add device'}
      disabled={
        !form.name.trim() ||
        (isPush ? !/^[A-Za-z0-9_-]{4,60}$/.test(form.serialNumber.trim()) : !form.ipAddress.trim() || !Number(form.port)) ||
        credentialsMissing
      }
      onSubmit={handleSubmit}
      onClose={onClose}
      maxWidth="sm"
    >
      <Grid container spacing={2} sx={{ pt: 0.5 }}>
        <Grid size={12}>
          <TextField
            label="Device name"
            size="small"
            fullWidth
            required
            value={form.name}
            onChange={set('name')}
            helperText="How it is identified on this screen — for example “Main gate”"
          />
        </Grid>

        {!isPush && (
          <>
            <Grid size={{ xs: 12, sm: 8 }}>
              <TextField
                label="IP address or hostname"
                size="small"
                fullWidth
                required
                value={form.ipAddress}
                onChange={set('ipAddress')}
                placeholder="192.168.1.201"
              />
            </Grid>

            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                label="Port"
                type="number"
                size="small"
                fullWidth
                required
                value={form.port}
                onChange={set('port')}
                slotProps={{ input: { inputProps: { min: 1, max: 65535 } } }}
              />
            </Grid>
          </>
        )}

        <Grid size={12}>
          <TextField
            select
            label="Protocol"
            size="small"
            fullWidth
            value={form.protocol}
            onChange={setProtocol}
            helperText={chosen?.help}
          >
            {PROTOCOLS.map((protocol) => (
              <MenuItem key={protocol.value} value={protocol.value}>
                {protocol.label}
              </MenuItem>
            ))}
          </TextField>
        </Grid>

        {needsCredentials && (
          <>
            <Grid size={12}>
              <Alert severity="info" variant="outlined">
                A WDMS or BioTime server collects punches from every terminal registered to it. Point this at
                the server rather than at a terminal, and the punches arrive without the HRMS ever needing to
                reach the hardware.
              </Alert>
            </Grid>

            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Username"
                size="small"
                fullWidth
                required
                autoComplete="off"
                value={form.username}
                onChange={set('username')}
              />
            </Grid>

            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Password"
                type="password"
                size="small"
                fullWidth
                required
                autoComplete="new-password"
                value={form.password}
                onChange={set('password')}
                helperText={
                  device?.passwordSet
                    ? 'A password is saved. Leave this as it is to keep it.'
                    : 'Stored encrypted at rest and never returned to this screen.'
                }
              />
            </Grid>

            <Grid size={12}>
              <TextField
                label="Terminal serial (optional)"
                size="small"
                fullWidth
                value={form.wdmsTerminalSerial}
                onChange={set('wdmsTerminalSerial')}
                helperText="Restricts the pull to one terminal on the server. Leave blank to take punches from all of them."
              />
            </Grid>
          </>
        )}

        {isPush && (
          <Grid size={12}>
            <Alert severity="info" variant="outlined">
              The terminal must reach this HRMS — directly over HTTPS, or through the office gateway. Punches
              are accepted only from a serial number registered here, and only through the gateway token or
              office IP allowlist configured on the server.
            </Alert>
          </Grid>
        )}

        <Grid size={12}>
          <TextField
            label="Serial number"
            size="small"
            fullWidth
            required={isPush}
            value={form.serialNumber}
            onChange={set('serialNumber')}
            helperText={
              isPush
                ? 'Required. Exactly as shown on the terminal under System Info → Device Info (Serial Number).'
                : 'Optional. Read from the device on a successful test, and stamped on every punch it produces.'
            }
          />
        </Grid>

        {isPush && (
          <Grid size={12}>
            <TextField
              label="Accept punches from"
              type="date"
              size="small"
              fullWidth
              value={form.acceptPunchesFrom}
              onChange={set('acceptPunchesFrom')}
              slotProps={{ inputLabel: { shrink: true } }}
              helperText="On its first connection a terminal uploads everything in its memory. Older punches are stored for review but not applied to attendance. New devices default to the last 7 days."
            />
          </Grid>
        )}

        <Grid size={{ xs: 12, sm: 6 }}>
          <FormControlLabel
            control={<Switch checked={form.isActive} onChange={set('isActive')} />}
            label="Device active"
          />
        </Grid>

        {!isPush && (
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControlLabel
              control={<Switch checked={form.autoSync} onChange={set('autoSync')} />}
              label="Sync automatically"
            />
          </Grid>
        )}

        {!isPush && form.autoSync && (
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Sync every (minutes)"
              type="number"
              size="small"
              fullWidth
              value={form.syncIntervalMinutes}
              onChange={set('syncIntervalMinutes')}
              slotProps={{ input: { inputProps: { min: 1, max: 1440 } } }}
              helperText="One minute is the floor — the scheduler ticks once a minute"
            />
          </Grid>
        )}

        <Grid size={12}>
          <Typography variant="caption" color="text.secondary">
            A device with no user mappings imports nothing. Once it is saved, use{' '}
            <strong>Map users</strong> to match its enrolments to employees.
          </Typography>
        </Grid>
      </Grid>
    </FormDialog>
  );
};

export default BiometricDeviceDialog;
