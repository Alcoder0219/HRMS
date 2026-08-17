import { Navigate, Outlet } from 'react-router-dom';
import usePermissions from '@hooks/usePermissions.js';
import { PATHS } from '../paths.js';

/**
 * Permission gate for a route branch. Mount inside RequireAuth, which has
 * already established that a user exists.
 *
 *   { element: <RequirePermission resource={RESOURCES.PAYROLL} action={ACTIONS.READ} />,
 *     children: [{ path: 'payroll', element: <PayrollPage /> }] }
 *
 *   { element: <RequirePermission any={[[RESOURCES.LEAVE, ACTIONS.APPROVE],
 *                                      [RESOURCES.LEAVE, ACTIONS.REJECT]]} /> }
 *
 * Prefer this over a role list: a route pinned to roles has to be edited every
 * time the org chart grows a new title, whereas a permission check keeps
 * working.
 */
const RequirePermission = ({
  resource,
  action,
  any = null,
  all = null,
  redirectTo = PATHS.errors.forbidden,
}) => {
  const { can, canAny, canAll } = usePermissions();

  let permitted = false;
  if (any) permitted = canAny(any);
  else if (all) permitted = canAll(all);
  else if (resource && action) permitted = can(resource, action);

  return permitted ? <Outlet /> : <Navigate to={redirectTo} replace />;
};

export default RequirePermission;
