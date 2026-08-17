import { Router } from 'express';
import multer from 'multer';

import controller from '../../controllers/admin/admin.controller.js';
import validate from '../../middlewares/validate.js';
import { requirePermission } from '../../middlewares/authorize.js';
import { ACTIONS, RESOURCES } from '../../utils/constants.js';
import schemas from '../../validators/admin/admin.validator.js';

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
