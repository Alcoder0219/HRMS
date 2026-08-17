import { Router } from 'express';

import authenticate from '../middlewares/authenticate.js';
import {
  bindResource,
  requireResourceAccess,
  requirePasswordChangeComplete,
} from '../middlewares/authorize.js';
import { RESOURCES } from '../utils/constants.js';

import authRoutes from './auth/auth.routes.js';
import tenantRoutes from './tenant/tenant.routes.js';
import employeeRoutes from './employee/employee.routes.js';
import organizationRoutes from './organization/organization.routes.js';
import attendanceRoutes from './attendance/attendance.routes.js';
import leaveRoutes from './leave/leave.routes.js';
import payrollRoutes from './payroll/payroll.routes.js';
import recruitmentRoutes from './recruitment/recruitment.routes.js';
import performanceRoutes from './performance/performance.routes.js';
import documentRoutes from './document/document.routes.js';
import notificationRoutes from './notification/notification.routes.js';
import reportRoutes from './report/report.routes.js';
import adminRoutes from './admin/admin.routes.js';

const router = Router();

/**
 * The single registry of the API surface. Every mounted path in the product
 * appears in this one table, which is what makes the public surface auditable
 * without reading the rest of the codebase.
 */

/* -------------------------------------------------------------------------- */
/*                                  Public                                    */
/* -------------------------------------------------------------------------- */

// The only unauthenticated branch. It manages its own public/protected split
// internally, because sign-in cannot require being signed in.
router.use('/auth', authRoutes);

/* -------------------------------------------------------------------------- */
/*                            Authenticated wall                              */
/* -------------------------------------------------------------------------- */

/**
 * Everything below requires a valid session. Applied here rather than
 * per-router so protection is the default state of the API: a new module
 * mounted below this line is authenticated whether or not its author
 * remembered to ask for it.
 */
router.use(authenticate);

// An account on a temporary password can reach nothing but /auth/change-password.
router.use(requirePasswordChangeComplete);

/* -------------------------------------------------------------------------- */
/*                             Protected modules                              */
/* -------------------------------------------------------------------------- */

/**
 * Each module declares the RBAC resource it governs. Mounting binds that
 * resource and applies the coarse access gate, so individual routes only have
 * to name the action:
 *
 *   router.post('/:id/approve', requirePermission(ACTIONS.APPROVE), controller.approve);
 */
const modules = [
  { path: '/tenants', resource: RESOURCES.TENANT, router: tenantRoutes },
  { path: '/employees', resource: RESOURCES.EMPLOYEE, router: employeeRoutes },
  { path: '/organization', resource: RESOURCES.ORGANIZATION, router: organizationRoutes },
  { path: '/attendance', resource: RESOURCES.ATTENDANCE, router: attendanceRoutes },
  { path: '/leaves', resource: RESOURCES.LEAVE, router: leaveRoutes },
  { path: '/payroll', resource: RESOURCES.PAYROLL, router: payrollRoutes },
  { path: '/recruitment', resource: RESOURCES.RECRUITMENT, router: recruitmentRoutes },
  { path: '/performance', resource: RESOURCES.PERFORMANCE, router: performanceRoutes },
  { path: '/documents', resource: RESOURCES.DOCUMENT, router: documentRoutes },
  { path: '/notifications', resource: RESOURCES.NOTIFICATION, router: notificationRoutes },
  { path: '/reports', resource: RESOURCES.REPORT, router: reportRoutes },
  // Administration spans several resources; USER is the default and the route
  // groups inside name AUDIT, ROLE and TENANT where they differ.
  { path: '/administration', resource: RESOURCES.USER, router: adminRoutes },
];

modules.forEach(({ path, resource, router: moduleRouter }) => {
  router.use(path, bindResource(resource), requireResourceAccess(resource), moduleRouter);
});

export default router;
