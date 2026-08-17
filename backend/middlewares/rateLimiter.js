import rateLimit from 'express-rate-limit';
import env from '../config/env.js';
import ApiError from '../utils/ApiError.js';

const base = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, _res, next) => next(ApiError.tooManyRequests()),
};

/**
 * Broad ceiling applied to the whole API surface.
 *
 * Skipped in development. A screen here is not one request -- the dashboard
 * alone fans out to masters, employees, runs, loans, settlements and holidays
 * on every mount -- so a normal session plus a few HMR reloads burns a budget
 * sized for one-request-per-action traffic, and the whole app starts answering
 * 429 including the login it needs to recover. Throttling a single developer
 * hitting their own laptop protects nothing; the limiter is a production
 * control and stays fully armed there.
 */
export const apiLimiter = rateLimit({
  ...base,
  windowMs: env.rateLimit.windowMs,
  limit: env.rateLimit.max,
  skip: () => env.nodeEnv === 'development',
});

/**
 * Tighter budget for credential endpoints. Mounted on auth routes so password
 * guessing is throttled independently of ordinary API traffic.
 */
export const authLimiter = rateLimit({
  ...base,
  windowMs: env.auth.authRateLimitWindowMs,
  limit: env.auth.authRateLimitMax,
  // Only failures count, so a user signing in normally is never throttled
  // while a password-guessing run exhausts its budget quickly.
  skipSuccessfulRequests: true,
});

export default apiLimiter;
