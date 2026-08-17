/**
 * Client-side permission vocabulary and checks.
 *
 * These decide what the UI SHOWS. They are not a security boundary: every one
 * of them is enforced again by the API, which is the authority. Hiding a
 * button is a courtesy; the server refusing the request is the control.
 */

export const ACTIONS = {
  READ: 'read',
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  APPROVE: 'approve',
  REJECT: 'reject',
  EXPORT: 'export',
  PRINT: 'print',
  DASHBOARD: 'dashboard',
};

export const RESOURCES = {
  DASHBOARD: 'dashboard',
  TENANT: 'tenant',
  USER: 'user',
  ROLE: 'role',
  EMPLOYEE: 'employee',
  ORGANIZATION: 'organization',
  ATTENDANCE: 'attendance',
  LEAVE: 'leave',
  PAYROLL: 'payroll',
  RECRUITMENT: 'recruitment',
  PERFORMANCE: 'performance',
  DOCUMENT: 'document',
  NOTIFICATION: 'notification',
  REPORT: 'report',
  AUDIT: 'audit',
};

export const ACTION_LABELS = {
  [ACTIONS.READ]: 'Read',
  [ACTIONS.CREATE]: 'Create',
  [ACTIONS.UPDATE]: 'Update',
  [ACTIONS.DELETE]: 'Delete',
  [ACTIONS.APPROVE]: 'Approve',
  [ACTIONS.REJECT]: 'Reject',
  [ACTIONS.EXPORT]: 'Export',
  [ACTIONS.PRINT]: 'Print',
  [ACTIONS.DASHBOARD]: 'Dashboard Access',
};

/** Same `resource:action` format the server emits. */
export const toPermission = (resource, action) => `${resource}:${action}`;

/**
 * `granted` is the flat list the server attached to the user. A Set is built by
 * the hook that owns it; these helpers accept either a Set or an array so they
 * are usable outside React too.
 */
const has = (granted, permission) =>
  granted instanceof Set ? granted.has(permission) : Boolean(granted?.includes(permission));

export const can = (granted, resource, action) => has(granted, toPermission(resource, action));

export const canAny = (granted, pairs = []) =>
  pairs.some(([resource, action]) => can(granted, resource, action));

export const canAll = (granted, pairs = []) =>
  pairs.length > 0 && pairs.every(([resource, action]) => can(granted, resource, action));

/** Every action the user holds on a resource -- useful for rendering a toolbar. */
export const actionsOn = (granted, resource) =>
  Object.values(ACTIONS).filter((action) => can(granted, resource, action));
