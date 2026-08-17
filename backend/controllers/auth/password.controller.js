import asyncHandler from '../../utils/asyncHandler.js';
import ApiResponse from '../../utils/ApiResponse.js';
import passwordService from '../../services/auth/password.service.js';
import { readRefreshCookie } from '../../helpers/cookie.helper.js';

export const forgotPassword = asyncHandler(async (req, res) => {
  const result = await passwordService.forgotPassword(req.body, req);

  // Deliberately the same response for a known and an unknown address.
  return ApiResponse.ok(
    res,
    result,
    'If that account exists, a password reset link has been sent',
  );
});

export const resetPassword = asyncHandler(async (req, res) => {
  const result = await passwordService.resetPassword(
    { token: req.body.token, newPassword: req.body.newPassword },
    req,
  );

  return ApiResponse.ok(res, result, 'Password reset successfully. Please sign in.');
});

export const changePassword = asyncHandler(async (req, res) => {
  const result = await passwordService.changePassword(
    {
      userId: req.user.id,
      currentPassword: req.body.currentPassword,
      newPassword: req.body.newPassword,
      // Passing the caller's own refresh token keeps this device signed in
      // while every other session is revoked.
      currentToken: readRefreshCookie(req) || req.body.refreshToken || null,
    },
    req,
  );

  return ApiResponse.ok(
    res,
    result,
    'Password changed successfully. Other devices have been signed out.',
  );
});

export default { forgotPassword, resetPassword, changePassword };
