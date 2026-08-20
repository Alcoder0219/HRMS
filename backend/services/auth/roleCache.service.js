import Role from '../../models/auth/role.model.js';

/**
 * The live role matrix, held in memory.
 *
 * `permission.helper.js` runs on every authenticated request and must stay
 * synchronous -- it cannot await a database round trip per request the way
 * the rest of the RBAC write path can. This cache is what makes that possible
 * now that roles live in the `Role` collection instead of a static import:
 * the matrix is loaded once at boot and refreshed (awaited) at the end of
 * every role-mutating write, so the next request sees the change without a
 * per-request query.
 *
 * Shape: `{ [code]: { scope, rank, isCrossTenant, permissions: { [resource]: actions[] } } }`
 * -- the same shape `PERMISSION_MATRIX` used to have.
 */
let matrix = {};

const toEntry = (role) => [
  role.code,
  {
    scope: role.scope,
    rank: role.rank,
    isCrossTenant: Boolean(role.isCrossTenant),
    permissions: Object.fromEntries((role.permissions ?? []).map((entry) => [entry.resource, entry.actions ?? []])),
  },
];

export const loadRoleCache = async () => {
  const roles = await Role.find().lean();
  matrix = Object.fromEntries(roles.map(toEntry));
  return matrix;
};

export const getRoleCache = () => matrix;

export default { loadRoleCache, getRoleCache };
