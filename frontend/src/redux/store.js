import { configureStore } from '@reduxjs/toolkit';
import rootReducer from './rootReducer.js';
import { setSessionExpiredHandler } from '@services/api/axiosClient.js';
import { sessionExpired } from './slices/authSlice.js';

const isDev = import.meta.env.DEV;

export const store = configureStore({
  reducer: rootReducer,

  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      // The serializability check is what stops Dates, class instances and File
      // objects from silently entering the store and breaking time-travel
      // debugging and persistence. It is intentionally left on.
      serializableCheck: true,
      immutableCheck: isDev,
    }),
  // Custom middleware from redux/middleware/ is appended with .concat() here.

  devTools: isDev,
});

/**
 * Wired after the store exists, not by importing the store into the axios
 * client -- that direction would be a cycle, since the auth thunks import the
 * client. This is how a failed token refresh reaches Redux.
 */
setSessionExpiredHandler((reason) => store.dispatch(sessionExpired(reason)));

export default store;
