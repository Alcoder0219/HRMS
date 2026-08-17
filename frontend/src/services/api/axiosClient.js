import axios from 'axios';
import { getAccessToken, setAccessToken, clearAccessToken } from '@utils/storage.js';

export const HTTP_STATUS = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  UNPROCESSABLE: 422,
  TOO_MANY_REQUESTS: 429,
};

/** Mirrors backend/utils/constants.js -- the interceptor branches on these. */
export const AUTH_ERROR_CODES = {
  TOKEN_EXPIRED: 'AUTH_TOKEN_EXPIRED',
  TOKEN_INVALID: 'AUTH_TOKEN_INVALID',
  TOKEN_REUSED: 'AUTH_TOKEN_REUSED',
  SESSION_EXPIRED: 'AUTH_SESSION_EXPIRED',
  PASSWORD_CHANGED: 'AUTH_PASSWORD_CHANGED',
};

/**
 * API base URL, from the environment -- never hardcoded.
 *
 * A RELATIVE value (the default, `/api/v1`) is resolved by the browser against
 * whatever origin the app was opened from. Open the app at
 * http://192.168.1.3:5173 and the calls go to that same host, proxied to the
 * API by Vite: no CORS preflight, no mixed content, and nothing to change when
 * the server's IP changes.
 *
 * An ABSOLUTE value (e.g. http://192.168.1.3:5000/api/v1) makes the browser
 * call the API directly. Supported, and the backend allows private-network
 * origins for it, but the address is then fixed for every client.
 *
 * `VITE_API_BASE_URL` is still read so an existing local override keeps
 * working; `VITE_API_URL` is the documented name.
 */
export const API_BASE_URL =
  import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE_URL || '/api/v1';

const axiosClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: Number(import.meta.env.VITE_API_TIMEOUT) || 30_000,
  // Required for the httpOnly refresh cookie to travel with /auth calls. With
  // an absolute base URL this also forces a CORS preflight, which the backend
  // answers with an explicit origin -- a wildcard is illegal with credentials.
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

/* --------------------------------------------------- session expiry hook */

let onSessionExpired = null;

/**
 * Lets Redux react to a terminal auth failure without this module importing
 * the store -- which would create a cycle, since the store's thunks import
 * this client.
 */
export const setSessionExpiredHandler = (handler) => {
  onSessionExpired = handler;
};

const expireSession = (reason) => {
  clearAccessToken();
  onSessionExpired?.(reason);
};

/* --------------------------------------------------------------- request */

axiosClient.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;

  // Let the browser set the multipart boundary itself; a hard-coded JSON
  // content type here is the usual cause of broken file uploads.
  if (config.data instanceof FormData) delete config.headers['Content-Type'];

  return config;
});

/* ------------------------------------------------------- silent refresh */

/**
 * A bare axios instance for the refresh call itself. Using the main client
 * would re-enter these interceptors and, on a failing refresh, recurse.
 */
const refreshClient = axios.create({ baseURL: API_BASE_URL, withCredentials: true });

let refreshPromise = null;
let waiters = [];

/**
 * Collapses concurrent refreshes into one request. When five calls 401 at the
 * same moment, only the first refreshes; the rest queue and are replayed with
 * the new token. Without this, each one would rotate the refresh token and the
 * losers would trip the backend's reuse detection -- signing the user out.
 */
const refreshAccessToken = () => {
  if (refreshPromise) return refreshPromise;

  refreshPromise = refreshClient
    .post('/auth/refresh')
    .then((response) => {
      const token = response.data?.data?.accessToken;
      if (!token) throw new Error('No access token in refresh response');

      setAccessToken(token);
      waiters.forEach(({ resolve }) => resolve(token));
      return token;
    })
    .catch((error) => {
      waiters.forEach(({ reject }) => reject(error));
      expireSession('REFRESH_FAILED');
      throw error;
    })
    .finally(() => {
      refreshPromise = null;
      waiters = [];
    });

  return refreshPromise;
};

/** Endpoints that must never trigger a refresh attempt. */
const isAuthBootstrapCall = (url = '') =>
  ['/auth/login', '/auth/refresh', '/auth/register', '/auth/forgot-password', '/auth/reset-password'].some(
    (path) => url.includes(path),
  );

/* -------------------------------------------------------------- response */

axiosClient.interceptors.response.use(
  // Unwrap the backend's { success, data, meta } envelope once, centrally, so
  // no caller has to reach through `response.data.data`.
  (response) => response.data,

  async (error) => {
    const original = error.config ?? {};

    if (error.response) {
      const { status, data } = error.response;

      if (status === HTTP_STATUS.UNAUTHORIZED && !isAuthBootstrapCall(original.url)) {
        // Terminal: refreshing cannot fix a revoked session or a password
        // change, so end it immediately rather than burn a round trip.
        if (
          data?.code === AUTH_ERROR_CODES.TOKEN_REUSED ||
          data?.code === AUTH_ERROR_CODES.PASSWORD_CHANGED ||
          data?.code === AUTH_ERROR_CODES.SESSION_EXPIRED
        ) {
          expireSession(data.code);
        } else if (!original.__isRetry) {
          // Retried exactly once; a second 401 means the new token is not the
          // problem and the session is genuinely over.
          original.__isRetry = true;
          try {
            await refreshAccessToken();
            return await axiosClient(original);
          } catch {
            // Fall through to the normalized rejection below.
          }
        }
      }

      return Promise.reject({
        status,
        message: data?.message || 'Request failed',
        details: data?.details ?? null,
        code: data?.code ?? null,
      });
    }

    if (error.code === 'ECONNABORTED') {
      return Promise.reject({ status: 0, message: 'Request timed out', details: null });
    }

    return Promise.reject({
      status: 0,
      message: 'Network error - unable to reach the server',
      details: null,
    });
  },
);

export default axiosClient;
