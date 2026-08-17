import { Navigate, Outlet } from 'react-router-dom';
import usePermissions from '@hooks/usePermissions.js';
import { PATHS } from '../paths.js';

/**
 * Data-reach gate for a route branch. Mount inside RequireAuth.
 *
 *   { element: <RequireScope minimum={SCOPES.TENANT} />, children: [...] }
 *
 * Scope is orthogonal to permission, and some endpoints need both. `payroll:read`
 * is held by every employee so they can open their own payslip, which makes the
 * action alone far too coarse for a salary register: the API answers those with
 * `requireScope(TENANT)` on top of the permission. Without the same check here,
 * a SELF-scoped employee is shown a menu entry that can only ever 403.
 *
 * Presentation only, like the other guards -- the API enforces the same rule,
 * and that is the check that matters.
 */
const RequireScope = ({ minimum, redirectTo = PATHS.errors.forbidden }) => {
  const { hasScopeAtLeast } = usePermissions();

  return hasScopeAtLeast(minimum) ? <Outlet /> : <Navigate to={redirectTo} replace />;
};

export default RequireScope;
