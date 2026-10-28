import asyncHandler from '../../utils/asyncHandler.js';
import ApiError from '../../utils/ApiError.js';
import ApiResponse from '../../utils/ApiResponse.js';

import userService from '../../services/admin/user.service.js';
import auditService from '../../services/admin/audit.service.js';
import settingsService from '../../services/admin/settings.service.js';
import backupService from '../../services/admin/backup.service.js';
import biometricDeviceService from '../../services/admin/biometricDevice.service.js';

import { buildWorkbook } from '../../helpers/excel.helper.js';
import { buildTablePdf } from '../../helpers/pdf.helper.js';

const query = (req) => req.validatedQuery ?? req.query ?? {};

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/* -------------------------------------------------------------------------- */
/*                                    Users                                   */
/* -------------------------------------------------------------------------- */

export const listUsers = asyncHandler(async (req, res) => {
  const result = await userService.listUsers(query(req), req);
  return ApiResponse.paginated(res, result.items, {
    page: result.page,
    limit: result.limit,
    total: result.total,
  });
});

export const getUser = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await userService.getUser(req.params.id, req), 'User'),
);

export const createUser = asyncHandler(async (req, res) =>
  ApiResponse.created(res, await userService.createUser(req.body, req), 'User created'),
);

export const updateUser = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await userService.updateUser(req.params.id, req.body, req), 'User updated'),
);

export const setUserStatus = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await userService.setStatus(req.params.id, req.body, req), 'Account status changed'),
);

export const unlockUser = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await userService.unlockUser(req.params.id, req), 'Account unlocked'),
);

export const resetUserPassword = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await userService.resetPassword(req.params.id, req.body, req), 'Password reset'),
);

export const revokeUserSessions = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await userService.revokeSessions(req.params.id, req), 'Sessions revoked'),
);

export const deleteUser = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await userService.deleteUser(req.params.id, req), 'User deleted'),
);

export const userSummary = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await userService.userSummary(req), 'User summary'),
);

const USER_COLUMNS = [
  { header: 'Email', key: 'email', width: 32 },
  { header: 'First name', key: 'firstName', width: 18 },
  { header: 'Last name', key: 'lastName', width: 18 },
  { header: 'Role', key: 'role', width: 16 },
  { header: 'Status', key: 'status', width: 14 },
  { header: 'Email verified', key: 'isEmailVerified', width: 14 },
  { header: 'Last sign-in', key: 'lastLoginAt', width: 22 },
];

export const exportUsers = asyncHandler(async (req, res) => {
  // Every matching user, not the page the screen happened to show.
  const result = await userService.listUsers({ ...query(req), page: 1, limit: 10_000 }, req);

  const buffer = await buildWorkbook({
    sheetName: 'Users',
    columns: USER_COLUMNS,
    rows: result.items.map((user) => ({
      ...user,
      isEmailVerified: user.isEmailVerified ? 'Yes' : 'No',
      lastLoginAt: user.lastLoginAt ? new Date(user.lastLoginAt).toISOString() : '',
    })),
  });

  res.setHeader('Content-Type', XLSX_MIME);
  res.setHeader('Content-Disposition', 'attachment; filename="users.xlsx"');
  res.setHeader('X-Total-Count', String(result.total));

  return res.status(200).send(Buffer.from(buffer));
});

/* -------------------------------------------------------------------------- */
/*                          Audit and activity logs                           */
/* -------------------------------------------------------------------------- */

export const listAuditLogs = asyncHandler(async (req, res) => {
  const result = await auditService.listAuditLogs(query(req), req);
  return ApiResponse.paginated(res, result.items, {
    page: result.page,
    limit: result.limit,
    total: result.total,
  });
});

export const getAuditLog = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await auditService.getAuditLog(req.params.id, req), 'Audit entry'),
);

export const auditFilters = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await auditService.auditFilters(req), 'Available filters'),
);

export const listLoginHistory = asyncHandler(async (req, res) => {
  const result = await auditService.listLoginHistory(query(req), req);
  return ApiResponse.paginated(res, result.items, {
    page: result.page,
    limit: result.limit,
    total: result.total,
  });
});

export const activityFeed = asyncHandler(async (req, res) => {
  const result = await auditService.activityFeed(query(req), req);
  return ApiResponse.paginated(res, result.items, {
    page: result.page,
    limit: result.limit,
    total: result.total,
  });
});

export const activityStats = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await auditService.activityStats(query(req), req), 'Activity statistics'),
);

const AUDIT_COLUMNS = [
  { header: 'When', key: 'occurredAt', width: 22 },
  { header: 'Actor', key: 'actorEmail', width: 30 },
  { header: 'Role', key: 'actorRole', width: 16 },
  { header: 'Action', key: 'action', width: 14 },
  { header: 'Entity', key: 'entity', width: 18 },
  { header: 'Record', key: 'entityLabel', width: 34 },
  { header: 'Fields changed', key: 'changeCount', width: 14 },
  { header: 'IP', key: 'ip', width: 16 },
];

export const exportAuditLogs = asyncHandler(async (req, res) => {
  const result = await auditService.listAuditLogs({ ...query(req), page: 1, limit: 10_000 }, req);

  const rows = result.items.map((entry) => ({
    ...entry,
    occurredAt: entry.occurredAt ? new Date(entry.occurredAt).toISOString() : '',
  }));

  if (query(req).format === 'pdf') {
    const buffer = await buildTablePdf({
      title: 'Audit log',
      subtitle: `${result.total} entr(ies)`,
      columns: AUDIT_COLUMNS.map((column) => ({
        header: column.header,
        key: column.key,
        width: column.width * 6,
      })),
      rows,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="audit-log.pdf"');
    return res.status(200).send(buffer);
  }

  const buffer = await buildWorkbook({ sheetName: 'Audit log', columns: AUDIT_COLUMNS, rows });

  res.setHeader('Content-Type', XLSX_MIME);
  res.setHeader('Content-Disposition', 'attachment; filename="audit-log.xlsx"');
  res.setHeader('X-Total-Count', String(result.total));

  return res.status(200).send(Buffer.from(buffer));
});

/* -------------------------------------------------------------------------- */
/*                                  Settings                                  */
/* -------------------------------------------------------------------------- */

export const getSettings = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await settingsService.getSettings(req), 'Settings'),
);

export const updateCompany = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await settingsService.updateCompany(req.body, req), 'Company profile saved'),
);

export const updateEmail = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await settingsService.updateEmail(req.body, req), 'Email configuration saved'),
);

export const testEmail = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await settingsService.testEmail(req.body, req), 'Mail test complete'),
);

export const updateNotifications = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await settingsService.updateNotifications(req.body, req), 'Notification settings saved'),
);

export const setMaintenance = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await settingsService.setMaintenance(req.body, req), 'Maintenance mode updated'),
);

/* -------------------------------------------------------------------------- */
/*                             Biometric devices                              */
/* -------------------------------------------------------------------------- */

export const listBiometricDevices = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await biometricDeviceService.listDevices(req), 'Biometric devices'),
);

export const addBiometricDevice = asyncHandler(async (req, res) =>
  ApiResponse.created(res, await biometricDeviceService.addDevice(req.body, req), 'Device added'),
);

export const updateBiometricDevice = asyncHandler(async (req, res) =>
  ApiResponse.ok(
    res,
    await biometricDeviceService.updateDevice(req.params.deviceId, req.body, req),
    'Device updated',
  ),
);

export const removeBiometricDevice = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await biometricDeviceService.removeDevice(req.params.deviceId, req), 'Device removed'),
);

/**
 * Reachability check.
 *
 * A device that cannot be reached is a 200 carrying `connected: false`, not an
 * error status. "Your terminal is switched off" is the answer to the question
 * the button asked, and a 5xx would render it as a failure of the HRMS.
 */
export const testBiometricDevice = asyncHandler(async (req, res) => {
  const result = await biometricDeviceService.testDevice(req.params.deviceId, req);

  return ApiResponse.ok(
    res,
    result,
    result.connected ? 'Device responded' : 'Device could not be reached',
  );
});

export const syncBiometricDevice = asyncHandler(async (req, res) => {
  const result = await biometricDeviceService.syncDevice(req.params.deviceId, req);

  return ApiResponse.ok(
    res,
    result,
    result.success
      ? `${result.daysUpdated} day(s) updated from ${result.punchesSynced} punch(es)`
      : 'The device could not be synced',
  );
});

export const fetchDeviceUsers = asyncHandler(async (req, res) => {
  const result = await biometricDeviceService.deviceUsers(req.params.deviceId, req);

  return ApiResponse.ok(res, result, `${result.users.length} enrolment(s) on the device`);
});

export const mapDeviceUsers = asyncHandler(async (req, res) =>
  ApiResponse.ok(
    res,
    await biometricDeviceService.mapUsers(req.params.deviceId, req.body.mappings, req),
    'Mappings saved',
  ),
);

export const biometricIntegrationStatus = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await biometricDeviceService.integrationStatus(req), 'Biometric integration status'),
);

export const updateBiometricReceiver = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await biometricDeviceService.updateReceiverSettings(req.body, req), 'Receiver address saved'),
);

export const biometricDeviceStatus = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await biometricDeviceService.deviceStatus(req.params.deviceId, req), 'Device status'),
);

export const biometricDeviceEvents = asyncHandler(async (req, res) =>
  ApiResponse.ok(
    res,
    await biometricDeviceService.deviceEvents(req.params.deviceId, req.validatedQuery ?? {}, req),
    'Device events',
  ),
);

export const biometricDeviceLogs = asyncHandler(async (req, res) =>
  ApiResponse.ok(
    res,
    await biometricDeviceService.deviceLogs(req.params.deviceId, req.validatedQuery ?? {}, req),
    'Sync logs',
  ),
);

export const reprocessBiometricDevice = asyncHandler(async (req, res) => {
  const result = await biometricDeviceService.reprocessDevice(req.params.deviceId, req.body, req);

  return ApiResponse.ok(
    res,
    result,
    `${result.imported} of ${result.received} stored punch(es) imported`,
  );
});

export const queueBiometricCommand = asyncHandler(async (req, res) =>
  ApiResponse.ok(
    res,
    await biometricDeviceService.queueCommand(req.params.deviceId, req.body, req),
    'Request queued — the device collects it on its next poll',
  ),
);

/* -------------------------------------------------------------------------- */
/*                             Backup and restore                             */
/* -------------------------------------------------------------------------- */

export const backupPreview = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await backupService.backupPreview(req), 'Backup contents'),
);

export const downloadBackup = asyncHandler(async (req, res) => {
  const archive = await backupService.createBackup(req);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="hrms-backup-${stamp}.json"`);
  res.setHeader('X-Document-Count', String(archive.meta.documents));

  return res.status(200).send(JSON.stringify(archive));
});

export const restoreBackup = asyncHandler(async (req, res) => {
  // The archive arrives either as an uploaded file or inline in the body.
  const raw = req.file?.buffer ?? req.body?.archive;
  if (!raw) throw ApiError.badRequest('No backup archive was supplied');

  // Multipart bodies carry strings; Joi has already coerced `dryRun` to a
  // boolean and defaulted it to true, so a field that never arrived means a
  // preview rather than a real restore.
  const options = {
    mode: req.body?.mode,
    dryRun: req.body?.dryRun,
    confirm: req.body?.confirm ?? null,
  };

  const result = await backupService.restoreBackup(raw, options, req);
  return ApiResponse.ok(res, result, result.dryRun ? 'Restore preview' : 'Restore applied');
});

export default {
  listUsers,
  getUser,
  createUser,
  updateUser,
  setUserStatus,
  unlockUser,
  resetUserPassword,
  revokeUserSessions,
  deleteUser,
  userSummary,
  exportUsers,

  listAuditLogs,
  getAuditLog,
  auditFilters,
  listLoginHistory,
  activityFeed,
  activityStats,
  exportAuditLogs,

  getSettings,
  updateCompany,
  updateEmail,
  testEmail,
  updateNotifications,
  setMaintenance,

  listBiometricDevices,
  addBiometricDevice,
  updateBiometricDevice,
  removeBiometricDevice,
  testBiometricDevice,
  syncBiometricDevice,
  biometricIntegrationStatus,
  updateBiometricReceiver,
  biometricDeviceStatus,
  biometricDeviceEvents,
  biometricDeviceLogs,
  reprocessBiometricDevice,
  queueBiometricCommand,
  fetchDeviceUsers,
  mapDeviceUsers,

  backupPreview,
  downloadBackup,
  restoreBackup,
};
