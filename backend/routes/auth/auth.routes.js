import { Router } from 'express';

import authController from '../../controllers/auth/auth.controller.js';
import passwordController from '../../controllers/auth/password.controller.js';
import validate from '../../middlewares/validate.js';
import authenticate from '../../middlewares/authenticate.js';
import { requirePermission } from '../../middlewares/authorize.js';
import { authLimiter } from '../../middlewares/rateLimiter.js';
import schemas from '../../validators/auth/auth.validator.js';
import { RESOURCES, ACTIONS } from '../../utils/constants.js';

const router = Router();

/**
 * Authentication: login, token refresh, logout, password reset, verification.
 *
 * `authLimiter` guards every endpoint that accepts a credential, a token or an
 * email address. Those are the endpoints worth brute-forcing, and they are
 * throttled independently of the global API limit.
 */

/* ------------------------------------------------------------- public ---- */

router.post('/register', authLimiter, validate(schemas.registerSchema), authController.register);

router.post('/login', authLimiter, validate(schemas.loginSchema), authController.login);

// Deliberately outside authLimiter: a legitimate client refreshes on a timer,
// and throttling that would sign active users out. Rotation plus reuse
// detection is what protects this endpoint.
router.post('/refresh', validate(schemas.refreshSchema), authController.refresh);

router.post('/logout', authController.logout);

router.post(
  '/verify-email',
  authLimiter,
  validate(schemas.verifyEmailSchema),
  authController.verifyEmail,
);

router.post(
  '/resend-verification',
  authLimiter,
  validate(schemas.resendVerificationSchema),
  authController.resendVerification,
);

router.post(
  '/forgot-password',
  authLimiter,
  validate(schemas.forgotPasswordSchema),
  passwordController.forgotPassword,
);

router.post(
  '/reset-password',
  authLimiter,
  validate(schemas.resetPasswordSchema),
  passwordController.resetPassword,
);

/* ---------------------------------------------------------- protected ---- */
// Everything below this line requires a valid access token.
router.use(authenticate);

router.get('/me', authController.me);

// The caller's own effective permissions. Any authenticated user may read
// these -- they describe only what that user can already do.
router.get('/permissions', authController.permissions);

// The full role matrix, for an RBAC administration screen. Requires the right
// to read RBAC configuration, which only COMPANY_ADMIN, AUDITOR and
// SUPER_ADMIN hold.
router.get(
  '/roles',
  requirePermission(RESOURCES.ROLE, ACTIONS.READ),
  authController.roleDefinitions,
);

router.get('/sessions', authController.sessions);

router.get('/login-history', validate(schemas.loginHistorySchema), authController.loginHistory);

router.post(
  '/change-password',
  validate(schemas.changePasswordSchema),
  passwordController.changePassword,
);

router.post('/logout-all', authController.logoutAll);

export default router;
