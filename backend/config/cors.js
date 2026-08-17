import env from './env.js';
import logger from './logger.js';

/**
 * Private-network address ranges (RFC 1918) plus loopback.
 *
 * Used to recognise a LAN workstation by its address rather than requiring
 * every machine to be listed by hand. Deliberately narrow: a public address
 * never matches, so this cannot silently open the API to the internet.
 */
const PRIVATE_HOST = /^(?:localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|\[::1\])$/;

const isPrivateOrigin = (origin) => {
  try {
    const { hostname, protocol } = new URL(origin);
    // http only. A private address served over https would be a misconfigured
    // certificate, and matching it here would hide that.
    if (protocol !== 'http:' && protocol !== 'https:') return false;
    return PRIVATE_HOST.test(hostname);
  } catch {
    return false;
  }
};

/**
 * Allowlist-based CORS with a LAN escape hatch for development.
 *
 * Credentials are enabled so refresh tokens can travel in httpOnly cookies,
 * and that makes a wildcard origin both illegal and unsafe -- the browser
 * rejects `*` alongside credentials. Every allowed origin is therefore
 * reflected explicitly.
 */
export const corsOptions = {
  origin(origin, callback) {
    // Same-origin, curl and server-to-server calls send no Origin header.
    if (!origin) return callback(null, true);

    if (env.corsOrigins.includes(origin)) return callback(null, true);

    if (env.corsAllowLan && isPrivateOrigin(origin)) {
      // Logged rather than silent: in production this branch is off, so any
      // appearance of it in production logs is itself the alarm.
      logger.debug?.('CORS: allowing private-network origin', { origin });
      return callback(null, true);
    }

    logger.warn('CORS: origin rejected', { origin, allowed: env.corsOrigins });
    return callback(new Error(`Origin ${origin} is not allowed by CORS`), false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-Id', 'X-Requested-With'],
  // Exposed so the browser can read them on cross-origin responses -- without
  // this the client cannot see paging counts or the bank-file row totals.
  exposedHeaders: [
    'X-Total-Count',
    'X-Request-Id',
    'X-Skipped-Count',
    'X-Total-Amount',
    'Content-Disposition',
  ],
  maxAge: 86_400,
};

export default corsOptions;
