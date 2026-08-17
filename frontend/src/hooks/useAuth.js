import { useCallback } from 'react';
import { useAppDispatch, useAppSelector } from './useRedux.js';
import {
  login as loginThunk,
  logout as logoutThunk,
  logoutAll as logoutAllThunk,
  clearAuthError,
  selectAuth,
} from '@redux/slices/authSlice.js';
import { ROLE_RANK } from '@utils/roles.js';

/**
 * The single entry point components use for auth. Keeping the thunk names and
 * store shape behind this hook means a change to either does not ripple
 * through every screen.
 */
const useAuth = () => {
  const dispatch = useAppDispatch();
  const { user, isAuthenticated, bootstrapped, status, error } = useAppSelector(selectAuth);

  const signIn = useCallback((credentials) => dispatch(loginThunk(credentials)).unwrap(), [dispatch]);
  const signOut = useCallback(() => dispatch(logoutThunk()).unwrap(), [dispatch]);
  const signOutEverywhere = useCallback(() => dispatch(logoutAllThunk()).unwrap(), [dispatch]);
  const resetError = useCallback(() => dispatch(clearAuthError()), [dispatch]);

  /** Exact role match against any of the supplied roles. */
  const hasRole = useCallback(
    (...roles) => Boolean(user?.role && roles.flat().includes(user.role)),
    [user],
  );

  /** Rank check -- "this role or more senior". Mirrors the backend's ROLE_RANK. */
  const hasMinimumRole = useCallback(
    (role) => (ROLE_RANK[user?.role] ?? 0) >= (ROLE_RANK[role] ?? Number.MAX_SAFE_INTEGER),
    [user],
  );

  return {
    user,
    role: user?.role ?? null,
    roleLabel: user?.roleLabel ?? null,
    scope: user?.scope ?? null,
    isAuthenticated,
    bootstrapped,
    isLoading: status === 'loading',
    error,
    signIn,
    signOut,
    signOutEverywhere,
    resetError,
    hasRole,
    hasMinimumRole,
  };
};

export default useAuth;
