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

  /**
   * 8080 is the default because that is what Cloud Run, and container
   * platforms generally, inject as PORT and then probe. A real PORT in the
   * environment always wins -- dotenv does not override an existing variable
   * -- so a local `.env` saying 5000 still gets 5000.
   */
  port: readInt('PORT', 8080),
  /**
   * Bind address. `0.0.0.0` listens on every interface, which is what makes
   * the API reachable from other machines on the LAN -- binding to localhost
   * accepts connections only from the server itself, which is the single most
   * common reason "it works on my machine but nowhere else".
   */
  host: read('HOST', '0.0.0.0'),
  apiPrefix: read('API_PREFIX', '/api/v1'),

  /**
   * How many reverse proxies sit in front, for Express's `trust proxy`.
   *
   * This decides which entry of X-Forwarded-For becomes `req.ip`, and `req.ip`
   * is the key the rate limiter buckets by. Get it too low and every request
   * appears to come from the proxy's address -- one shared bucket, so the
   * global ceiling is consumed by all users together and the API starts
   * 429-ing everyone at once. Too high and a client can spoof its own address
   * by sending the header, evading the limiter entirely.
   *
   * 1 is right for a single nginx or a direct Cloud Run service. Two hops --
   * Cloud Run's own frontend plus an nginx service in front of it -- want 2.
   * Configurable because it is a property of the deployment, not of the code.
   */
  trustProxy: readInt('TRUST_PROXY', 1),

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

  /**
   * The CORS allowlist: whatever CORS_ORIGINS lists, plus CLIENT_URL.
   *
   * CLIENT_URL is folded in because it is already the trusted web origin --
   * it is the address put into verification and password-reset emails. Having
   * to name the same URL twice is a misconfiguration waiting to happen, and
   * the failure it produces (CORS rejections on a correctly deployed
   * frontend) is an obscure one to debug.
   *
   * The origin of a URL never carries a trailing slash, so `CLIENT_URL` is
   * trimmed before comparison -- `https://app.example.com/` would otherwise
   * never match the `https://app.example.com` a browser actually sends.
   */
  corsOrigins: [
    ...new Set([
      ...readList('CORS_ORIGINS', 'http://localhost:5173'),
      read('CLIENT_URL', 'http://localhost:5173').replace(/\/+$/, ''),
    ]),
  ],

  /**
   * Accept any private-network origin. A development affordance so every
   * workstation on the LAN works without its address being listed one by one.
   *
   * Hard-off in production rather than merely defaulting off, which is what
   * the comment here always claimed. A `.env` copied from a LAN install
   * carries `CORS_ALLOW_LAN=true`, and that one stale line would let any
   * origin resolving to a private address through on a public deployment.
   */
  corsAllowLan: !isProduction && readBool('CORS_ALLOW_LAN', true),

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
   *
   * `resolve` rather than `join`, here and for uploads and logs below, so an
   * ABSOLUTE path in the environment is taken as given instead of being glued
   * onto the project root. That is what lets a container point this at a
   * mounted volume (`/mnt/employee-docs`) without the code knowing.
   */
  attachments: {
    dir: path.resolve(PROJECT_ROOT, read('ATTACHMENTS_DIR', 'attachments')),
    maxImageBytes: readInt('MAX_ATTACHMENT_IMAGE_MB', 2) * 1024 * 1024,
    maxPdfBytes: readInt('MAX_ATTACHMENT_PDF_MB', 10) * 1024 * 1024,
  },

  upload: {
    dir: path.resolve(ROOT_DIR, read('UPLOAD_DIR', 'uploads')),
    maxSizeBytes: readInt('MAX_UPLOAD_SIZE_MB', 10) * 1024 * 1024,
  },

  log: {
    level: read('LOG_LEVEL', isProduction ? 'info' : 'debug'),
    dir: path.resolve(ROOT_DIR, read('LOG_DIR', 'logs')),
    /**
     * Rotating log FILES on disk. Correct on a server with a real filesystem,
     * pointless on Cloud Run: the container disk is in-memory and discarded
     * with the instance, so a 90-day retention there costs RAM and keeps
     * nothing. Set LOG_TO_FILE=false on Cloud Run and read the logs from Cloud
     * Logging, which collects stdout.
     */
    toFile: readBool('LOG_TO_FILE', true),
  },
};

export default env;
