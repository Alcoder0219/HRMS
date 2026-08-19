import AppSettings from '../../models/admin/appSettings.model.js';
import Employee from '../../models/employee/employee.model.js';

import ApiError from '../../utils/ApiError.js';
import logger from '../../config/logger.js';
import { AUDIT_ACTIONS } from '../../utils/constants.js';
import { recordAudit, diffObjects } from '../../helpers/audit.helper.js';
import biometricSync from '../biometric/biometricSync.service.js';

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

export const listDevices = async (req) => {
  const settings = await load(tenantOf(req));
  return settings.biometricDevices.map(present);
};

/**
 * Two devices on the same address would poll the same terminal twice and
 * import every punch twice, so the pair is treated as an identity.
 */
const assertAddressFree = (settings, { ipAddress, port }, exceptId = null) => {
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

export const addDevice = async (payload, req) => {
  const settings = await load(tenantOf(req));
  assertAddressFree(settings, payload);

  settings.biometricDevices.push({ ...payload, lastSyncStatus: 'NEVER' });
  settings.updatedBy = req.user?.id ?? null;
  await settings.save();

  const device = settings.biometricDevices[settings.biometricDevices.length - 1];

  await recordAudit({
    req,
    entity: 'BiometricDevice',
    entityId: device._id,
    entityLabel: `${device.name} (${device.ipAddress}:${device.port})`,
    action: AUDIT_ACTIONS.CREATE,
    metadata: { protocol: device.protocol, autoSync: device.autoSync },
  });

  logger.info('Biometric device added', { name: device.name, address: `${device.ipAddress}:${device.port}` });

  return present(device);
};

export const updateDevice = async (deviceId, payload, req) => {
  // With secrets: an edit has to be able to tell "no password was ever set"
  // from "the form sent the mask back unchanged".
  const { settings, device } = await loadDevice(tenantOf(req), deviceId, { withSecrets: true });

  assertAddressFree(
    settings,
    { ipAddress: payload.ipAddress ?? device.ipAddress, port: payload.port ?? device.port },
    deviceId,
  );

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
  const label = `${device.name} (${device.ipAddress}:${device.port})`;

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
  const outcome = await biometricSync.testConnection(device);

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
  const { device } = await loadDevice(tenantOf(req), deviceId, { withSecrets: true });

  const users = await biometricSync.getDeviceUsers(device);
  const mapped = new Map((device.userMappings ?? []).map((entry) => [entry.deviceUserId, entry.employeeCode]));

  const rows = users.map((user) => ({
    ...user,
    employeeCode: mapped.get(user.userId) ?? null,
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

export default {
  listDevices,
  addDevice,
  updateDevice,
  removeDevice,
  testDevice,
  syncDevice,
  deviceUsers,
  mapUsers,
};
