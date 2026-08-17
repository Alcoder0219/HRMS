/**
 * Every backend path the client knows about, mirroring backend/routes/index.js.
 * URLs live here rather than inline in call sites so an API version bump or a
 * renamed resource is a one-file change.
 */
export const ENDPOINTS = {
  auth: '/auth',
  tenants: '/tenants',
  employees: '/employees',
  organization: '/organization',
  attendance: '/attendance',
  leaves: '/leaves',
  payroll: '/payroll',
  recruitment: '/recruitment',
  performance: '/performance',
  documents: '/documents',
  notifications: '/notifications',
  reports: '/reports',
};

export default ENDPOINTS;
