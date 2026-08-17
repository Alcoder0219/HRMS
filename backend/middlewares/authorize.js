import ApiError from '../utils/ApiError.js';
import logger from '../config/logger.js';
import env from '../config/env.js';
import { ERROR_CODES, ROLE_RANK, ACTION_LABELS, ACTION_VALUES } from '../utils/constants.js';
import permissionHelper from '../helpers/permission.helper.js';

const { can, canAny, canAll, scopeFor, hasScopeAtLeast, isCrossTenant, toPermission } =
  permissionHelper;

/**
 * Denials are logged, not just returned. A run of them is either a
 * misconfigured route or someone probing the API, and both need to be visible.
 */
const deny = (req, next, { code, message, detail }) => {
  logger.warn('Authorisation denied', {
    userId: req.user?.id,
    role: req.user?.role,
    tenantId: req.user?.tenantId,
    method: req.method,
    path: req.originalUrl,
    requestId: req.id,
    ...detail,
  });

  return next(new ApiError(403, message, { code }));
};

const requireSession = (req, next) => {
  if (req.user) return true;
  // A permission guard mounted without `authenticate` in front of it is a
  // wiring bug; failing loudly here beats silently allowing the request.
  next(ApiError.unauthorized('Authentication required'));
  return false;
};

/* -------------------------------------------------------------------------- */
/*                             Resource binding                               */
/* -------------------------------------------------------------------------- */

/**
 * Declares which resource a router governs, so its routes can ask for an
 * action alone:
 *
 *   router.use(bindResource(RESOURCES.LEAVE));
 *   router.post('/:id/approve', requirePermission(ACTIONS.APPROVE), controller.approve);
 *
 * Keeps the resource name in one place per module instead of repeated on every
 * route, where it would eventually be copy-pasted wrong.
 */
export const bindResource = (resource) => (req, res, next) => {
  req.resource = resource;

  // Development safety net for the "every API is protected" rule: if a request
  // succeeds without any permission guard having run, the route forgot one.
  // Logged rather than blocked, because blocking would depend on middleware
  // ordering the route author cannot see.
  if (!env.isProduction) {
    res.on('finish', () => {
      if (!req.permission && res.statusCode < 400) {
        logger.error('Route responded without a permission check', {
          method: req.method,
          path: req.originalUrl,
          resource,
        });
      }
    });
  }

  next();
};

/**
 * Coarse gate mounted on every module router: the caller must hold at least
 * one grant on the resource. It is the floor, not the check -- individual
 * routes still declare the exact action. Its job is to guarantee that a route
 * which forgets to do so is never wide open.
 */
export const requireResourceAccess = (resource) => (req, _res, next) => {
  if (!requireSession(req, next)) return undefined;

  const granted = ACTION_VALUES.some((action) => can(req.user.role, resource, action));

  if (!granted) {
    return deny(req, next, {
      code: ERROR_CODES.FORBIDDEN_PERMISSION,
      message: `You do not have access to ${resource} records`,
      detail: { resource },
    });
  }

  return next();
};

/* -------------------------------------------------------------------------- */
/*                            Permission guards                               */
/* -------------------------------------------------------------------------- */

/**
 * The primary guard. Two call styles:
 *
 *   requirePermission(RESOURCES.PAYROLL, ACTIONS.APPROVE)  // explicit
 *   requirePermission(ACTIONS.APPROVE)                     // uses bindResource
 *
 * On success it records the resolved permission and scope on the request, so
 * the service and repository layers can narrow the query without recomputing
 * the decision.
 */
export const requirePermission =
  (resourceOrAction, maybeAction = null) =>
  (req, _res, next) => {
    if (!requireSession(req, next)) return undefined;

    const action = maybeAction ?? resourceOrAction;
    const resource = maybeAction ? resourceOrAction : req.resource;

    if (!resource) {
      // Fail closed: an unbound resource means the route is misconfigured, and
      // guessing would be worse than refusing.
      logger.error('requirePermission used without a resource', {
        path: req.originalUrl,
        action,
      });
      return next(ApiError.forbidden('This action is not available'));
    }

    if (!can(req.user.role, resource, action)) {
      return deny(req, next, {
        code: ERROR_CODES.FORBIDDEN_PERMISSION,
        message: `You do not have permission to ${(ACTION_LABELS[action] ?? action).toLowerCase()} ${resource} records`,
        detail: { required: toPermission(resource, action) },
      });
    }

    req.permission = {
      resource,
      action,
      scope: scopeFor(req.user.role, resource),
    };

    return next();
  };

/** Passes when the caller holds ANY of the listed `[resource, action]` pairs. */
export const requireAnyPermission =
  (...pairs) =>
  (req, _res, next) => {
    if (!requireSession(req, next)) return undefined;

    if (!canAny(req.user.role, pairs)) {
      return deny(req, next, {
        code: ERROR_CODES.FORBIDDEN_PERMISSION,
        message: 'You do not have permission to perform this action',
        detail: { requiredAny: pairs.map(([r, a]) => toPermission(r, a)) },
      });
    }

    return next();
  };

/**
 * Passes only when the caller holds EVERY listed pair. For endpoints that
 * genuinely combine two capabilities -- exporting a payroll register is both
 * `payroll:read` and `payroll:export`.
 */
export const requireAllPermissions =
  (...pairs) =>
  (req, _res, next) => {
    if (!requireSession(req, next)) return undefined;

    if (!canAll(req.user.role, pairs)) {
      return deny(req, next, {
        code: ERROR_CODES.FORBIDDEN_PERMISSION,
        message: 'You do not have permission to perform this action',
        detail: { requiredAll: pairs.map(([r, a]) => toPermission(r, a)) },
      });
    }

    return next();
  };

/**
 * Requires a minimum breadth of reach -- e.g. an organisation-wide report is
 * meaningless to a SELF-scoped caller, so demand TENANT or wider.
 */
export const requireScope =
  (minimumScope, resource = null) =>
  (req, _res, next) => {
    if (!requireSession(req, next)) return undefined;

    const target = resource ?? req.resource;

    if (!hasScopeAtLeast(req.user.role, minimumScope, target)) {
      return deny(req, next, {
        code: ERROR_CODES.FORBIDDEN_SCOPE,
        message: 'Your access is limited to a narrower set of records',
        detail: { requiredScope: minimumScope, actualScope: scopeFor(req.user.role, target) },
      });
    }

    return next();
  };

/* -------------------------------------------------------------------------- */
/*                              Role guards                                   */
/* -------------------------------------------------------------------------- */

/**
 * Exact role match. Prefer `requirePermission` -- a route pinned to a role list
 * has to be edited every time the org chart grows a new title, whereas a
 * permission check keeps working.
 */
export const authorize =
  (...allowedRoles) =>
  (req, _res, next) => {
    if (!requireSession(req, next)) return undefined;

    if (allowedRoles.length && !allowedRoles.flat().includes(req.user.role)) {
      return deny(req, next, {
        code: ERROR_CODES.FORBIDDEN_ROLE,
        message: 'You do not have permission to perform this action',
        detail: { allowedRoles: allowedRoles.flat() },
      });
    }

    return next();
  };

/** Rank-based: "this role or more senior". See ROLE_RANK's caveat. */
export const authorizeMinimum = (minimumRole) => (req, _res, next) => {
  if (!requireSession(req, next)) return undefined;

  const userRank = ROLE_RANK[req.user.role] ?? 0;
  const requiredRank = ROLE_RANK[minimumRole] ?? Number.MAX_SAFE_INTEGER;

  if (userRank < requiredRank) {
    return deny(req, next, {
      code: ERROR_CODES.FORBIDDEN_ROLE,
      message: 'You do not have permission to perform this action',
      detail: { minimumRole },
    });
  }

  return next();
};

/* -------------------------------------------------------------------------- */
/*                              Tenant isolation                              */
/* -------------------------------------------------------------------------- */

/**
 * Blocks reading or writing another tenant's data. SUPER_ADMIN is exempt by
 * design; every other role is confined to the tenant on its own token, which
 * cannot be overridden by a request parameter.
 */
export const enforceTenantScope =
  (getTargetTenantId = (req) => req.params.tenantId ?? req.body?.tenantId) =>
  (req, _res, next) => {
    if (!requireSession(req, next)) return undefined;
    if (isCrossTenant(req.user.role)) return next();

    const target = getTargetTenantId(req);
    if (target && String(target) !== String(req.user.tenantId)) {
      return deny(req, next, {
        code: ERROR_CODES.FORBIDDEN_TENANT,
        message: 'You cannot access data belonging to another organisation',
        detail: { requestedTenant: String(target) },
      });
    }

    return next();
  };

/* -------------------------------------------------------------------------- */
/*                              Login portals                                 */
/* -------------------------------------------------------------------------- */

/**
 * Restricts which roles may authenticate through a given login route, for
 * separate sign-in portals (an admin console rejecting an EMPLOYEE credential,
 * for example):
 *
 *   router.post('/admin/login', restrictLoginTo(ROLES.COMPANY_ADMIN), ..., login)
 *
 * Set here rather than read from the request body -- a client must not be able
 * to widen or narrow the roles a portal accepts.
 */
export const restrictLoginTo =
  (...roles) =>
  (req, _res, next) => {
    req.allowedRoles = roles.flat();
    next();
  };

/**
 * Gate for accounts flagged `mustChangePassword`. Applied to the wider API so
 * an admin-provisioned temporary password cannot be used indefinitely, while
 * leaving the change-password endpoint itself reachable.
 */
export const requirePasswordChangeComplete = (req, _res, next) => {
  if (req.user?.mustChangePassword) {
    return next(
      new ApiError(403, 'You must change your password before continuing', {
        code: ERROR_CODES.PASSWORD_CHANGED,
      }),
    );
  }
  return next();
};

export default requirePermission;
