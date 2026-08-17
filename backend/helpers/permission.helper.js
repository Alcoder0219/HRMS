import {
  ACTION_VALUES,
  RESOURCE_VALUES,
  SCOPES,
  SCOPE_RANK,
  WILDCARD,
  CROSS_TENANT_ROLES,
} from '../utils/constants.js';
import { PERMISSION_MATRIX, ALWAYS_SELF_SCOPED } from '../config/permissions.js';

/** Canonical permission string. One format everywhere: `resource:action`. */
export const toPermission = (resource, action) => `${resource}:${action}`;

const entryFor = (role) => PERMISSION_MATRIX[role] ?? null;

/**
 * Core check: may this role perform this action on this resource?
 *
 * Fails closed. An unknown role, resource or action returns false rather than
 * throwing -- a typo in a route definition must deny access, never grant it or
 * crash the request.
 */
export const can = (role, resource, action) => {
  const entry = entryFor(role);
  if (!entry || !resource || !action) return false;

  const { permissions } = entry;
  const matches = (list) =>
    Array.isArray(list) && (list.includes(WILDCARD) || list.includes(action));

  // A wildcard resource grant covers everything; otherwise the resource must be
  // listed explicitly.
  return matches(permissions[WILDCARD]) || matches(permissions[resource]);
};

export const canAny = (role, pairs = []) =>
  pairs.some(([resource, action]) => can(role, resource, action));

export const canAll = (role, pairs = []) =>
  pairs.length > 0 && pairs.every(([resource, action]) => can(role, resource, action));

/* ------------------------------------------------------------------ scope */

/**
 * How far this role's grant reaches for a resource. Some resources are pinned
 * to SELF regardless of seniority.
 */
export const scopeFor = (role, resource = null) => {
  const entry = entryFor(role);
  if (!entry) return SCOPES.SELF;

  if (resource && ALWAYS_SELF_SCOPED.includes(resource)) return SCOPES.SELF;

  return entry.scope ?? SCOPES.SELF;
};

export const hasScopeAtLeast = (role, required, resource = null) =>
  (SCOPE_RANK[scopeFor(role, resource)] ?? 0) >= (SCOPE_RANK[required] ?? Number.MAX_SAFE_INTEGER);

export const isCrossTenant = (role) => CROSS_TENANT_ROLES.includes(role);

/**
 * Translates a role's scope into a MongoDB filter fragment, so repositories
 * narrow a query to the records the caller may actually see.
 *
 * Field names are supplied by the caller because each collection stores its
 * ownership differently -- an attendance row keys off `employeeId`, a document
 * off `ownerId`. Modules pass their own mapping.
 *
 *   const filter = buildScopeFilter(req, { ownerField: 'employeeId' });
 *   return Attendance.find({ ...filter, month });
 */
export const buildScopeFilter = (
  req,
  { ownerField = 'userId', managerField = 'managerId', departmentField = 'departmentId', resource = null } = {},
) => {
  const { role, id, tenantId, employeeId, departmentId } = req.user ?? {};
  const scope = scopeFor(role, resource ?? req.resource);

  switch (scope) {
    case SCOPES.GLOBAL:
      return {};

    case SCOPES.TENANT:
      return { tenantId };

    case SCOPES.DEPARTMENT:
      // Falls back to SELF when the user has no department yet, rather than
      // matching `undefined` and leaking the whole tenant.
      return departmentId
        ? { tenantId, [departmentField]: departmentId }
        : { tenantId, [ownerField]: employeeId ?? id };

    case SCOPES.TEAM:
      return { tenantId, [managerField]: employeeId ?? id };

    case SCOPES.SELF:
    default:
      return { tenantId, [ownerField]: employeeId ?? id };
  }
};

/* ------------------------------------------------------------ enumeration */

/**
 * Flattens a role into an explicit permission list, expanding wildcards.
 *
 * Sent to the client so the UI can hide what the user cannot do. The list is
 * derived from the same matrix the middleware enforces, which is why the
 * client is never given its own copy of the rules to drift out of sync.
 */
export const permissionsFor = (role) => {
  const entry = entryFor(role);
  if (!entry) return [];

  const granted = new Set();

  for (const [resource, actions] of Object.entries(entry.permissions)) {
    const resources = resource === WILDCARD ? RESOURCE_VALUES : [resource];
    const resolvedActions = actions.includes(WILDCARD) ? ACTION_VALUES : actions;

    for (const res of resources) {
      for (const action of resolvedActions) granted.add(toPermission(res, action));
    }
  }

  return [...granted].sort();
};

/** Full description of a role, for the RBAC admin screen and `/auth/permissions`. */
export const describeRole = (role) => {
  const entry = entryFor(role);
  if (!entry) return null;

  return {
    role,
    scope: entry.scope,
    description: entry.description,
    crossTenant: isCrossTenant(role),
    permissions: permissionsFor(role),
  };
};

export default {
  can,
  canAny,
  canAll,
  scopeFor,
  hasScopeAtLeast,
  isCrossTenant,
  buildScopeFilter,
  permissionsFor,
  describeRole,
  toPermission,
};
