import { Router } from 'express';

import controller from '../../controllers/report/report.controller.js';
import validate from '../../middlewares/validate.js';
import { requirePermission } from '../../middlewares/authorize.js';
import { ACTIONS } from '../../utils/constants.js';
import schemas from '../../validators/report/report.validator.js';

const router = Router();

/**
 * Cross-module reporting: employees, attendance, leave, payroll, recruitment,
 * assets, loans and settlements.
 *
 * RBAC resource: RESOURCES.REPORT
 *
 * Mounted in routes/index.js behind authenticate and bound to its resource, so
 * every route below is already authenticated and gated to roles holding at
 * least one grant on it. Each route names its exact action.
 *
 * READ shows a report; EXPORT downloads one. Separating them is the point of
 * having both actions: aggregate figures on screen are one disclosure, a
 * spreadsheet of every salary leaving the building is another, and plenty of
 * roles should have the first without the second.
 *
 * `/catalog` precedes `/:slug`; Express matches in order and would otherwise
 * treat "catalog" as a report name.
 */

router.get('/catalog', requirePermission(ACTIONS.READ), controller.catalog);

router.get(
  '/:slug/export/excel',
  requirePermission(ACTIONS.EXPORT),
  validate({ query: schemas.exportQuerySchema }),
  controller.exportExcel,
);

router.get(
  '/:slug/export/pdf',
  requirePermission(ACTIONS.EXPORT),
  validate({ query: schemas.exportQuerySchema }),
  controller.exportPdf,
);

router.get(
  '/:slug',
  requirePermission(ACTIONS.READ),
  validate({ query: schemas.reportQuerySchema }),
  controller.run,
);

export default router;
