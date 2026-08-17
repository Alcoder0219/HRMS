import { useMemo, useCallback } from 'react';
import { useAppSelector } from './useRedux.js';
import { selectCurrentUser } from '@redux/slices/authSlice.js';
import { can, canAny, canAll, actionsOn } from '@utils/permissions.js';
import { ROLES, SCOPES } from '@utils/roles.js';

const SCOPE_RANK = {
  [SCOPES.SELF]: 10,
  [SCOPES.TEAM]: 20,
  [SCOPES.DEPARTMENT]: 30,
  [SCOPES.TENANT]: 40,
  [SCOPES.GLOBAL]: 50,
};

/**
 * Permission checks for components.
 *
 *   const { can } = usePermissions();
 *   {can(RESOURCES.LEAVE, ACTIONS.APPROVE) && <ApproveButton />}
 *
 * The permission list comes from the server with the user, so this hook holds
 * no rules of its own -- it only looks up what the server already decided.
 */
const usePermissions = () => {
  const user = useAppSelector(selectCurrentUser);

  // A Set, because a toolbar can run a dozen of these per render and the list
  // reaches ~135 entries for a SUPER_ADMIN.
  const granted = useMemo(() => new Set(user?.permissions ?? []), [user?.permissions]);

  /**
   * SUPER_ADMIN is answered yes without consulting the list.
   *
   * The server already grants it the wildcard, so this changes nothing today --
   * it is here so a new resource added to the vocabulary can never be missing
   * from the platform operator's menu while the grant catches up. It is still
   * only a display rule: the API re-checks every request, and that is the
   * check that matters.
   */
  const isSuperAdmin = user?.role === ROLES.SUPER_ADMIN;

  return {
    permissions: granted,
    scope: user?.scope ?? SCOPES.SELF,
    isSuperAdmin,

    can: useCallback(
      (resource, action) => isSuperAdmin || can(granted, resource, action),
      [granted, isSuperAdmin],
    ),
    canAny: useCallback((pairs) => isSuperAdmin || canAny(granted, pairs), [granted, isSuperAdmin]),
    canAll: useCallback((pairs) => isSuperAdmin || canAll(granted, pairs), [granted, isSuperAdmin]),
    actionsOn: useCallback((resource) => actionsOn(granted, resource), [granted]),

    hasScopeAtLeast: useCallback(
      (minimum) =>
        isSuperAdmin || (SCOPE_RANK[user?.scope] ?? 0) >= (SCOPE_RANK[minimum] ?? Number.MAX_SAFE_INTEGER),
      [user?.scope, isSuperAdmin],
    ),
  };
};

export default usePermissions;
