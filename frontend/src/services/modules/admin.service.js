import axiosClient from '@services/api/axiosClient.js';

const BASE = '/administration';

const url = (path = '') => `${BASE}${path}`;

const clean = (params = {}) =>
  Object.fromEntries(
    Object.entries(params).filter(
      ([, value]) =>
        value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && !value.length),
    ),
  );

/**
 * Client for backend/routes/admin/admin.routes.js.
 *
 * Grouped the way the permissions are, not the way the screens are: user
 * management, the audit trail, settings and backup are four different rights,
 * and a reader of this file should be able to see which calls belong together.
 */
const adminService = {
  /* -------------------------------------------------------------- users -- */
  listUsers: (params) => axiosClient.get(url('/users'), { params: clean(params) }),
  userSummary: () => axiosClient.get(url('/users/summary')),
  getUser: (id) => axiosClient.get(url(`/users/${id}`)),
  createUser: (payload) => axiosClient.post(url('/users'), payload),
  updateUser: (id, payload) => axiosClient.patch(url(`/users/${id}`), payload),
  setUserStatus: (id, payload) => axiosClient.patch(url(`/users/${id}/status`), payload),
  unlockUser: (id) => axiosClient.post(url(`/users/${id}/unlock`)),
  resetUserPassword: (id, payload) => axiosClient.post(url(`/users/${id}/password`), payload),
  revokeUserSessions: (id) => axiosClient.post(url(`/users/${id}/revoke-sessions`)),
  deleteUser: (id) => axiosClient.delete(url(`/users/${id}`)),
  exportUsers: (params) => axiosClient.get(url('/users/export'), { params: clean(params), responseType: 'blob' }),

  /* --------------------------------------------------------- audit logs -- */
  listAuditLogs: (params) => axiosClient.get(url('/audit'), { params: clean(params) }),
  getAuditLog: (id) => axiosClient.get(url(`/audit/${id}`)),
  auditFilters: () => axiosClient.get(url('/audit/filters')),
  exportAuditExcel: (params) =>
    axiosClient.get(url('/audit/export'), { params: clean(params), responseType: 'blob' }),
  exportAuditPdf: (params) =>
    axiosClient.get(url('/audit/export'), { params: clean({ ...params, format: 'pdf' }), responseType: 'blob' }),

  /* ------------------------------------------------------ activity feed -- */
  loginHistory: (params) => axiosClient.get(url('/login-history'), { params: clean(params) }),
  activity: (params) => axiosClient.get(url('/activity'), { params: clean(params) }),
  activityStats: (params) => axiosClient.get(url('/activity/stats'), { params: clean(params) }),

  /* ----------------------------------------------------------- settings -- */
  getSettings: () => axiosClient.get(url('/settings')),
  updateCompany: (payload) => axiosClient.patch(url('/settings/company'), payload),
  updateEmail: (payload) => axiosClient.patch(url('/settings/email'), payload),
  testEmail: (payload) => axiosClient.post(url('/settings/email/test'), payload),
  updateNotifications: (payload) => axiosClient.patch(url('/settings/notifications'), payload),
  setMaintenance: (payload) => axiosClient.patch(url('/settings/maintenance'), payload),

  /* -------------------------------------------------- biometric devices -- */
  /**
   * Attendance terminals. Configured under Settings, but saved per action
   * rather than with the payroll form -- adding a device and changing the NSSF
   * rate are unrelated acts and should not share a Save button.
   */
  listBiometricDevices: () => axiosClient.get(url('/biometric/devices')),
  addBiometricDevice: (payload) => axiosClient.post(url('/biometric/devices'), payload),
  updateBiometricDevice: (deviceId, payload) =>
    axiosClient.put(url(`/biometric/devices/${deviceId}`), payload),
  removeBiometricDevice: (deviceId) => axiosClient.delete(url(`/biometric/devices/${deviceId}`)),
  testBiometricDevice: (deviceId) => axiosClient.post(url(`/biometric/devices/${deviceId}/test`)),
  syncBiometricDevice: (deviceId) => axiosClient.post(url(`/biometric/devices/${deviceId}/sync`)),
  fetchDeviceUsers: (deviceId) => axiosClient.get(url(`/biometric/devices/${deviceId}/users`)),
  mapDeviceUsers: (deviceId, mappings) =>
    axiosClient.post(url(`/biometric/devices/${deviceId}/map`), { mappings }),

  /* --------------------------------------------------- backup, restore -- */
  backupPreview: () => axiosClient.get(url('/backup/preview')),
  downloadBackup: () => axiosClient.get(url('/backup'), { responseType: 'blob' }),

  /**
   * Sends the archive as a file rather than inline JSON.
   *
   * A full backup pasted into a JSON body would hit the body-size limit long
   * before the 64 MB the upload route allows.
   */
  restore: (file, { mode, dryRun, confirm }) => {
    const form = new FormData();
    form.append('archive', file);
    form.append('mode', mode);
    form.append('dryRun', String(dryRun));
    if (confirm) form.append('confirm', confirm);

    return axiosClient.post(url('/restore'), form);
  },
};

export default adminService;
