import { Router } from 'express';

import controller from '../../controllers/leave/leave.controller.js';
import validate from '../../middlewares/validate.js';
import { requirePermission, requireScope } from '../../middlewares/authorize.js';
import { ACTIONS, SCOPES } from '../../utils/constants.js';
import schemas from '../../validators/leave/leave.validator.js';

const router = Router();

/**
 * Leave: types, balances, applications and their approval.
 *
 * RBAC resource: RESOURCES.LEAVE
 *
 * Mounted in routes/index.js behind authenticate and bound to its resource, so
 * every route below is already authenticated and gated to roles holding at
 * least one grant on it. Each route names its exact action.
 *
 * Action mapping is deliberate:
 *
 *   READ    -- every employee holds it, so it covers their OWN leave. Anything
 *              org-wide additionally demands DEPARTMENT reach or better.
 *   CREATE  -- applying for leave. Self-service.
 *   APPROVE -- deciding someone else's request, and moving balances. The
 *              service additionally refuses to let anyone approve their own.
 *
 * Literal paths precede `/:id`; Express matches in order and `calendar` would
 * otherwise be captured as a request id.
 */

/**
 * Reading the whole organisation's leave is a wider disclosure than reading
 * your own, and `leave:read` alone cannot tell the two apart -- every employee
 * holds it.
 */
const orgWide = [requirePermission(ACTIONS.READ), requireScope(SCOPES.DEPARTMENT)];

/* ------------------------------------------------------------ leave types -- */

router.get('/types', requirePermission(ACTIONS.READ), validate(schemas.listTypesSchema), controller.listTypes);

router.post(
  '/types',
  // The catalogue decides everyone's entitlement, so it is not an ordinary create.
  requirePermission(ACTIONS.APPROVE),
  validate(schemas.createTypeSchema),
  controller.createType,
);

router.get('/types/:id', requirePermission(ACTIONS.READ), validate(schemas.idParamSchema), controller.getType);

router.patch(
  '/types/:id/status',
  requirePermission(ACTIONS.APPROVE),
  validate(schemas.statusSchema),
  controller.setTypeStatus,
);

router.patch(
  '/types/:id',
  requirePermission(ACTIONS.APPROVE),
  validate(schemas.updateTypeSchema),
  controller.updateType,
);

router.delete(
  '/types/:id',
  requirePermission(ACTIONS.DELETE),
  validate(schemas.idParamSchema),
  controller.deleteType,
);

/* --------------------------------------------------------------- balances -- */

/** An employee's own balances. Self-service, so READ is enough. */
router.get(
  '/balances/me',
  requirePermission(ACTIONS.READ),
  validate(schemas.employeeBalancesSchema),
  controller.employeeBalances,
);

router.get('/balances', orgWide, validate(schemas.listBalancesSchema), controller.listBalances);

router.post(
  '/balances/carry-forward',
  // Moves everyone's entitlement across a year boundary.
  requirePermission(ACTIONS.APPROVE),
  validate(schemas.carryForwardSchema),
  controller.carryForward,
);

router.post(
  '/balances/:id/encash',
  // Converts leave into money.
  requirePermission(ACTIONS.APPROVE),
  validate(schemas.encashSchema),
  controller.encash,
);

router.patch(
  '/balances/:id/adjust',
  requirePermission(ACTIONS.APPROVE),
  validate(schemas.adjustSchema),
  controller.adjust,
);

/* ---------------------------------------------------------------- reports -- */

router.get('/reports/balances', orgWide, validate(schemas.reportSchema), controller.report);

router.get(
  '/reports/balances/export',
  requirePermission(ACTIONS.EXPORT),
  validate(schemas.reportSchema),
  controller.exportReport,
);

router.get(
  '/reports/balances/export/pdf',
  requirePermission(ACTIONS.EXPORT),
  validate(schemas.reportSchema),
  controller.exportReportPdf,
);

/* --------------------------------------------------------------- calendar -- */

router.get('/calendar', requirePermission(ACTIONS.READ), validate(schemas.calendarSchema), controller.calendar);

/* --------------------------------------------------------------- requests -- */

router.get('/requests/pending-count', requirePermission(ACTIONS.APPROVE), controller.pendingCount);

router.post(
  '/requests/preview',
  // A dry run writes nothing, so it needs no more than the right to apply.
  requirePermission(ACTIONS.CREATE),
  validate(schemas.previewSchema),
  controller.preview,
);

router.get(
  '/requests',
  requirePermission(ACTIONS.READ),
  validate(schemas.listRequestsSchema),
  controller.listRequests,
);

router.post('/requests', requirePermission(ACTIONS.CREATE), validate(schemas.applySchema), controller.apply);

router.get(
  '/requests/:id',
  requirePermission(ACTIONS.READ),
  validate(schemas.idParamSchema),
  controller.getRequest,
);

router.patch(
  '/requests/:id/decision',
  requirePermission(ACTIONS.APPROVE),
  validate(schemas.decisionSchema),
  controller.decide,
);

router.post(
  '/requests/:id/cancel',
  // Withdrawing your own request is self-service.
  requirePermission(ACTIONS.CREATE),
  validate(schemas.cancelSchema),
  controller.cancel,
);

export default router;
