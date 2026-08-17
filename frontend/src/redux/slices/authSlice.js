import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import authService from '@services/modules/auth.service.js';
import { getAccessToken, setAccessToken, clearAccessToken } from '@utils/storage.js';

const initialState = {
  user: null,
  accessToken: getAccessToken(),
  isAuthenticated: false,
  // `bootstrapped` gates the route guards. Until the boot refresh settles,
  // "no user" is unknown rather than "signed out" -- redirecting on that
  // difference is what bounces a signed-in user to the login page on reload.
  bootstrapped: false,
  status: 'idle',
  error: null,
};

/** Normalizes the axios client's rejection shape into a plain message + details. */
const asError = (error) => ({
  message: error?.message ?? 'Something went wrong',
  details: error?.details ?? null,
  code: error?.code ?? null,
});

/**
 * Runs once on app start. The access token is short-lived and not persisted
 * across a restart in any trustworthy way, so the httpOnly refresh cookie is
 * the source of truth for "is this browser still signed in".
 */
export const bootstrapSession = createAsyncThunk(
  'auth/bootstrap',
  async (_, { rejectWithValue }) => {
    try {
      const refreshed = await authService.refresh();
      setAccessToken(refreshed.data.accessToken);
      return refreshed.data;
    } catch (error) {
      clearAccessToken();
      return rejectWithValue(asError(error));
    }
  },
);

export const login = createAsyncThunk('auth/login', async (credentials, { rejectWithValue }) => {
  try {
    const response = await authService.login(credentials);
    setAccessToken(response.data.accessToken);
    return response.data;
  } catch (error) {
    return rejectWithValue(asError(error));
  }
});

export const fetchCurrentUser = createAsyncThunk('auth/me', async (_, { rejectWithValue }) => {
  try {
    const response = await authService.me();
    return response.data;
  } catch (error) {
    return rejectWithValue(asError(error));
  }
});

export const logout = createAsyncThunk('auth/logout', async () => {
  try {
    await authService.logout();
  } finally {
    // Local state is cleared even if the server call fails -- the user asked
    // to sign out, and a network error must not leave them looking signed in.
    clearAccessToken();
  }
});

export const logoutAll = createAsyncThunk('auth/logoutAll', async () => {
  try {
    await authService.logoutAll();
  } finally {
    clearAccessToken();
  }
});

const clearSession = (state) => {
  state.user = null;
  state.accessToken = null;
  state.isAuthenticated = false;
  state.status = 'idle';
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    /** Called by the axios interceptor when a refresh fails terminally. */
    sessionExpired(state, action) {
      clearSession(state);
      state.bootstrapped = true;
      state.error = action.payload ? { message: 'Your session has ended', code: action.payload } : null;
    },
    clearAuthError(state) {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(bootstrapSession.pending, (state) => {
        state.status = 'loading';
      })
      .addCase(bootstrapSession.fulfilled, (state, action) => {
        state.user = action.payload.user;
        state.accessToken = action.payload.accessToken;
        state.isAuthenticated = true;
        state.bootstrapped = true;
        state.status = 'succeeded';
      })
      .addCase(bootstrapSession.rejected, (state) => {
        // Not an error worth surfacing: "no valid cookie" is the normal state
        // for a first-time or signed-out visitor.
        clearSession(state);
        state.bootstrapped = true;
      })

      .addCase(login.pending, (state) => {
        state.status = 'loading';
        state.error = null;
      })
      .addCase(login.fulfilled, (state, action) => {
        state.user = action.payload.user;
        state.accessToken = action.payload.accessToken;
        state.isAuthenticated = true;
        state.bootstrapped = true;
        state.status = 'succeeded';
        state.error = null;
      })
      .addCase(login.rejected, (state, action) => {
        clearSession(state);
        state.status = 'failed';
        state.error = action.payload ?? { message: 'Sign in failed' };
      })

      .addCase(fetchCurrentUser.fulfilled, (state, action) => {
        state.user = action.payload;
        state.isAuthenticated = true;
      })

      .addMatcher(
        (action) => action.type === logout.fulfilled.type || action.type === logoutAll.fulfilled.type,
        (state) => {
          clearSession(state);
          state.bootstrapped = true;
          state.error = null;
        },
      );
  },
});

export const { sessionExpired, clearAuthError } = authSlice.actions;

export const selectAuth = (state) => state.auth;
export const selectCurrentUser = (state) => state.auth.user;
export const selectIsAuthenticated = (state) => state.auth.isAuthenticated;
export const selectAuthBootstrapped = (state) => state.auth.bootstrapped;
export const selectUserRole = (state) => state.auth.user?.role ?? null;

export default authSlice.reducer;
