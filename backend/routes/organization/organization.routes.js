import { Router } from 'express';

import controller from '../../controllers/organization/organization.controller.js';
import masterController from '../../controllers/organization/organizationMaster.controller.js';
import validate from '../../middlewares/validate.js';
import { requirePermission } from '../../middlewares/authorize.js';
import { spreadsheetUpload } from '../../config/multer.js';
import { ACTIONS } from '../../utils/constants.js';
import schemas, { validateMasterBody } from '../../validators/organization/organization.validator.js';

const router = Router();

/**
 * Org structure: units, departments, designations, grades, shifts.
 *
 * RBAC resource: RESOURCES.ORGANIZATION
 *
 * Two groups of endpoints, deliberately separate:
 *
 * 1. The picker endpoints below. Read-only, active rows only, narrow
 *    projections. Every other module populates its dropdowns from these, so
 *    their shape is a contract -- they are left exactly as they were.
 *
 * 2. The `/masters/:master/...` management endpoints, added with the
 *    Organization module. Paginated, searchable, and able to see retired rows,
 *    which a dropdown must never do. One generic handler serves all five
 *    masters rather than five near-identical route files.
 *
 * Literal paths precede `/:id`; Express matches in order and `export` would
 * otherwise be captured as a record id.
 */

/* --------------------------------------------------------------- pickers -- */

router.get('/masters', requirePermission(ACTIONS.READ), controller.masters);
router.get('/departments', requirePermission(ACTIONS.READ), controller.departments);
router.get('/designations', requirePermission(ACTIONS.READ), controller.designations);
router.get('/shifts', requirePermission(ACTIONS.READ), controller.shifts);
router.get('/units', requirePermission(ACTIONS.READ), controller.units);
router.get('/grades', requirePermission(ACTIONS.READ), controller.grades);
router.get('/salary-templates', requirePermission(ACTIONS.READ), controller.salaryTemplates);
router.get('/reporting-managers', requirePermission(ACTIONS.READ), controller.reportingManagers);

/* ------------------------------------------------------------ management -- */

router.get(
  '/masters/:master/export',
  requirePermission(ACTIONS.EXPORT),
  validate(schemas.transferSchema),
  masterController.exportExcel,
);

router.get(
  '/masters/:master/export/pdf',
  requirePermission(ACTIONS.EXPORT),
  validate(schemas.transferSchema),
  masterController.exportPdf,
);

router.get(
  '/masters/:master/import/template',
  requirePermission(ACTIONS.CREATE),
  validate(schemas.templateSchema),
  masterController.downloadTemplate,
);

router.post(
  '/masters/:master/import',
  // An import creates and updates in one pass, so it is gated on the stronger
  // of the two rather than on create alone.
  requirePermission(ACTIONS.UPDATE),
  validate(schemas.templateSchema),
  spreadsheetUpload.single('file'),
  masterController.importExcel,
);

router.get(
  '/masters/:master',
  requirePermission(ACTIONS.READ),
  validate(schemas.listMasterSchema),
  masterController.list,
);

router.post(
  '/masters/:master',
  requirePermission(ACTIONS.CREATE),
  validate(schemas.masterParamSchema),
  validateMasterBody(false),
  masterController.create,
);

router.get(
  '/masters/:master/:id/audit',
  requirePermission(ACTIONS.READ),
  validate(schemas.auditSchema),
  masterController.auditTrail,
);

router.get(
  '/masters/:master/:id',
  requirePermission(ACTIONS.READ),
  validate(schemas.masterIdSchema),
  masterController.getOne,
);

router.patch(
  '/masters/:master/:id/status',
  requirePermission(ACTIONS.UPDATE),
  validate(schemas.statusSchema),
  masterController.setStatus,
);

router.patch(
  '/masters/:master/:id',
  requirePermission(ACTIONS.UPDATE),
  validate(schemas.masterIdSchema),
  validateMasterBody(true),
  masterController.update,
);

router.delete(
  '/masters/:master/:id',
  requirePermission(ACTIONS.DELETE),
  validate(schemas.masterIdSchema),
  masterController.remove,
);

export default router;
