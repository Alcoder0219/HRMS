import asyncHandler from '../../utils/asyncHandler.js';
import ApiResponse from '../../utils/ApiResponse.js';
import authService from '../../services/auth/auth.service.js';
import {
  setRefreshCookie,
  clearRefreshCookie,
  readRefreshCookie,
} from '../../helpers/cookie.helper.js';

/**
 * Controllers translate HTTP to service calls and back. No branching on
 * business rules, no database access -- if logic appears here, it belongs in
 * the service.
 */

/** Cookie first, body second: browsers use the httpOnly cookie, native clients the body. */
const resolveRefreshToken = (req) => readRefreshCookie(req) || req.body?.refreshToken || null;

/**
 * The refresh token is delivered as an httpOnly cookie and is deliberately
 * absent from the JSON body -- putting it there would defeat the point of the
 * cookie, since JavaScript could then read and store it.
 */
const respondWithSession = (res, statusCode, session, message) => {
  setRefreshCookie(res, session.refreshToken, { rememberMe: session.rememberMe });

  return new ApiResponse(
    statusCode,
    {
      user: session.user,
      accessToken: session.accessToken,
      expiresIn: session.expiresIn,
    },
    message,
  ).send(res);
};

export const register = asyncHandler(async (req, res) => {
  const result = await authService.register(req.body, req);

  return new ApiResponse(
    201,
    result,
    result.emailDelivered
      ? 'Account created. Check your inbox to verify your email address.'
      : 'Account created. Email delivery is not configured - use the token below to verify.',
  ).send(res);
});

export const verifyEmail = asyncHandler(async (req, res) => {
  const result = await authService.verifyEmail(req.body.token);

  return ApiResponse.ok(
    res,
    result,
    result.alreadyVerified ? 'Email is already verified' : 'Email verified successfully',
  );
});

export const resendVerification = asyncHandler(async (req, res) => {
  const result = await authService.resendVerification(req.body.email, req.body.tenantId, req);

  // Intentionally identical whether or not the account exists.
  return ApiResponse.ok(res, result, 'If that account exists, a verification email has been sent');
});

export const login = asyncHandler(async (req, res) => {
  const session = await authService.login(
    // `allowedRoles` comes from the route's `restrictLoginTo` middleware, never
    // from the request body -- the client does not get to choose which roles a
    // sign-in portal accepts.
    { ...req.body, allowedRoles: req.allowedRoles ?? null },
    req,
  );

  return respondWithSession(res, 200, session, 'Signed in successfully');
});

export const refresh = asyncHandler(async (req, res) => {
  const session = await authService.refresh(resolveRefreshToken(req), req);
  return respondWithSession(res, 200, session, 'Session refreshed');
});

export const logout = asyncHandler(async (req, res) => {
  const result = await authService.logout(resolveRefreshToken(req), req);

  // Cleared even when no session was found, so a stale cookie cannot linger.
  clearRefreshCookie(res);
  return ApiResponse.ok(res, result, 'Signed out successfully');
});

export const logoutAll = asyncHandler(async (req, res) => {
  const result = await authService.logoutAll(req.user.id, req);
  clearRefreshCookie(res);
  return ApiResponse.ok(res, result, 'Signed out of all devices');
});

export const me = asyncHandler(async (req, res) => {
  const user = await authService.getProfile(req.user.id);
  return ApiResponse.ok(res, user);
});

export const permissions = asyncHandler(async (req, res) => {
  const result = await authService.getMyPermissions(req.user.id);
  return ApiResponse.ok(res, result, 'Effective permissions');
});

export const roleDefinitions = asyncHandler(async (_req, res) => {
  return ApiResponse.ok(res, authService.listRoleDefinitions(), 'Role definitions');
});

export const sessions = asyncHandler(async (req, res) => {
  const items = await authService.getSessions(req.user.id, resolveRefreshToken(req));
  return ApiResponse.ok(res, items, 'Active sessions');
});

export const loginHistory = asyncHandler(async (req, res) => {
  const { page, limit } = req.validatedQuery ?? { page: 1, limit: 20 };
  const result = await authService.getLoginHistory(req.user.id, { page, limit });

  return ApiResponse.paginated(res, result.items, {
    page: result.page,
    limit: result.limit,
    total: result.total,
  });
});

export default {
  register,
  verifyEmail,
  resendVerification,
  login,
  refresh,
  logout,
  logoutAll,
  me,
  permissions,
  roleDefinitions,
  sessions,
  loginHistory,
};
