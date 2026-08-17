import { Router } from 'express';

const router = Router();

/**
 * Notifications: in-app feed, email/push dispatch, user preferences.
 *
 * RBAC resource: RESOURCES.NOTIFICATION
 *
 * Mounted in routes/index.js behind authenticate and bound to its resource, so
 * every route below is already authenticated and gated to roles holding at
 * least one grant on it. Each route still declares its exact action:
 *
 *   import { requirePermission } from '../../middlewares/authorize.js';
 *   import { ACTIONS } from '../../utils/constants.js';
 *
 *   router.get('/', requirePermission(ACTIONS.READ), controller.list);
 *   router.post('/', requirePermission(ACTIONS.CREATE), validate(schema), controller.create);
 *   router.post('/:id/approve', requirePermission(ACTIONS.APPROVE), controller.approve);
 *
 * The resource argument is omitted because routes/index.js already bound it.
 */

export default router;
