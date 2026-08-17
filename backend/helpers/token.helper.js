import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import env from '../config/env.js';

const BASE_CLAIMS = {
  issuer: env.jwt.issuer,
  audience: env.jwt.audience,
};

/* ------------------------------------------------------------ access token */

/**
 * Short-lived bearer token. Deliberately carries only what authorisation needs
 * -- id, tenant, role -- so a leaked token exposes no profile data and stays
 * small enough for a header on every request.
 */
export const signAccessToken = ({ userId, tenantId, role }) =>
  jwt.sign(
    {
      sub: String(userId),
      tenantId: tenantId ? String(tenantId) : null,
      role,
      type: 'access',
      // Standard `iat` is whole seconds. That granularity is too coarse to
      // decide whether this token predates a password change that happened in
      // the same second, so the exact issue instant is carried alongside it.
      iatMs: Date.now(),
    },
    env.jwt.accessSecret,
    { ...BASE_CLAIMS, expiresIn: env.jwt.accessExpiresIn },
  );

export const verifyAccessToken = (token) =>
  jwt.verify(token, env.jwt.accessSecret, BASE_CLAIMS);

/* ----------------------------------------------------------- refresh token */

/**
 * Long-lived rotation token. The `jti` is what ties the JWT to its database
 * row, which is what makes server-side revocation (logout, reuse detection)
 * possible at all -- a stateless refresh token cannot be invalidated.
 */
export const signRefreshToken = ({ userId, sessionId, expiresIn }) =>
  jwt.sign({ sub: String(userId), type: 'refresh' }, env.jwt.refreshSecret, {
    ...BASE_CLAIMS,
    jwtid: String(sessionId),
    expiresIn,
  });

export const verifyRefreshToken = (token) =>
  jwt.verify(token, env.jwt.refreshSecret, BASE_CLAIMS);

/** Decodes without verifying. Only for reading a claim off an expired token. */
export const decodeToken = (token) => jwt.decode(token);

/* ------------------------------------------------- one-time opaque tokens */

/**
 * Email-verification and password-reset tokens. The raw value goes in the
 * email; only its SHA-256 digest is stored, so a database leak cannot be
 * replayed to take over accounts. SHA-256 (not bcrypt) is correct here: the
 * token is already 256 bits of entropy, so there is nothing to brute-force and
 * lookups must stay fast.
 */
export const generateOpaqueToken = () => {
  const raw = crypto.randomBytes(32).toString('hex');
  return { raw, hash: hashOpaqueToken(raw) };
};

export const hashOpaqueToken = (raw) =>
  crypto.createHash('sha256').update(raw).digest('hex');

/** Constant-time comparison for any secret compared in application code. */
export const safeEqual = (a = '', b = '') => {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
};

/* ------------------------------------------------------------------ timing */

const DURATION_UNITS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/** Converts a JWT-style duration ("15m", "30d") to milliseconds. */
export const durationToMs = (duration) => {
  const match = /^(\d+)([smhd])$/.exec(String(duration).trim());
  if (!match) throw new Error(`Invalid duration format: ${duration}`);
  return Number(match[1]) * DURATION_UNITS[match[2]];
};

export const expiresAtFrom = (duration) => new Date(Date.now() + durationToMs(duration));
