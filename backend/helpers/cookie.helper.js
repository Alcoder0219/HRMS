import env from '../config/env.js';
import { COOKIE_NAMES } from '../utils/constants.js';
import { durationToMs } from './token.helper.js';

/**
 * SameSite=None is only honoured by browsers when Secure is also set. Rather
 * than let a misconfigured .env silently produce cookies the browser drops,
 * the combination is corrected here and the cookie stays functional.
 */
const resolveSameSite = () => {
  const sameSite = String(env.cookie.sameSite).toLowerCase();
  if (sameSite === 'none' && !env.cookie.secure) return 'lax';
  return sameSite;
};

const baseOptions = () => ({
  httpOnly: true, // Unreachable from JavaScript, so XSS cannot exfiltrate it
  secure: env.cookie.secure,
  sameSite: resolveSameSite(),
  domain: env.cookie.domain,
  // Scoped to the auth routes: the browser will not attach the refresh token
  // to ordinary API calls, which shrinks its exposure to the two endpoints
  // that actually need it.
  path: `${env.apiPrefix}/auth`,
});

/**
 * `rememberMe` decides persistence, not just lifetime. Without it the cookie
 * is a session cookie and dies with the browser -- the correct behaviour on a
 * shared or kiosk machine.
 */
export const setRefreshCookie = (res, token, { rememberMe = false } = {}) => {
  const options = baseOptions();

  if (rememberMe) {
    options.maxAge = durationToMs(env.jwt.rememberMeExpiresIn);
  }

  res.cookie(COOKIE_NAMES.REFRESH_TOKEN, token, options);
};

/**
 * Clearing must repeat the exact path/domain/sameSite the cookie was set with;
 * a mismatch leaves the original cookie alive in the browser.
 */
export const clearRefreshCookie = (res) => {
  const { maxAge, ...options } = baseOptions();
  res.clearCookie(COOKIE_NAMES.REFRESH_TOKEN, options);
};

export const readRefreshCookie = (req) => req.cookies?.[COOKIE_NAMES.REFRESH_TOKEN] || null;
