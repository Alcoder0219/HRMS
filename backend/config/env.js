import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(__dirname, '..');

/**
 * The repository root -- one level above the backend.
 *
 * Employee attachments live here rather than under the backend, so the files
 * survive a redeploy of the API and are never inside the directory Express
 * serves statically.
 */
export const PROJECT_ROOT = path.resolve(ROOT_DIR, '..');

dotenv.config({ path: path.join(ROOT_DIR, '.env'), quiet: true });

/**
 * Reads a variable, falling back to `fallback`. When no fallback is given the
 * variable is mandatory and a missing value fails the boot immediately -- a
 * misconfigured server should never reach the "listening" state.
 */
const read = (key, fallback) => {
  const value = process.env[key];
  if (value !== undefined && value !== '') return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`[config] Missing required environment variable: ${key}`);
};

const readInt = (key, fallback) => {
  const value = Number(read(key, fallback));
  if (!Number.isFinite(value)) {
    throw new Error(`[config] Environment variable ${key} must be a number`);
  }
  return value;
};

const readBool = (key, fallback) => {
  const value = read(key, String(fallback));
  return value === 'true' || value === '1';
};

const readList = (key, fallback) =>
  read(key, fallback)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const nodeEnv = read('NODE_ENV', 'development');
const isProduction = nodeEnv === 'production';

export const env = {
  nodeEnv,
  isProduction,
  isDevelopment: nodeEnv === 'development',
  isTest: nodeEnv === 'test',

  port: readInt('PORT', 5000),
  /**
   * Bind address. `0.0.0.0` listens on every interface, which is what makes
   * the API reachable from other machines on the LAN -- binding to localhost
   * accepts connections only from the server itself, which is the single most
   * common reason "it works on my machine but nowhere else".
   */
  host: read('HOST', '0.0.0.0'),
  apiPrefix: read('API_PREFIX', '/api/v1'),

  mongoUri: read('MONGODB_URI'),

  clientUrl: read('CLIENT_URL', 'http://localhost:5173'),

  jwt: {
    // Secrets are mandatory in every environment; a default would be a
    // production vulnerability waiting for someone to forget an override.
    accessSecret: read('JWT_ACCESS_SECRET'),
    refreshSecret: read('JWT_REFRESH_SECRET'),
    accessExpiresIn: read('JWT_ACCESS_EXPIRES_IN', '15m'),
    refreshExpiresIn: read('JWT_REFRESH_EXPIRES_IN', '7d'),
    // "Remember me" trades a longer-lived session for convenience; it only
    // extends the refresh token, never the access token.
    rememberMeExpiresIn: read('JWT_REMEMBER_ME_EXPIRES_IN', '30d'),
    issuer: read('JWT_ISSUER', 'hrms-api'),
    audience: read('JWT_AUDIENCE', 'hrms-client'),
  },

  bcryptSaltRounds: readInt('BCRYPT_SALT_ROUNDS', 12),

  auth: {
    maxLoginAttempts: readInt('MAX_LOGIN_ATTEMPTS', 5),
    lockMinutes: readInt('ACCOUNT_LOCK_MINUTES', 15),
    emailVerificationExpiryHours: readInt('EMAIL_VERIFICATION_EXPIRY_HOURS', 24),
    passwordResetExpiryMinutes: readInt('PASSWORD_RESET_EXPIRY_MINUTES', 15),
    // Blocking unverified logins is the default; relaxable for pilots and
    // seeded environments where mail delivery is not wired up.
    requireEmailVerification: readBool('REQUIRE_EMAIL_VERIFICATION', true),
    maxActiveSessions: readInt('MAX_ACTIVE_SESSIONS', 5),
    // Per-IP ceiling on credential endpoints, separate from the global API
    // limit. Configurable so integration suites can raise it deliberately.
    authRateLimitMax: readInt('AUTH_RATE_LIMIT_MAX', 10),
    authRateLimitWindowMs: readInt('AUTH_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
    passwordHistorySize: readInt('PASSWORD_HISTORY_SIZE', 3),
  },

  cookie: {
    // Secure defaults to on in production; SameSite=None is only valid
    // alongside Secure, which the cookie helper enforces.
    secure: readBool('COOKIE_SECURE', isProduction),
    sameSite: read('COOKIE_SAME_SITE', isProduction ? 'none' : 'lax'),
    domain: process.env.COOKIE_DOMAIN || undefined,
  },

  mail: {
    host: process.env.SMTP_HOST || '',
    port: readInt('SMTP_PORT', 587),
    secure: readBool('SMTP_SECURE', false),
    user: process.env.SMTP_USER || '',
    password: process.env.SMTP_PASSWORD || '',
    from: read('MAIL_FROM', 'HRMS <no-reply@hrms.local>'),
  },

  corsOrigins: readList('CORS_ORIGINS', 'http://localhost:5173'),
  /**
   * Accept any private-network origin. A development affordance so every
   * workstation on the LAN works without its address being listed one by one;
   * forced off in production, where origins must be explicit.
   */
  corsAllowLan: readBool('CORS_ALLOW_LAN', !isProduction),

  /**
   * Per-IP ceiling for the whole API.
   *
   * 1000 per 15 minutes, not 300: one screen in this app is a fan-out of ten
   * or more calls, so 300 is only about thirty page loads and an ordinary
   * afternoon of payroll work trips it. Still a real ceiling -- roughly one
   * request a second sustained -- and still the wrong tool against a single
   * abusive account, which is what the per-route and per-account throttles
   * are for.
   */
  rateLimit: {
    windowMs: readInt('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
    max: readInt('RATE_LIMIT_MAX', 1000),
  },

  /**
   * Employee attachments: one folder per employee, outside the static mount.
   *
   * Deliberately not under `upload.dir`. That directory is served by
   * `express.static` with no authentication, which is acceptable for avatars
   * and unacceptable for the identity documents kept here -- a PAN or passport
   * scan must not be readable by anyone who learns its URL.
   */
  attachments: {
    dir: path.join(PROJECT_ROOT, read('ATTACHMENTS_DIR', 'attachments')),
    maxImageBytes: readInt('MAX_ATTACHMENT_IMAGE_MB', 2) * 1024 * 1024,
    maxPdfBytes: readInt('MAX_ATTACHMENT_PDF_MB', 10) * 1024 * 1024,
  },

  upload: {
    dir: path.join(ROOT_DIR, read('UPLOAD_DIR', 'uploads')),
    maxSizeBytes: readInt('MAX_UPLOAD_SIZE_MB', 10) * 1024 * 1024,
  },

  log: {
    level: read('LOG_LEVEL', isProduction ? 'info' : 'debug'),
    dir: path.join(ROOT_DIR, read('LOG_DIR', 'logs')),
  },
};

export default env;
