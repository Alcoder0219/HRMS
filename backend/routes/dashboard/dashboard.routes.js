import { Router } from 'express';

import controller from '../../controllers/dashboard/dashboard.controller.js';
import validate from '../../middlewares/validate.js';
import { requirePermission } from '../../middlewares/authorize.js';
import { ACTIONS } from '../../utils/constants.js';
import schemas from '../../validators/dashboard/dashboard.validator.js';

/**
 * The dashboard's figures, one read-only section per module.
 *
 * RBAC resource: RESOURCES.DASHBOARD -- every role may open the dashboard. Each
 * section then demands the permission its module demands (employee:dashboard,
 * attendance:read, leave:read, payroll:read with organisation reach) and is
 * scoped by role and unit in the service, so a section the caller may not see
 * is refused rather than emptied.
 */
const router = Router();

router.get('/employees', requirePermission(ACTIONS.READ), validate(schemas.overviewQuerySchema), controller.employees);
router.get('/attendance', requirePermission(ACTIONS.READ), validate(schemas.overviewQuerySchema), controller.attendance);
router.get('/today', requirePermission(ACTIONS.READ), validate(schemas.overviewQuerySchema), controller.today);
router.get('/leave', requirePermission(ACTIONS.READ), validate(schemas.overviewQuerySchema), controller.leave);
router.get('/payroll', requirePermission(ACTIONS.READ), validate(schemas.overviewQuerySchema), controller.payroll);

export default router;
