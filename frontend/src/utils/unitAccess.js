/**
 * Unit isolation, as the screens need to know it.
 *
 * Display only. Every list, record and export is already narrowed by the
 * server from the database, whatever the client shows; this decides which
 * choices to offer -- chiefly whether "All units" makes sense.
 *
 * The session (`/auth/me`) carries the authoritative `unitAccess`. Until it
 * has loaded, the role decides: only these see every unit, matching the
 * server's UNIT_UNRESTRICTED_ROLES.
 */
export const UNIT_UNRESTRICTED_ROLES = ['SUPER_ADMIN', 'COMPANY_ADMIN'];

/** Roles that may be assigned several units, matching the server. */
export const MULTI_UNIT_ROLES = ['HOD'];

export const resolveUnitAccess = (user) => {
  if (!user) return { all: false, units: [], loaded: false };
  if (user.unitAccess) {
    return { all: Boolean(user.unitAccess.all), units: user.unitAccess.units ?? [], loaded: true };
  }
  return { all: UNIT_UNRESTRICTED_ROLES.includes(user.role), units: [], loaded: false };
};

/**
 * The label for the empty choice of a unit filter: "All units" for someone who
 * sees every unit, "All my units" for a multi-unit account, and null -- no
 * empty choice at all -- for someone confined to one unit.
 */
export const allUnitsLabel = ({ all }, optionCount) => {
  if (all) return 'All units';
  return optionCount > 1 ? 'All my units' : null;
};

export default { UNIT_UNRESTRICTED_ROLES, MULTI_UNIT_ROLES, resolveUnitAccess, allUnitsLabel };
