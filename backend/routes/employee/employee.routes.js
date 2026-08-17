import { Router } from 'express';

import controller from '../../controllers/employee/employee.controller.js';
import validate from '../../middlewares/validate.js';
import { requirePermission } from '../../middlewares/authorize.js';
import { photoUpload, documentUpload, spreadsheetUpload } from '../../config/multer.js';
import documentController from '../../controllers/employee/employeeDocument.controller.js';
import {
  prepareEmployeeFolder,
  uploadSingle,
  uploadMany,
  enforcePerTypeLimits,
} from '../../middlewares/employeeUpload.js';
import { ACTIONS } from '../../utils/constants.js';
import schemas from '../../validators/employee/employee.validator.js';

const router = Router();

/**
 * Employee master data: profiles, employment history, lifecycle transitions.
 *
 * RBAC resource: RESOURCES.EMPLOYEE
 *
 * Mounted in routes/index.js behind authenticate and bound to its resource, so
 * every route below is already authenticated and gated. Each route declares its
 * exact action; the resource argument is omitted because it is already bound.
 *
 * Literal paths are declared before `/:id` -- Express matches in order, and
 * `/export` would otherwise be captured as an employee id.
 */

/* ---------------------------------------------------------------- reads -- */

router.get('/', requirePermission(ACTIONS.READ), validate(schemas.listEmployeesSchema), controller.list);

router.get('/summary', requirePermission(ACTIONS.DASHBOARD), controller.summary);

router.get(
  '/export',
  // Export is a separate privilege from read: bulk extraction of the whole
  // directory is a different disclosure from viewing one profile.
  requirePermission(ACTIONS.EXPORT),
  validate(schemas.exportEmployeesSchema),
  controller.exportExcel,
);

router.get('/import/template', requirePermission(ACTIONS.CREATE), controller.downloadTemplate);

/**
 * Organisation-wide transfer and promotion history.
 *
 * Read-only views over the audit trail rather than their own collections -- a
 * transfer IS the change to the employee's unit, department, designation or
 * reporting line, and that change is already recorded. Declared before `/:id`,
 * or "movements" would be captured as an employee id.
 */
router.get(
  '/movements',
  requirePermission(ACTIONS.READ),
  validate(schemas.allMovementsSchema),
  controller.allMovements,
);

/* --------------------------------------------------------------- writes -- */

router.post(
  '/',
  requirePermission(ACTIONS.CREATE),
  validate(schemas.createEmployeeSchema),
  controller.create,
);

router.post(
  '/import',
  requirePermission(ACTIONS.CREATE),
  spreadsheetUpload.single('file'),
  controller.importExcel,
);

/* ------------------------------------------------------------ single row -- */

router.get(
  '/:id',
  requirePermission(ACTIONS.READ),
  validate(schemas.idParamSchema),
  controller.getOne,
);

router.patch(
  '/:id',
  requirePermission(ACTIONS.UPDATE),
  validate(schemas.updateEmployeeSchema),
  controller.update,
);

router.patch(
  '/:id/status',
  // A lifecycle change is an approval-grade act, not an ordinary edit.
  requirePermission(ACTIONS.APPROVE),
  validate(schemas.changeStatusSchema),
  controller.changeStatus,
);

router.delete(
  '/:id',
  requirePermission(ACTIONS.DELETE),
  validate(schemas.deleteEmployeeSchema),
  controller.remove,
);

router.post(
  '/:id/restore',
  requirePermission(ACTIONS.DELETE),
  validate(schemas.idParamSchema),
  controller.restore,
);

router.get(
  '/:id/audit',
  requirePermission(ACTIONS.READ),
  validate(schemas.auditTrailSchema),
  controller.auditTrail,
);

/** One employee's transfer and promotion history. */
router.get(
  '/:id/movements',
  requirePermission(ACTIONS.READ),
  validate(schemas.movementsSchema),
  controller.movements,
);

/* ----------------------------------------------------------- attachments -- */

router.post(
  '/:id/photo',
  requirePermission(ACTIONS.UPDATE),
  validate(schemas.idParamSchema),
  photoUpload.single('photo'),
  controller.uploadPhoto,
);

router.post(
  '/:id/documents',
  requirePermission(ACTIONS.UPDATE),
  documentUpload.array('documents', 10),
  validate(schemas.uploadDocumentsSchema),
  controller.uploadDocuments,
);

router.delete(
  '/:id/documents/:documentId',
  requirePermission(ACTIONS.DELETE),
  validate(schemas.documentParamSchema),
  controller.deleteDocument,
);

/* ------------------------------------------------- employee attachments -- */

/**
 * The Documents tab: one folder per employee under `attachments/`, nine
 * sections, files on disk and metadata in MongoDB.
 *
 * `/attachments/sections` is literal and precedes `/:id`, or Express would
 * read "sections" as an employee id.
 *
 * Reads need `employee:read`, writes need `employee:update`, and deletes need
 * `employee:delete` -- which the permission matrix grants to exactly Super
 * Admin, Company Admin and HR, so the brief's delete rule needs no separate
 * role check to enforce it.
 *
 * `prepareEmployeeFolder` runs before Multer on every write: it resolves the
 * employee, refuses a foreign tenant before a byte is written, and guarantees
 * the destination directory exists.
 */

router.get('/attachments/sections', requirePermission(ACTIONS.READ), documentController.sections);

// `?page=&limit=` are optional; omitting them returns the grouped shape the
// Documents tab reads, so this stays backward compatible.
router.get(
  '/:id/attachments',
  requirePermission(ACTIONS.READ),
  validate(schemas.attachmentListSchema),
  documentController.list,
);

router.post(
  '/:id/attachments/folders',
  requirePermission(ACTIONS.UPDATE),
  validate(schemas.idParamSchema),
  documentController.ensureFolders,
);

router.get(
  '/:id/attachments/:documentId/file',
  requirePermission(ACTIONS.READ),
  validate(schemas.attachmentParamSchema),
  documentController.download,
);

router.post(
  '/:id/attachments/:type',
  requirePermission(ACTIONS.UPDATE),
  validate(schemas.attachmentTypeParamSchema),
  prepareEmployeeFolder,
  uploadMany,
  enforcePerTypeLimits,
  documentController.upload,
);

router.put(
  '/:id/attachments/:documentId/replace/:type',
  requirePermission(ACTIONS.UPDATE),
  validate(schemas.attachmentReplaceParamSchema),
  prepareEmployeeFolder,
  uploadSingle,
  enforcePerTypeLimits,
  documentController.replace,
);

router.delete(
  '/:id/attachments/:documentId',
  // Deleting an identity document is not an ordinary update.
  requirePermission(ACTIONS.DELETE),
  validate(schemas.attachmentParamSchema),
  documentController.remove,
);

export default router;
