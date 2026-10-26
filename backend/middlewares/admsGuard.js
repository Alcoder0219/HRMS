import crypto from 'node:crypto';
import net from 'node:net';
import rateLimit from 'express-rate-limit';

import env from '../config/env.js';
import logger from '../config/logger.js';
import { isValidSerial } from '../helpers/adms.helper.js';

/**
 * The checks every `/iclock` request passes before it reaches the receiver.
 *
 * ADMS has no authentication of its own -- a terminal identifies itself by a
 * serial number printed on its own screen, over plain HTTP. These guards are
 * what stop the receiver being "an unauthenticated endpoint that writes
 * attendance for anyone who can guess a serial":
 *
 *   1. off unless ADMS_ENABLED;
 *   2. in production, refuses to serve at all unless a gateway token or an IP
 *      allowlist is configured (or the operator has explicitly waived it);
 *   3. the gateway token, when set, is mandatory;
 *   4. the source address, when an allowlist is set, must be on it;
 *   5. a per-address rate limit;
 *   6. a well-formed serial -- which the receiver then requires to be
 *      registered and active.
 *
 * Replies are plain text, because that is all a terminal can read.
 */

const reply = (res, status, text) => res.status(status).type('text/plain').send(text);

/* -------------------------------------------------------------------------- */
/*                               Client address                               */
/* -------------------------------------------------------------------------- */

const normalise = (address) => String(address ?? '').trim().replace(/^::ffff:/i, '');

/**
 * The terminal's address, counted in from the right of X-Forwarded-For.
 *
 * Not `req.ip`: that follows TRUST_PROXY, which is set for the BROWSER's path
 * (Cloud Run plus the frontend nginx, two hops), while a terminal or gateway
 * calls the API directly through one. Reading it with the browser's hop count
 * would take an address the client wrote itself, and an allowlist checked
 * against that is no allowlist at all.
 *
 * Counting from the right means a forged header only ever adds entries to the
 * LEFT, which are never read. If the chain is shorter than expected the result
 * is the proxy's own address, which fails the allowlist -- the safe direction.
 */
export const admsClientIp = (req, hops = env.adms.proxyHops) => {
  const forwarded = String(req.headers['x-forwarded-for'] ?? '')
    .split(',')
    .map(normalise)
    .filter(Boolean);
  const chain = [...forwarded, normalise(req.socket?.remoteAddress)];
  return chain[Math.max(0, chain.length - 1 - hops)] ?? null;
};

/* -------------------------------------------------------------------------- */
/*                                 Allowlist                                  */
/* -------------------------------------------------------------------------- */

const ipv4ToInt = (address) => address.split('.').reduce((total, octet) => total * 256 + Number(octet), 0);

/** An exact address, or an IPv4 CIDR range. */
export const ipMatches = (address, rule) => {
  const ip = normalise(address);
  const [range, bitsText] = String(rule).trim().split('/');

  if (bitsText === undefined) return ip === normalise(range);
  if (!net.isIPv4(ip) || !net.isIPv4(range)) return false;

  const bits = Number(bitsText);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  // Arithmetic rather than bitwise: JavaScript's bitwise operators are signed
  // 32-bit, which mangles every address above 128.0.0.0.
  const block = 2 ** (32 - bits);
  return Math.floor(ipv4ToInt(ip) / block) === Math.floor(ipv4ToInt(range) / block);
};

const tokensEqual = (given, expected) => {
  const a = Buffer.from(String(given ?? ''));
  const b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

/* -------------------------------------------------------------------------- */
/*                                   Guards                                   */
/* -------------------------------------------------------------------------- */

/** How the receiver is protected, for the status endpoint and the boot log. */
export const admsSecurityMode = () => {
  const { gatewayToken, allowedIps, allowSerialOnly } = env.adms;

  if (gatewayToken && allowedIps.length) return 'GATEWAY_TOKEN_AND_IP_ALLOWLIST';
  if (gatewayToken) return 'GATEWAY_TOKEN';
  if (allowedIps.length) return 'IP_ALLOWLIST';
  if (allowSerialOnly || !env.isProduction) return 'SERIAL_ONLY';
  return 'MISCONFIGURED';
};

let misconfigurationLogged = false;

export const admsEnabled = (_req, res, next) => {
  // A 404, not a 403: with the feature off, the path does not exist.
  if (!env.adms.enabled) return reply(res, 404, 'Not Found');

  if (admsSecurityMode() === 'MISCONFIGURED') {
    if (!misconfigurationLogged) {
      logger.error(
        'ADMS receiver is enabled in production without ADMS_GATEWAY_TOKEN or ADMS_ALLOWED_IPS; refusing all device requests',
      );
      misconfigurationLogged = true;
    }
    return reply(res, 503, 'RECEIVER NOT CONFIGURED');
  }

  return next();
};

export const admsNetworkGuard = (req, res, next) => {
  const ip = admsClientIp(req);
  req.admsClientIp = ip;

  if (env.adms.gatewayToken && !tokensEqual(req.get('x-adms-gateway-token'), env.adms.gatewayToken)) {
    logger.warn('ADMS request rejected: missing or wrong gateway token', { ip, path: req.path });
    return reply(res, 401, 'UNAUTHORIZED');
  }

  if (env.adms.allowedIps.length && !env.adms.allowedIps.some((rule) => ipMatches(ip, rule))) {
    logger.warn('ADMS request rejected: address not on the allowlist', { ip, path: req.path });
    return reply(res, 403, 'FORBIDDEN');
  }

  return next();
};

/**
 * Generous for one terminal, which polls every `Delay` seconds and uploads in
 * bursts, and tight enough that a script hammering the endpoint is cut off.
 * Keyed by the guarded address, not `req.ip`, for the reason above.
 */
export const admsRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: () => env.adms.rateLimitPerMinute,
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: (req) => req.admsClientIp ?? admsClientIp(req) ?? 'unknown',
  handler: (_req, res) => reply(res, 429, 'TOO MANY REQUESTS'),
  // Our own key generator is not `req.ip`; the IPv6 subnet check does not apply.
  validate: { keyGeneratorIpFallback: false, trustProxy: false, xForwardedForHeader: false },
});

export const requireSerial = (req, res, next) => {
  const serial = String(req.query.SN ?? req.query.sn ?? '').trim().toUpperCase();

  if (!isValidSerial(serial)) return reply(res, 400, 'INVALID SN');

  req.admsSerial = serial;
  return next();
};

export default { admsEnabled, admsNetworkGuard, admsRateLimiter, requireSerial, admsClientIp, ipMatches, admsSecurityMode };
