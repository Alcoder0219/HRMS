import axiosClient from '@services/api/axiosClient.js';
import { ENDPOINTS } from '@services/api/endpoints.js';

const url = (path) => `${ENDPOINTS.auth}${path}`;

/**
 * Typed call-set for the auth API. The refresh token is never handled here --
 * it lives in an httpOnly cookie the browser attaches on its own, which is the
 * point of storing it that way.
 */
const authService = {
  register: (payload) => axiosClient.post(url('/register'), payload),

  login: ({ email, password, rememberMe = false, tenantId = null }) =>
    axiosClient.post(url('/login'), { email, password, rememberMe, tenantId }),

  logout: () => axiosClient.post(url('/logout')),

  logoutAll: () => axiosClient.post(url('/logout-all')),

  /** Called directly only on app boot; ongoing refresh is automatic in the interceptor. */
  refresh: () => axiosClient.post(url('/refresh')),

  me: () => axiosClient.get(url('/me')),

  /** The caller's own effective permissions and scope. */
  permissions: () => axiosClient.get(url('/permissions')),

  /** The full role matrix. Requires `role:read` -- admin screens only. */
  roleDefinitions: () => axiosClient.get(url('/roles')),

  verifyEmail: (token) => axiosClient.post(url('/verify-email'), { token }),

  resendVerification: (email, tenantId = null) =>
    axiosClient.post(url('/resend-verification'), { email, tenantId }),

  forgotPassword: (email, tenantId = null) =>
    axiosClient.post(url('/forgot-password'), { email, tenantId }),

  resetPassword: ({ token, newPassword, confirmPassword }) =>
    axiosClient.post(url('/reset-password'), { token, newPassword, confirmPassword }),

  changePassword: ({ currentPassword, newPassword, confirmPassword }) =>
    axiosClient.post(url('/change-password'), { currentPassword, newPassword, confirmPassword }),

  sessions: () => axiosClient.get(url('/sessions')),

  loginHistory: ({ page = 1, limit = 20 } = {}) =>
    axiosClient.get(url('/login-history'), { params: { page, limit } }),
};

export default authService;
