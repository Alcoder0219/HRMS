import mongoose from 'mongoose';

import ApiError from '../utils/ApiError.js';
import logger from '../config/logger.js';
import Employee from '../models/employee/employee.model.js';
import User from '../models/auth/user.model.js';
import { ERROR_CODES, MULTI_UNIT_ROLES, SCOPES, UNIT_UNRESTRICTED_ROLES } from '../utils/constants.js';
import { getRoleCache } from '../services/auth/roleCache.service.js';
import { buildScopeFilter, isCrossTenant, scopeFor } from './permission.helper.js';

/**
 * Unit data isolation.
 *
 * Every account is either unrestricted (Super Admin, Company Admin) or confined
 * to its unit(s). The units come from the account itself (`User.unitIds`) or,
 * when that is empty, from the employee record the account is linked to. With
 * neither, the account sees no unit data at all -- it is never given a default.
 *
 * The decision is made ONCE, in `authenticate`, from the database -- never from
 * anything the client sends -- and carried on `req.user.unitAccess`:
 *
 *   { all: true }                                  every unit
 *   { all: false, unitIds: [...], employeeIds: [...] }  only these
 *
 * `employeeIds` is every employee (soft-deleted included, so their history and
 * the restore flow stay reachable) whose unit is one of `unitIds`. Records that
 * hang off an employee -- attendance, leave, payslips, loans -- are confined by
 * it; the Employee collection itself is confined by it too, so one rule covers
 * both.
 *
 * A person's own records are never unit-restricted: an employee whose unit is
 * not yet set still sees their own attendance and payslips.
 */

const toId = (value) => (value === null || value === undefined ? null : String(value?._id ?? value));
const toObjectId = (value) => (mongoose.Types.ObjectId.isValid(String(value)) ? new mongoose.Types.ObjectId(String(value)) : null);

export const isUnitUnrestrictedRole = (role) =>
  UNIT_UNRESTRICTED_ROLES.includes(role) || Boolean(getRoleCache()[role]?.isCrossTenant);

export const canHoldManyUnits = (role) => MULTI_UNIT_ROLES.includes(role);

/**
 * Works out an account's unit reach from the database. Called by
 * `authenticate` on every request, so a unit change takes effect immediately.
 */
export const resolveUnitAccess = async (user) => {
  if (isUnitUnrestrictedRole(user.role)) {
    return { all: true, unitIds: [], employeeIds: [], source: 'ROLE' };
  }

  let unitIds = (user.unitIds ?? []).map(toId).filter(Boolean);
  let source = unitIds.length ? 'ACCOUNT' : null;

  if (!unitIds.length && user.employeeId) {
    const employee = await Employee.findOne({ _id: user.employeeId, deletedAt: null }).select('unitId').lean();
    if (employee?.unitId) {
      unitIds = [toId(employee.unitId)];
      source = 'EMPLOYEE';
    }
  }

  // A self-service role never reaches anyone else's records, so it has no use
  // for the unit's employee list; skipping it saves a query per request.
  const selfOnly = (getRoleCache()[user.role]?.scope ?? SCOPES.SELF) === SCOPES.SELF;

  const employeeIds =
    unitIds.length && !selfOnly
      ? (
          await Employee.find({ tenantId: user.tenantId ?? null, unitId: { $in: unitIds.map(toObjectId) } })
            .select('_id')
            .lean()
        ).map((employee) => employee._id)
      : [];

  return { all: false, unitIds, employeeIds, source };
};

/**
 * The caller's reach. A request built without `authenticate` (a script, a job)
 * is unrestricted only for an unrestricted role; anything else fails closed.
 */
export const unitAccessOf = (req) => {
  if (req?.user?.unitAccess) return req.user.unitAccess;
  return isUnitUnrestrictedRole(req?.user?.role)
    ? { all: true, unitIds: [], employeeIds: [] }
    : { all: false, unitIds: [], employeeIds: [] };
};

export const isUnitRestricted = (req) => !unitAccessOf(req).all;

/** The unit ids the caller may see, or null for every unit. */
export const allowedUnitIds = (req) => (isUnitRestricted(req) ? unitAccessOf(req).unitIds : null);

/** The employee ids the caller's units cover, or null for every employee. */
export const allowedEmployeeIds = (req) => (isUnitRestricted(req) ? unitAccessOf(req).employeeIds : null);

export const unitAllowed = (req, unitId) => !isUnitRestricted(req) || (unitId !== null && unitId !== undefined && unitAccessOf(req).unitIds.includes(toId(unitId)));

export const employeeIdAllowed = (req, employeeId) => {
  if (!isUnitRestricted(req)) return true;
  if (employeeId && toId(employeeId) === toId(req.user?.employeeId)) return true;
  return unitAccessOf(req).employeeIds.some((id) => toId(id) === toId(employeeId));
};

export const unitDenied = (req, detail = {}, message = 'This record belongs to a unit outside your access') => {
  logger.warn('Unit access denied', {
    userId: req?.user?.id,
    role: req?.user?.role,
    method: req?.method,
    path: req?.originalUrl,
    requestId: req?.id,
    ...detail,
  });
  return new ApiError(403, message, { code: ERROR_CODES.FORBIDDEN_UNIT });
};

/**
 * A Mongo filter fragment confining `field` (an employee reference) to the
 * caller's units, or `{}` when unrestricted. Merge it with `$and` when the
 * query may already constrain the same field:
 *
 *   Payslip.find({ $and: [query, employeeUnitFilter(req)] })
 */
export const employeeUnitFilter = (req, field = 'employeeId') => {
  const ids = allowedEmployeeIds(req);
  return ids ? { [field]: { $in: ids } } : {};
};

/** The same, for a collection that stores the unit itself. */
export const unitFieldFilter = (req, field = 'unitId') => {
  const ids = allowedUnitIds(req);
  return ids ? { [field]: { $in: ids.map(toObjectId) } } : {};
};

/**
 * Narrows a list of employee ids (or null for "everyone") to the caller's
 * units. Returns null only when both sides are unrestricted.
 */
export const intersectEmployeeIds = (req, ids) => {
  const allowed = allowedEmployeeIds(req);
  if (!allowed) return ids;
  if (ids === null || ids === undefined) return allowed;
  const permitted = new Set(allowed.map(toId));
  return ids.filter((id) => permitted.has(toId(id)));
};

/**
 * Every employee the caller may see for `resource` -- scope (own, team,
 * department, organisation) and unit together -- or null when that is
 * everyone. For queries on collections that reference an employee.
 */
export const visibleEmployeeIds = async (req, resource) => {
  const scope = buildScopeFilter(req, {
    ownerField: '_id',
    managerField: 'reportingManagerId',
    departmentField: 'departmentId',
    resource,
  });
  delete scope.tenantId;
  if (!Object.keys(scope).length) return null;

  const rows = await Employee.find({ tenantId: req.user?.tenantId ?? null, ...scope }).select('_id').lean();
  return rows.map((row) => row._id);
};

/**
 * Login accounts a unit-restricted caller may see: those assigned one of their
 * units, and those with no unit of their own whose linked employee is in one
 * of their units. `{}` when the caller sees every unit.
 */
export const accountUnitFilter = (req) => {
  if (!isUnitRestricted(req)) return {};
  const { unitIds, employeeIds } = unitAccessOf(req);
  return {
    $or: [
      { unitIds: { $in: unitIds.map(toObjectId) } },
      { 'unitIds.0': { $exists: false }, employeeId: { $in: employeeIds } },
    ],
  };
};

/** Ids of the accounts `accountUnitFilter` admits, or null for all. */
export const visibleAccountIds = async (req) => {
  if (!isUnitRestricted(req)) return null;
  const rows = await User.find({ tenantId: req.user?.tenantId ?? null, ...accountUnitFilter(req) }).select('_id').lean();
  return rows.map((row) => row._id);
};

/* ------------------------------------------------------- record-level check */

const sameTenant = (req, record) => {
  if (isCrossTenant(req.user?.role)) return true;
  const callerTenant = req.user?.tenantId ?? null;
  const recordTenant = record?.tenantId ? toId(record.tenantId) : null;
  return callerTenant === null || recordTenant === callerTenant;
};

/**
 * Whether the caller may act on this employee's records for `resource`.
 *
 * Both halves must hold: the role's scope (own records, team, department, or
 * the whole organisation) AND the unit. Your own record is always yours.
 */
export const canAccessEmployee = (req, employee, resource) => {
  if (!employee || !sameTenant(req, employee)) return false;

  const own = req.user?.employeeId && toId(employee._id) === toId(req.user.employeeId);
  if (own) return true;

  const scope = scopeFor(req.user?.role, resource);
  if (scope === SCOPES.SELF) return false;
  if (scope === SCOPES.TEAM && toId(employee.reportingManagerId) !== toId(req.user?.employeeId ?? req.user?.id)) return false;
  if (scope === SCOPES.DEPARTMENT && (!req.user?.departmentId || toId(employee.departmentId) !== toId(req.user.departmentId))) return false;

  return !isUnitRestricted(req) || unitAllowed(req, employee.unitId);
};

const ACCESS_FIELDS = 'tenantId unitId reportingManagerId departmentId deletedAt';

/**
 * Loads an employee (or takes one already loaded) and refuses with 403 when
 * the caller may not reach it. Use before reading, changing, approving or
 * deleting anything that belongs to one person, so a record id taken from
 * another unit -- or another employee -- is refused rather than served.
 */
export const assertEmployeeAccess = async (req, employeeOrId, resource, { notFound = 'Employee not found' } = {}) => {
  if (!employeeOrId) throw ApiError.notFound(notFound);

  // A document passed in is used only if it carries the unit; a partial one
  // (unit not selected) is reloaded rather than judged on a missing field.
  const isDocument = typeof employeeOrId === 'object' && !(employeeOrId instanceof mongoose.Types.ObjectId) && employeeOrId._id !== undefined;
  const employee =
    isDocument && employeeOrId.unitId !== undefined && employeeOrId.tenantId !== undefined
      ? employeeOrId
      : await Employee.findById(toId(isDocument ? employeeOrId._id : employeeOrId)).select(ACCESS_FIELDS).lean();

  if (!employee) throw ApiError.notFound(notFound);
  // Another organisation's id is "not found": confirming it exists elsewhere
  // would itself leak across tenants.
  if (!sameTenant(req, employee)) throw ApiError.notFound(notFound);

  if (!canAccessEmployee(req, employee, resource)) {
    throw unitDenied(req, { employeeId: toId(employee._id), resource }, 'You do not have access to this employee’s records');
  }

  return employee;
};

/* ------------------------------------------------------ writes: which unit */

/**
 * The unit a restricted caller is creating a record in, or moving one to.
 *
 * - Unrestricted callers may name any unit (or none).
 * - A restricted caller who names none gets their own unit when they have
 *   exactly one -- the backend assigns it, the client is not trusted to.
 * - A restricted caller naming a unit outside their reach is refused (403).
 */
export const resolveWritableUnit = (req, requested, { required = true } = {}) => {
  if (!isUnitRestricted(req)) return requested ?? null;

  const { unitIds } = unitAccessOf(req);
  if (requested !== null && requested !== undefined && requested !== '') {
    if (!unitIds.includes(toId(requested))) {
      throw unitDenied(req, { requestedUnit: toId(requested) }, 'You cannot assign a record to a unit outside your access');
    }
    return requested;
  }

  if (unitIds.length === 1) return unitIds[0];
  if (!unitIds.length) {
    throw unitDenied(req, {}, 'Your account has no unit assigned. Ask an administrator to assign one.');
  }
  if (required) throw ApiError.badRequest('Choose which of your units this record belongs to');
  return null;
};

export default {
  isUnitUnrestrictedRole,
  canHoldManyUnits,
  resolveUnitAccess,
  unitAccessOf,
  isUnitRestricted,
  allowedUnitIds,
  allowedEmployeeIds,
  unitAllowed,
  employeeIdAllowed,
  unitDenied,
  employeeUnitFilter,
  unitFieldFilter,
  intersectEmployeeIds,
  visibleEmployeeIds,
  accountUnitFilter,
  visibleAccountIds,
  canAccessEmployee,
  assertEmployeeAccess,
  resolveWritableUnit,
};
