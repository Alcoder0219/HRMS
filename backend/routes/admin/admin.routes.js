import { Router } from 'express';
import multer from 'multer';

import controller from '../../controllers/admin/admin.controller.js';
import roleController from '../../controllers/admin/role.controller.js';
import validate from '../../middlewares/validate.js';
import { requirePermission } from '../../middlewares/authorize.js';
import { ACTIONS, RESOURCES } from '../../utils/constants.js';
import schemas from '../../validators/admin/admin.validator.js';
import roleSchemas from '../../validators/admin/role.validator.js';

const router = Router();

/**
 * Administration: users, audit and activity logs, settings, backup and restore.
 *
 * Mounted in routes/index.js behind authenticate and bound to RESOURCES.USER,
 * which is the module's default. Several route groups name a different
 * resource explicitly, because "manage logins" and "read the audit trail" are
 * genuinely different privileges that different people hold:
 *
 *   USER   -- accounts: create, suspend, reset, delete.
 *   AUDIT  -- the trail: audit entries, login history, the activity feed. An
 *             auditor reads these and can touch nothing else.
 *   ROLE   -- the permission matrix.
 *   TENANT -- company profile, mail, notification policy, backup and restore.
 *
 * Backup and restore additionally demand DELETE on the tenant. Nothing else in
 * the product can empty a collection, and read access to settings should not
 * carry the ability to overwrite the database.
 *
 * Literal paths precede `/:id` throughout; Express matches in order and
 * `summary` would otherwise be captured as a user id.
 */

/**
 * A restore archive arrives in memory, never on disk.
 *
 * Writing it out would leave a file containing the whole tenant's data sitting
 * in the upload directory after the request, and nothing would ever clean it
 * up.
 */
const archiveUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 64 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const ok = file.mimetype === 'application/json' || file.originalname.toLowerCase().endsWith('.json');
    callback(ok ? null : new Error('A backup archive must be a .json file'), ok);
  },
});

/* ------------------------------------------------------------------ users -- */

router.get('/users/summary', requirePermission(RESOURCES.USER, ACTIONS.READ), controller.userSummary);

router.get(
  '/users/export',
  requirePermission(RESOURCES.USER, ACTIONS.EXPORT),
  validate({ query: schemas.listUsersSchema }),
  controller.exportUsers,
);

router.get(
  '/users',
  requirePermission(RESOURCES.USER, ACTIONS.READ),
  validate({ query: schemas.listUsersSchema }),
  controller.listUsers,
);

router.post(
  '/users',
  requirePermission(RESOURCES.USER, ACTIONS.CREATE),
  validate({ body: schemas.createUserSchema }),
  controller.createUser,
);

router.get(
  '/users/:id',
  requirePermission(RESOURCES.USER, ACTIONS.READ),
  validate({ params: schemas.idParamSchema }),
  controller.getUser,
);

router.patch(
  '/users/:id',
  requirePermission(RESOURCES.USER, ACTIONS.UPDATE),
  validate({ params: schemas.idParamSchema, body: schemas.updateUserSchema }),
  controller.updateUser,
);

router.patch(
  '/users/:id/status',
  requirePermission(RESOURCES.USER, ACTIONS.UPDATE),
  validate({ params: schemas.idParamSchema, body: schemas.userStatusSchema }),
  controller.setUserStatus,
);

router.post(
  '/users/:id/unlock',
  requirePermission(RESOURCES.USER, ACTIONS.UPDATE),
  validate({ params: schemas.idParamSchema }),
  controller.unlockUser,
);

router.post(
  '/users/:id/password',
  // Setting someone else's password is not an ordinary update: it takes the
  // account over. Gated on APPROVE, which far fewer roles hold.
  requirePermission(RESOURCES.USER, ACTIONS.APPROVE),
  validate({ params: schemas.idParamSchema, body: schemas.resetPasswordSchema }),
  controller.resetUserPassword,
);

router.post(
  '/users/:id/revoke-sessions',
  requirePermission(RESOURCES.USER, ACTIONS.UPDATE),
  validate({ params: schemas.idParamSchema }),
  controller.revokeUserSessions,
);

router.delete(
  '/users/:id',
  requirePermission(RESOURCES.USER, ACTIONS.DELETE),
  validate({ params: schemas.idParamSchema }),
  controller.deleteUser,
);

/* ------------------------------------------------------------------- roles -- */

router.get('/roles', requirePermission(RESOURCES.ROLE, ACTIONS.READ), roleController.listRoles);

router.post(
  '/roles',
  requirePermission(RESOURCES.ROLE, ACTIONS.CREATE),
  validate({ body: roleSchemas.createRoleSchema }),
  roleController.createRole,
);

// Literal before `/:id`: Express matches in order, and `permissions` would
// otherwise be captured as a role id.
router.patch(
  '/roles/permissions',
  requirePermission(RESOURCES.ROLE, ACTIONS.UPDATE),
  validate({ body: roleSchemas.updateRolePermissionsSchema }),
  roleController.updateRolePermissions,
);

router.patch(
  '/roles/:id',
  requirePermission(RESOURCES.ROLE, ACTIONS.UPDATE),
  validate({ params: schemas.idParamSchema, body: roleSchemas.updateRoleSchema }),
  roleController.updateRole,
);

router.delete(
  '/roles/:id',
  requirePermission(RESOURCES.ROLE, ACTIONS.DELETE),
  validate({ params: schemas.idParamSchema }),
  roleController.deleteRole,
);

/* ------------------------------------------------------------- audit logs -- */

router.get('/audit/filters', requirePermission(RESOURCES.AUDIT, ACTIONS.READ), controller.auditFilters);

router.get(
  '/audit/export',
  requirePermission(RESOURCES.AUDIT, ACTIONS.EXPORT),
  validate({ query: schemas.listAuditSchema }),
  controller.exportAuditLogs,
);

router.get(
  '/audit',
  requirePermission(RESOURCES.AUDIT, ACTIONS.READ),
  validate({ query: schemas.listAuditSchema }),
  controller.listAuditLogs,
);

router.get(
  '/audit/:id',
  requirePermission(RESOURCES.AUDIT, ACTIONS.READ),
  validate({ params: schemas.idParamSchema }),
  controller.getAuditLog,
);

router.get(
  '/login-history',
  requirePermission(RESOURCES.AUDIT, ACTIONS.READ),
  validate({ query: schemas.listLoginHistorySchema }),
  controller.listLoginHistory,
);

router.get(
  '/activity',
  requirePermission(RESOURCES.AUDIT, ACTIONS.READ),
  validate({ query: schemas.activitySchema }),
  controller.activityFeed,
);

router.get(
  '/activity/stats',
  requirePermission(RESOURCES.AUDIT, ACTIONS.DASHBOARD),
  validate({ query: schemas.statsSchema }),
  controller.activityStats,
);

/* --------------------------------------------------------------- settings -- */

router.get('/settings', requirePermission(RESOURCES.TENANT, ACTIONS.READ), controller.getSettings);

router.patch(
  '/settings/company',
  requirePermission(RESOURCES.TENANT, ACTIONS.UPDATE),
  validate({ body: schemas.companySchema }),
  controller.updateCompany,
);

router.patch(
  '/settings/email',
  requirePermission(RESOURCES.TENANT, ACTIONS.UPDATE),
  validate({ body: schemas.emailConfigSchema }),
  controller.updateEmail,
);

router.post(
  '/settings/email/test',
  requirePermission(RESOURCES.TENANT, ACTIONS.UPDATE),
  validate({ body: schemas.testEmailSchema }),
  controller.testEmail,
);

router.patch(
  '/settings/notifications',
  requirePermission(RESOURCES.TENANT, ACTIONS.UPDATE),
  validate({ body: schemas.notificationSchema }),
  controller.updateNotifications,
);

router.patch(
  '/settings/maintenance',
  requirePermission(RESOURCES.TENANT, ACTIONS.UPDATE),
  validate({ body: schemas.maintenanceSchema }),
  controller.setMaintenance,
);

/* ------------------------------------------------------ biometric devices -- */

/**
 * Attendance terminals, configured alongside the rest of the tenant settings.
 *
 * Bound to TENANT rather than to ATTENDANCE, because this is device
 * administration and not attendance data: adding a terminal is the same class
 * of act as configuring the mail server, and the people who do one do the other.
 *
 * The split between READ and UPDATE is deliberate. Listing devices shows an
 * administrator what is configured; testing, syncing and mapping all reach out
 * to hardware or write attendance rows, so they demand the write grant --
 * `sync` in particular creates attendance for real people.
 */

router.get(
  '/biometric/devices',
  requirePermission(RESOURCES.TENANT, ACTIONS.READ),
  controller.listBiometricDevices,
);

// The integration's health: receiver configuration, link state of every
// device, unregistered serials calling in, and the time-zone check.
router.get(
  '/biometric/status',
  requirePermission(RESOURCES.TENANT, ACTIONS.READ),
  controller.biometricIntegrationStatus,
);

// Where terminals must be pointed. Device administration, so tenant:update.
router.put(
  '/biometric/receiver',
  requirePermission(RESOURCES.TENANT, ACTIONS.UPDATE),
  validate({ body: schemas.receiverSettingsSchema }),
  controller.updateBiometricReceiver,
);

router.get(
  '/biometric/devices/:deviceId/status',
  requirePermission(RESOURCES.TENANT, ACTIONS.READ),
  validate({ params: schemas.deviceIdParamSchema }),
  controller.biometricDeviceStatus,
);

router.get(
  '/biometric/devices/:deviceId/events',
  requirePermission(RESOURCES.TENANT, ACTIONS.READ),
  validate({ params: schemas.deviceIdParamSchema, query: schemas.deviceEventsQuerySchema }),
  controller.biometricDeviceEvents,
);

router.get(
  '/biometric/devices/:deviceId/logs',
  requirePermission(RESOURCES.TENANT, ACTIONS.READ),
  validate({ params: schemas.deviceIdParamSchema, query: schemas.deviceLogsQuerySchema }),
  controller.biometricDeviceLogs,
);

router.post(
  '/biometric/devices/:deviceId/reprocess',
  // Writes attendance -- and with includeHeld, over a human's correction.
  requirePermission(RESOURCES.TENANT, ACTIONS.UPDATE),
  validate({ params: schemas.deviceIdParamSchema, body: schemas.reprocessDeviceSchema }),
  controller.reprocessBiometricDevice,
);

router.post(
  '/biometric/devices/:deviceId/commands',
  requirePermission(RESOURCES.TENANT, ACTIONS.UPDATE),
  validate({ params: schemas.deviceIdParamSchema, body: schemas.deviceCommandSchema }),
  controller.queueBiometricCommand,
);

router.post(
  '/biometric/devices',
  requirePermission(RESOURCES.TENANT, ACTIONS.UPDATE),
  validate({ body: schemas.createBiometricDeviceSchema }),
  controller.addBiometricDevice,
);

router.put(
  '/biometric/devices/:deviceId',
  requirePermission(RESOURCES.TENANT, ACTIONS.UPDATE),
  validate({ params: schemas.deviceIdParamSchema, body: schemas.updateBiometricDeviceSchema }),
  controller.updateBiometricDevice,
);

router.delete(
  '/biometric/devices/:deviceId',
  requirePermission(RESOURCES.TENANT, ACTIONS.DELETE),
  validate({ params: schemas.deviceIdParamSchema }),
  controller.removeBiometricDevice,
);

router.post(
  '/biometric/devices/:deviceId/test',
  requirePermission(RESOURCES.TENANT, ACTIONS.UPDATE),
  validate({ params: schemas.deviceIdParamSchema }),
  controller.testBiometricDevice,
);

router.post(
  '/biometric/devices/:deviceId/sync',
  requirePermission(RESOURCES.TENANT, ACTIONS.UPDATE),
  validate({ params: schemas.deviceIdParamSchema }),
  controller.syncBiometricDevice,
);

router.get(
  '/biometric/devices/:deviceId/users',
  // Reads the device, not the database: it opens a socket to hardware, which
  // is a write-shaped act however read-shaped the verb looks.
  requirePermission(RESOURCES.TENANT, ACTIONS.UPDATE),
  validate({ params: schemas.deviceIdParamSchema }),
  controller.fetchDeviceUsers,
);

router.post(
  '/biometric/devices/:deviceId/map',
  requirePermission(RESOURCES.TENANT, ACTIONS.UPDATE),
  validate({ params: schemas.deviceIdParamSchema, body: schemas.mapDeviceUsersSchema }),
  controller.mapDeviceUsers,
);

/* -------------------------------------------------------- backup, restore -- */

router.get('/backup/preview', requirePermission(RESOURCES.TENANT, ACTIONS.EXPORT), controller.backupPreview);

router.get('/backup', requirePermission(RESOURCES.TENANT, ACTIONS.EXPORT), controller.downloadBackup);

router.post(
  '/restore',
  // DELETE on the tenant: a restore can empty collections, and no lesser
  // action in the product can.
  requirePermission(RESOURCES.TENANT, ACTIONS.DELETE),
  archiveUpload.single('archive'),
  validate({ body: schemas.restoreSchema }),
  controller.restoreBackup,
);

export default router;
