import AppSettings from '../../models/admin/appSettings.model.js';
import Employee from '../../models/employee/employee.model.js';

import env from '../../config/env.js';
import ApiError from '../../utils/ApiError.js';
import logger from '../../config/logger.js';
import { ACTIONS, AUDIT_ACTIONS, RESOURCES } from '../../utils/constants.js';
import { recordAudit, diffObjects } from '../../helpers/audit.helper.js';
import { can } from '../../helpers/permission.helper.js';
import { ADMS_COMMANDS, timeZoneOffsetMinutes } from '../../helpers/adms.helper.js';
import { admsSecurityMode } from '../../middlewares/admsGuard.js';
import biometricSync from '../biometric/biometricSync.service.js';
import biometricEvents from '../biometric/biometricEvent.service.js';
import { listUnregisteredSerials } from '../biometric/admsReceiver.service.js';

/**
 * Managing the biometric terminals a tenant owns.
 *
 * Devices live inside the tenant's `AppSettings` document, next to the mail and
 * notification configuration, for the same reason those do: an administrator
 * configures them on one screen, they are read together, and a collection of
 * its own would mean another CRUD path guarding a handful of rows.
 *
 * This module owns the records. `biometricSync.service.js` owns the sockets --
 * nothing here opens one directly.
 */

const tenantOf = (req) => req.user?.tenantId ?? null;

/** How a device is named in logs: its address, or for a push device its serial. */
const addressOf = (device) =>
  device.protocol === 'ADMS_PUSH' ? `SN ${device.serialNumber}` : `${device.ipAddress}:${device.port}`;

/** What a saved password is echoed back as. Never the password itself. */
const MASK = '********';

/**
 * The settings document, created on first use exactly as `getSettings` does.
 *
 * `withSecrets` opts into the device passwords, which are `select: false`.
 * Only the three operations that actually talk to a WDMS server ask for them;
 * everything else -- listing, editing, deleting -- runs without ever loading a
 * credential it has no use for.
 */
const load = async (tenantId, { withSecrets = false } = {}) => {
  const query = AppSettings.findOne({ tenantId });
  if (withSecrets) query.select('+biometricDevices.password');

  const found = await query;
  return found ?? AppSettings.create({ tenantId });
};

/**
 * One device, or a 404.
 *
 * Returns the settings document alongside it because every caller needs to save
 * through the parent -- a Mongoose subdocument cannot persist itself.
 */
const loadDevice = async (tenantId, deviceId, options) => {
  const settings = await load(tenantId, options);
  const device = settings.biometricDevices.id(deviceId);

  if (!device) throw ApiError.notFound('Biometric device not found');
  return { settings, device };
};

/**
 * What the client is allowed to see.
 *
 * The mappings are counted rather than listed: a device with 400 enrolments
 * would otherwise put 400 rows into every settings page load, and the mapping
 * dialog fetches them on demand when somebody actually opens it.
 */
const present = (device) => ({
  _id: device._id,
  name: device.name,
  ipAddress: device.ipAddress,
  port: device.port,
  protocol: device.protocol,
  serialNumber: device.serialNumber,
  location: device.location ?? null,
  notes: device.notes ?? null,
  acceptPunchesFrom: device.acceptPunchesFrom ?? null,

  /**
   * The push session, for an ADMS device -- what the screen needs to say
   * whether the terminal is talking to us. The enrolment list and command
   * history are summarised; the status endpoint has the detail.
   */
  adms:
    device.protocol === 'ADMS_PUSH'
      ? {
          online: biometricSync.isPushDeviceOnline(device, { pollDelaySeconds: env.adms.pollDelaySeconds }),
          lastSeenAt: device.adms?.lastSeenAt ?? null,
          lastSeenIp: device.adms?.lastSeenIp ?? null,
          lastHandshakeAt: device.adms?.lastHandshakeAt ?? null,
          firmware: device.adms?.firmware ?? null,
          pushVersion: device.adms?.pushVersion ?? null,
          lastEventAt: device.adms?.lastEventAt ?? null,
          lastEventReceivedAt: device.adms?.lastEventReceivedAt ?? null,
          enrolmentCount: device.adms?.enrolments?.length ?? 0,
          pendingCommands: (device.adms?.commands ?? []).filter((command) => ['QUEUED', 'SENT'].includes(command.status)).length,
          recentCommands: (device.adms?.commands ?? []).slice(-10).reverse(),
        }
      : null,

  /**
   * The username is shown; the password never is, in any form.
   *
   * What the screen needs to know is whether one is SET, so it can show
   * "unchanged" rather than an empty box that would look like the credential
   * had been lost. The same rule the mail configuration follows.
   */
  username: device.username ?? null,
  passwordSet: Boolean(device.password),
  wdmsTerminalSerial: device.wdmsTerminalSerial ?? null,

  isActive: device.isActive,
  autoSync: device.autoSync,
  syncIntervalMinutes: device.syncIntervalMinutes,
  lastSyncAt: device.lastSyncAt,
  lastAttemptAt: device.lastAttemptAt,
  lastSyncStatus: device.lastSyncStatus ?? 'NEVER',
  lastSyncMessage: device.lastSyncMessage,
  lastSyncPunchCount: device.lastSyncPunchCount,
  mappedUserCount: device.userMappings?.length ?? 0,
  createdAt: device.createdAt,
  updatedAt: device.updatedAt,
});

const EMPTY_COUNTS = { received: 0, imported: 0, unmapped: 0, held: 0, ignored: 0, failed: 0 };

/** Each device with its punch counters, so the list needs no request per row. */
export const listDevices = async (req) => {
  const tenantId = tenantOf(req);
  const [settings, counts] = await Promise.all([load(tenantId), biometricEvents.countsByDevice(tenantId)]);

  return settings.biometricDevices.map((device) => ({
    ...present(device),
    punches: counts.get(String(device._id)) ?? EMPTY_COUNTS,
  }));
};

/**
 * Two devices on the same address would poll the same terminal twice and
 * import every punch twice, so the pair is treated as an identity.
 */
const assertAddressFree = (settings, { ipAddress, port, protocol }, exceptId = null) => {
  // A push device has no address of its own to clash on; its serial is its identity.
  if (protocol === 'ADMS_PUSH') return;

  const clash = settings.biometricDevices.find(
    (entry) =>
      entry.ipAddress === ipAddress &&
      entry.port === port &&
      String(entry._id) !== String(exceptId ?? ''),
  );

  if (clash) {
    throw ApiError.conflict(`${clash.name} is already configured at ${ipAddress}:${port}`);
  }
};

/**
 * An ADMS serial is the device's identity -- the receiver routes every request
 * by it, to a tenant as well as a device -- so it must be unique across the
 * whole installation, not merely within one tenant's settings.
 */
const assertSerialFree = async (serialNumber, exceptId = null) => {
  const clash = await AppSettings.findOne(
    { biometricDevices: { $elemMatch: { serialNumber, protocol: 'ADMS_PUSH' } } },
    { tenantId: 1, biometricDevices: { $elemMatch: { serialNumber, protocol: 'ADMS_PUSH' } } },
  ).lean();

  const device = clash?.biometricDevices?.[0];
  if (device && String(device._id) !== String(exceptId ?? '')) {
    throw ApiError.conflict(`A device with serial ${serialNumber} is already registered`);
  }
};

/**
 * The fields a push device stores differently.
 *
 * Its serial is upper-cased because the receiver upper-cases the one on the
 * wire. It has no address -- whatever is typed in the form would be a guess at
 * the office router's -- and nothing is ever polled, so auto-sync is off.
 */
const normalisePush = (payload, existing = null) => {
  const protocol = payload.protocol ?? existing?.protocol;
  if (protocol !== 'ADMS_PUSH') return payload;

  const serialNumber = String(payload.serialNumber ?? existing?.serialNumber ?? '').trim().toUpperCase();
  if (!serialNumber) throw ApiError.badRequest('An ADMS device needs the serial number shown in its System Info');

  return { ...payload, serialNumber, ipAddress: payload.ipAddress || null, autoSync: false };
};

export const addDevice = async (rawPayload, req) => {
  const payload = normalisePush(rawPayload);
  const settings = await load(tenantOf(req));
  assertAddressFree(settings, payload);
  if (payload.protocol === 'ADMS_PUSH') await assertSerialFree(payload.serialNumber);

  /**
   * A new push device accepts only the last week by default.
   *
   * On its first connection a terminal uploads everything it holds, and the
   * HRMS may already have that period from another source or have paid it.
   * The same seven days a pull device's first sync takes; an administrator
   * who wants the backlog back-dates this and reprocesses.
   */
  const acceptPunchesFrom =
    payload.protocol === 'ADMS_PUSH' && payload.acceptPunchesFrom === undefined
      ? new Date(Date.now() - 7 * 86_400_000)
      : (payload.acceptPunchesFrom ?? null);

  settings.biometricDevices.push({ ...payload, acceptPunchesFrom, lastSyncStatus: 'NEVER' });
  settings.updatedBy = req.user?.id ?? null;
  await settings.save();

  const device = settings.biometricDevices[settings.biometricDevices.length - 1];

  await recordAudit({
    req,
    entity: 'BiometricDevice',
    entityId: device._id,
    entityLabel: `${device.name} (${addressOf(device)})`,
    action: AUDIT_ACTIONS.CREATE,
    metadata: { protocol: device.protocol, autoSync: device.autoSync },
  });

  logger.info('Biometric device added', { name: device.name, address: addressOf(device) });

  return present(device);
};

export const updateDevice = async (deviceId, rawPayload, req) => {
  // With secrets: an edit has to be able to tell "no password was ever set"
  // from "the form sent the mask back unchanged".
  const { settings, device } = await loadDevice(tenantOf(req), deviceId, { withSecrets: true });
  const payload = normalisePush(rawPayload, device);

  assertAddressFree(
    settings,
    {
      ipAddress: payload.ipAddress ?? device.ipAddress,
      port: payload.port ?? device.port,
      protocol: payload.protocol ?? device.protocol,
    },
    deviceId,
  );

  if ((payload.protocol ?? device.protocol) === 'ADMS_PUSH') {
    await assertSerialFree(payload.serialNumber ?? device.serialNumber, deviceId);
  }

  const before = device.toObject();

  /**
   * An absent or masked password leaves the stored one alone.
   *
   * Without this rule, opening the dialog and changing the port would blank the
   * WDMS credential -- the form never held the real value to send back, so it
   * would post the mask and overwrite a working password with it.
   */
  const { password, ...rest } = payload;

  // The sync bookkeeping is written by the sync service, never by an edit --
  // letting a form post `lastSyncAt` would hand a client control over which
  // punches get imported. `stripUnknown` on the validator already drops it;
  // this destructure is what keeps the password out of the same loop.
  Object.entries(rest).forEach(([key, value]) => {
    device[key] = value;
  });

  if (password !== undefined && password !== MASK && password !== '') {
    device.password = password;
  }

  settings.updatedBy = req.user?.id ?? null;
  await settings.save();

  const changes = diffObjects(before, device.toObject()).filter(
    // Mappings are audited by their own action, and the password must never
    // reach an audit record in either its old or its new form.
    (change) => !change.field.startsWith('userMappings') && change.field !== 'password',
  );

  if (changes.length) {
    await recordAudit({
      req,
      entity: 'BiometricDevice',
      entityId: device._id,
      entityLabel: device.name,
      action: AUDIT_ACTIONS.UPDATE,
      changes,
    });
  }

  return present(device);
};

export const removeDevice = async (deviceId, req) => {
  const { settings, device } = await loadDevice(tenantOf(req), deviceId);
  const label = `${device.name} (${addressOf(device)})`;

  device.deleteOne();
  settings.updatedBy = req.user?.id ?? null;
  await settings.save();

  await recordAudit({
    req,
    entity: 'BiometricDevice',
    entityId: deviceId,
    entityLabel: label,
    action: AUDIT_ACTIONS.DELETE,
  });

  logger.info('Biometric device removed', { device: label });

  return { removed: true, deviceId };
};

/* -------------------------------------------------------------------------- */
/*                             Device operations                              */
/* -------------------------------------------------------------------------- */

/**
 * Reachability check.
 *
 * The result is recorded on the device so the list can show that a terminal
 * answered, without a successful test being mistaken for a successful sync --
 * `lastSyncAt` is untouched here.
 */
export const testDevice = async (deviceId, req) => {
  const { settings, device } = await loadDevice(tenantOf(req), deviceId, { withSecrets: true });
  const outcome = await biometricSync.testConnection(device, { pollDelaySeconds: env.adms.pollDelaySeconds });

  // A push device's "test" only reads what the receiver recorded. Writing a
  // FAILED status from it would overwrite the last real upload's result with
  // an opinion about a heartbeat.
  if (device.protocol === 'ADMS_PUSH') return { ...outcome, device: present(device) };

  device.lastAttemptAt = new Date();

  // A serial read from the device beats one typed in by hand, and the sync
  // uses it as the `deviceId` stamped on every punch.
  if (outcome.connected && outcome.info?.serialNumber && !device.serialNumber) {
    device.serialNumber = outcome.info.serialNumber;
  }

  if (!outcome.connected) {
    device.lastSyncStatus = 'FAILED';
    device.lastSyncMessage = String(outcome.error).slice(0, 500);
  }

  await settings.save();

  return { ...outcome, device: present(device) };
};

/**
 * A sync started by a person rather than the schedule.
 *
 * Runs under the caller's own request, so the attendance rows and the audit
 * entry are attributed to them rather than to SYSTEM.
 */
export const syncDevice = async (deviceId, req) => {
  const tenantId = tenantOf(req);
  const { device } = await loadDevice(tenantId, deviceId, { withSecrets: true });

  if (device.protocol === 'ADMS_PUSH') {
    throw ApiError.badRequest(
      'An ADMS device pushes its punches as they happen. Use "Request upload" to ask it to resend a date range.',
    );
  }

  const result = await biometricSync.syncAttendanceLogs(device, tenantId, req);

  await recordAudit({
    req,
    entity: 'BiometricDevice',
    entityId: device._id,
    entityLabel: device.name,
    action: AUDIT_ACTIONS.IMPORT,
    metadata: {
      trigger: 'MANUAL',
      punchesFound: result.punchesFound,
      punchesSynced: result.punchesSynced,
      daysUpdated: result.daysUpdated,
      unmapped: result.unmappedUserIds.length,
    },
  });

  // Re-read: the sync writes its own bookkeeping straight to the collection.
  const { device: refreshed } = await loadDevice(tenantId, deviceId);
  return { ...result, device: present(refreshed) };
};

/**
 * Everyone enrolled on the terminal, beside the mapping already held for them.
 *
 * Returned together so the dialog can render the whole picture from one call --
 * who the device knows, who they map to, and who is not mapped at all.
 */
export const deviceUsers = async (deviceId, req) => {
  const tenantId = tenantOf(req);
  const { device } = await loadDevice(tenantId, deviceId, { withSecrets: true });

  /**
   * A device or WDMS server that cannot be read is an answer, not a crash.
   *
   * The transport throws plain Errors -- wrong credentials, an API the account
   * may not use, a timeout -- and the error handler hides any non-ApiError
   * behind "Internal server error" in production. That left the mapping dialog
   * with nothing to act on. A 502 carries the upstream's own reason instead.
   */
  let users;
  try {
    users = await biometricSync.getDeviceUsers(device, { tenantId });
  } catch (error) {
    if (error instanceof ApiError) throw error;

    logger.warn('Could not read users from biometric device', {
      device: device.name,
      protocol: device.protocol,
      error: error.message,
    });
    throw new ApiError(502, `Could not read the user list from ${device.name}: ${error.message}`);
  }
  const mapped = new Map((device.userMappings ?? []).map((entry) => [entry.deviceUserId, entry.employeeCode]));

  /**
   * A push device's roster is only what it has chosen to report, so a mapping
   * missing from it is not evidence the enrolment is gone. Listed with the
   * name it was saved under, so it is shown -- and kept on save -- rather than
   * reported as orphaned and dropped.
   */
  if (device.protocol === 'ADMS_PUSH') {
    const listed = new Set(users.map((user) => user.userId));
    (device.userMappings ?? [])
      .filter((entry) => !listed.has(entry.deviceUserId))
      .forEach((entry) =>
        users.push({ userId: entry.deviceUserId, name: entry.deviceUserName ?? null, role: null, cardNumber: null }),
      );
  }

  // How many stored punches each ID has waiting -- which unmapped person to
  // map first is the one who has been clocking in all week.
  const waiting = new Map(
    (await biometricEvents.unmappedUsers(tenantId, device._id)).map((entry) => [entry.deviceUserId, entry]),
  );

  const rows = users.map((user) => ({
    ...user,
    employeeCode: mapped.get(user.userId) ?? null,
    unmappedPunches: waiting.get(user.userId)?.punches ?? 0,
    lastPunchAt: waiting.get(user.userId)?.lastPunchAt ?? null,
  }));

  /**
   * Mappings whose enrolment is gone from the device.
   *
   * Surfaced rather than deleted: an enrolment removed by accident is
   * recoverable, and silently dropping the mapping would lose the record of who
   * that device ID belonged to.
   */
  const deviceIds = new Set(users.map((user) => user.userId));
  const orphaned = (device.userMappings ?? [])
    .filter((entry) => !deviceIds.has(entry.deviceUserId))
    .map((entry) => ({ deviceUserId: entry.deviceUserId, employeeCode: entry.employeeCode }));

  return {
    users: rows,
    orphanedMappings: orphaned,
    mappedCount: rows.filter((row) => row.employeeCode).length,
    unmappedCount: rows.filter((row) => !row.employeeCode).length,
  };
};

/**
 * Replaces the device's mapping table.
 *
 * A whole-table write rather than a per-row patch: the dialog edits every row
 * at once, and merging would leave a mapping the administrator had just cleared
 * still in place.
 *
 * Employee codes are verified against the tenant's own employees before they
 * are stored. A mapping to a code that does not exist would look configured on
 * screen and silently drop that person's punches at every sync -- which is the
 * failure this whole feature exists to prevent.
 */
export const mapUsers = async (deviceId, mappings, req) => {
  const tenantId = tenantOf(req);
  const { settings, device } = await loadDevice(tenantId, deviceId);

  const cleaned = (mappings ?? [])
    .filter((entry) => entry?.deviceUserId && entry?.employeeCode)
    .map((entry) => ({
      deviceUserId: String(entry.deviceUserId).trim(),
      employeeCode: String(entry.employeeCode).trim().toUpperCase(),
      deviceUserName: entry.deviceUserName ?? null,
    }));

  const duplicated = cleaned
    .map((entry) => entry.deviceUserId)
    .filter((id, index, all) => all.indexOf(id) !== index);

  if (duplicated.length) {
    throw ApiError.badRequest(`Device user ID mapped more than once: ${[...new Set(duplicated)].join(', ')}`);
  }

  const codes = [...new Set(cleaned.map((entry) => entry.employeeCode))];

  if (codes.length) {
    const known = await Employee.find({
      tenantId: tenantId ?? null,
      employeeCode: { $in: codes },
      deletedAt: null,
    })
      .select('employeeCode')
      .lean();

    const found = new Set(known.map((employee) => employee.employeeCode));
    const missing = codes.filter((code) => !found.has(code));

    if (missing.length) {
      throw ApiError.unprocessable(
        'Some employee codes do not exist',
        missing.map((code) => ({ field: 'mappings', message: `Unknown employee code: ${code}` })),
      );
    }
  }

  const previous = device.userMappings?.length ?? 0;
  device.userMappings = cleaned;

  settings.updatedBy = req.user?.id ?? null;
  await settings.save();

  await recordAudit({
    req,
    entity: 'BiometricDevice',
    entityId: device._id,
    entityLabel: device.name,
    action: AUDIT_ACTIONS.BULK_UPDATE,
    metadata: { mappings: cleaned.length, previous },
  });

  logger.info('Biometric user mappings saved', { device: device.name, mappings: cleaned.length });

  return { ...present(device), userMappings: cleaned };
};

/* -------------------------------------------------------------------------- */
/*                          Events, logs and reprocess                        */
/* -------------------------------------------------------------------------- */

/**
 * Everything the device's status panel shows, in one call: the device, the
 * event counters, and the review queue of unmapped IDs.
 */
export const deviceStatus = async (deviceId, req) => {
  const tenantId = tenantOf(req);
  const { device } = await loadDevice(tenantId, deviceId);

  const [stats, unmapped] = await Promise.all([
    biometricEvents.deviceStats(tenantId, device._id),
    biometricEvents.unmappedUsers(tenantId, device._id),
  ]);

  const names = new Map((device.adms?.enrolments ?? []).map((entry) => [entry.userId, entry.name]));

  return {
    device: present(device),
    stats,
    unmappedUsers: unmapped.map((entry) => ({ ...entry, name: names.get(entry.deviceUserId) ?? null })),
  };
};

export const deviceEvents = async (deviceId, query, req) => {
  const tenantId = tenantOf(req);
  const { device } = await loadDevice(tenantId, deviceId);
  return biometricEvents.listEvents(tenantId, device._id, query);
};

export const deviceLogs = async (deviceId, query, req) => {
  const tenantId = tenantOf(req);
  const { device } = await loadDevice(tenantId, deviceId);
  return biometricEvents.listLogs(tenantId, device._id, query);
};

/**
 * Re-applies the device's stored events that are not yet in attendance.
 *
 * Optionally moves the accept-from date first, which is how a backlog the
 * device uploaded on its first connection is deliberately imported.
 * Including HELD events overrides manual corrections and is audited as such.
 */
export const reprocessDevice = async (deviceId, options, req) => {
  /**
   * Overriding a correction is an attendance decision, not device admin.
   *
   * The route already requires tenant:update. Re-applying HELD punches
   * additionally requires the authority to correct attendance by hand --
   * attendance:approve, the same grant the manual-entry endpoint demands --
   * because that is exactly what it does.
   */
  if (options.includeHeld && !can(req.user?.role, RESOURCES.ATTENDANCE, ACTIONS.APPROVE)) {
    throw ApiError.forbidden('Applying held punches over corrected days requires attendance approval rights');
  }

  const tenantId = tenantOf(req);
  const { settings, device } = await loadDevice(tenantId, deviceId);

  if (options.acceptPunchesFrom !== undefined) {
    device.acceptPunchesFrom = options.acceptPunchesFrom ? new Date(options.acceptPunchesFrom) : null;
    settings.updatedBy = req.user?.id ?? null;
    await settings.save();
  }

  const result = await biometricEvents.reprocessEvents({
    tenantId,
    device: device.toObject(),
    includeHeld: Boolean(options.includeHeld),
    includeIgnored: Boolean(options.includeIgnored),
    from: options.from ?? null,
    to: options.to ?? null,
    req,
  });

  await recordAudit({
    req,
    entity: 'BiometricDevice',
    entityId: device._id,
    entityLabel: device.name,
    action: AUDIT_ACTIONS.IMPORT,
    metadata: {
      trigger: 'REPROCESS',
      includeHeld: Boolean(options.includeHeld),
      includeIgnored: Boolean(options.includeIgnored),
      acceptPunchesFrom: options.acceptPunchesFrom ?? undefined,
      examined: result.received,
      imported: result.imported,
      held: result.held,
      stillUnmapped: result.unmapped,
    },
  });

  return result;
};

/** How long a date range may be. A terminal re-uploading a year would take hours. */
const MAX_UPLOAD_RANGE_DAYS = 62;

/**
 * Queues a request for an ADMS terminal to do something on its next poll.
 *
 * Only the whitelisted read commands exist -- see `ADMS_COMMANDS`. Whether a
 * particular firmware honours `DATA QUERY ATTLOG` is not something the server
 * can know in advance; the command's return code is recorded when the device
 * reports it, and the screen shows it.
 */
export const queueCommand = async (deviceId, { type, from = null, to = null }, req) => {
  const tenantId = tenantOf(req);
  const { settings, device } = await loadDevice(tenantId, deviceId);

  if (device.protocol !== 'ADMS_PUSH') {
    throw ApiError.badRequest('Commands can only be queued for an ADMS_PUSH device');
  }

  if (!Object.values(ADMS_COMMANDS).includes(type)) {
    throw ApiError.badRequest(`Unsupported command: ${type}`);
  }

  if (type === ADMS_COMMANDS.QUERY_ATTLOG) {
    if (!from || !to || new Date(from) > new Date(to)) {
      throw ApiError.badRequest('An upload request needs a start and an end, in that order');
    }
    if ((new Date(to) - new Date(from)) / 86_400_000 > MAX_UPLOAD_RANGE_DAYS) {
      throw ApiError.badRequest(`Request at most ${MAX_UPLOAD_RANGE_DAYS} days at a time`);
    }
  }

  device.adms = device.adms ?? {};
  const commandId = device.adms.nextCommandId ?? 1;

  device.adms.commands = [
    // History is kept short; the sync log carries the long record.
    ...(device.adms.commands ?? []).slice(-49),
    {
      commandId,
      type,
      from: from ? new Date(from) : null,
      to: to ? new Date(to) : null,
      status: 'QUEUED',
      queuedAt: new Date(),
      requestedBy: req.user?.id ?? null,
    },
  ];
  device.adms.nextCommandId = commandId + 1;

  settings.updatedBy = req.user?.id ?? null;
  await settings.save();

  await recordAudit({
    req,
    entity: 'BiometricDevice',
    entityId: device._id,
    entityLabel: device.name,
    action: AUDIT_ACTIONS.UPDATE,
    metadata: { command: type, commandId, from, to },
  });

  return present(device);
};

/* -------------------------------------------------------------------------- */
/*                             Integration status                             */
/* -------------------------------------------------------------------------- */

const serverTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';

/**
 * Whether device timestamps and shift rules are being read in the office's zone.
 *
 * Shift start times, lateness and the day boundary are all evaluated in the
 * SERVER's local zone -- that is how the attendance engine has always worked,
 * and this integration does not change it. A server running in UTC for an
 * office in Dar es Salaam would grade a 09:00 shift as starting at noon. That
 * is a deployment setting (TZ), and it is reported rather than worked around.
 */
const timeZoneCheck = (companyTimeZone) => {
  const server = serverTimeZone();
  const serverOffset = -new Date().getTimezoneOffset();
  const deviceZone = env.biometricTimeZone ?? server;

  let companyOffset = null;
  try {
    companyOffset = companyTimeZone ? timeZoneOffsetMinutes(companyTimeZone) : null;
  } catch {
    companyOffset = null;
  }

  const warnings = [];
  if (companyOffset !== null && companyOffset !== serverOffset) {
    warnings.push(
      `The server runs in ${server} (UTC${serverOffset >= 0 ? '+' : ''}${serverOffset / 60}) but the company is in ` +
        `${companyTimeZone}. Shift times and the attendance day are evaluated in the server's zone — set TZ=${companyTimeZone} on the backend.`,
    );
  }

  return { serverTimeZone: server, serverUtcOffsetMinutes: serverOffset, deviceTimeZone: deviceZone, companyTimeZone, warnings };
};

/** The receiver's configuration and every device's link state, for the settings screen. */
export const integrationStatus = async (req) => {
  const settings = await load(tenantOf(req));

  return {
    receiver: {
      enabled: env.adms.enabled,
      path: '/iclock',
      securityMode: env.adms.enabled ? admsSecurityMode() : 'DISABLED',
      gatewayTokenConfigured: Boolean(env.adms.gatewayToken),
      allowedIpCount: env.adms.allowedIps.length,
      pollDelaySeconds: env.adms.pollDelaySeconds,
      // The values to enter on the terminal itself.
      deviceSettings: {
        serverMode: 'ADMS',
        serverAddress: env.adms.deviceServerAddress,
        serverPort: env.adms.deviceServerPort,
        https: env.adms.deviceServerHttps,
        enableDomainName: Boolean(env.adms.deviceServerAddress && !/^[\d.]+$/.test(env.adms.deviceServerAddress)),
      },
    },
    time: timeZoneCheck(settings.company?.timezone ?? null),
    unregisteredDevices: env.adms.enabled ? listUnregisteredSerials() : [],
    devices: settings.biometricDevices.map((device) => ({
      _id: device._id,
      name: device.name,
      protocol: device.protocol,
      serialNumber: device.serialNumber,
      isActive: device.isActive,
      online: device.protocol === 'ADMS_PUSH' ? present(device).adms.online : null,
      lastSyncAt: device.lastSyncAt,
      lastSyncStatus: device.lastSyncStatus ?? 'NEVER',
    })),
    checkedAt: new Date(),
  };
};

export default {
  listDevices,
  addDevice,
  updateDevice,
  removeDevice,
  testDevice,
  syncDevice,
  deviceUsers,
  mapUsers,
  deviceStatus,
  deviceEvents,
  deviceLogs,
  reprocessDevice,
  queueCommand,
  integrationStatus,
};
