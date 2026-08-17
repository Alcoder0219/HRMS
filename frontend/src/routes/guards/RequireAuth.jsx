import { Navigate, Outlet, useLocation } from 'react-router-dom';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import useAuth from '@hooks/useAuth.js';
import { PATHS } from '../paths.js';

/**
 * Blocks a route branch until the session is known.
 *
 * Waiting on `bootstrapped` is the whole point: on a page reload the access
 * token is gone and the refresh cookie has not been exchanged yet. Treating
 * that instant as "signed out" is what bounces an authenticated user to the
 * login screen on every refresh.
 */
const RequireAuth = () => {
  const { isAuthenticated, bootstrapped, user } = useAuth();
  const location = useLocation();

  if (!bootstrapped) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!isAuthenticated) {
    // `state.from` lets the login screen return the user where they were
    // headed instead of dumping them on the dashboard.
    return <Navigate to={PATHS.auth.login} state={{ from: location }} replace />;
  }

  /**
   * An account on a temporary password can reach exactly one screen.
   *
   * The API refuses every route but `/auth/*` while `mustChangePassword` is
   * set, so letting the user navigate anywhere else just produces a 403 on
   * whatever they opened. Redirecting is what turns a dead end into a step.
   */
  if (user?.mustChangePassword && location.pathname !== PATHS.changePassword) {
    return <Navigate to={PATHS.changePassword} replace />;
  }

  return <Outlet />;
};

export default RequireAuth;
