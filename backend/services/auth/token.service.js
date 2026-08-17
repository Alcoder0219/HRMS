import crypto from 'node:crypto';
import env from '../../config/env.js';
import logger from '../../config/logger.js';
import ApiError from '../../utils/ApiError.js';
import { ERROR_CODES } from '../../utils/constants.js';
import refreshTokenRepository from '../../repositories/auth/refreshToken.repository.js';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashOpaqueToken,
  expiresAtFrom,
} from '../../helpers/token.helper.js';

/** Refresh lifetime is the only thing "remember me" changes. */
const refreshLifetime = (rememberMe) =>
  rememberMe ? env.jwt.rememberMeExpiresIn : env.jwt.refreshExpiresIn;

/**
 * Issues an access/refresh pair and persists the refresh session.
 *
 * `familyId` ties every rotation of one login together. A brand-new login
 * starts a family; a rotation inherits its parent's, which is what lets reuse
 * detection revoke the whole lineage later.
 */
export const issueTokenPair = async ({
  user,
  rememberMe = false,
  context = {},
  familyId = null,
}) => {
  const sessionId = crypto.randomUUID();
  const expiresIn = refreshLifetime(rememberMe);

  const accessToken = signAccessToken({
    userId: user._id,
    tenantId: user.tenantId,
    role: user.role,
  });

  const refreshToken = signRefreshToken({ userId: user._id, sessionId, expiresIn });

  await refreshTokenRepository.create({
    userId: user._id,
    tenantId: user.tenantId ?? null,
    tokenHash: hashOpaqueToken(refreshToken),
    familyId: familyId ?? sessionId,
    rememberMe,
    userAgent: context.userAgent ?? null,
    ip: context.ip ?? null,
    device: context.device ?? null,
    expiresAt: expiresAtFrom(expiresIn),
  });

  // Retire the oldest sessions rather than refusing the new login -- a user at
  // their device limit should still be able to sign in.
  const revoked = await refreshTokenRepository.revokeOldestBeyondLimit(
    user._id,
    env.auth.maxActiveSessions,
    'SESSION_LIMIT_EXCEEDED',
  );
  if (revoked) {
    logger.info('Retired oldest sessions over the concurrency limit', {
      userId: String(user._id),
      revoked,
    });
  }

  return { accessToken, refreshToken, expiresIn: env.jwt.accessExpiresIn };
};

/**
 * Validates a presented refresh token and rotates it.
 *
 * Rotation means a refresh token is strictly single-use. If a token that was
 * already rotated comes back, either it leaked or it was replayed -- and the
 * two are indistinguishable -- so the entire family is revoked and the user is
 * forced to sign in again.
 */
export const rotateRefreshToken = async ({ token, context = {} }) => {
  if (!token) {
    throw new ApiError(401, 'Refresh token missing', { code: ERROR_CODES.SESSION_EXPIRED });
  }

  let payload;
  try {
    payload = verifyRefreshToken(token);
  } catch {
    throw new ApiError(401, 'Invalid or expired session', {
      code: ERROR_CODES.SESSION_EXPIRED,
    });
  }

  const tokenHash = hashOpaqueToken(token);
  const stored = await refreshTokenRepository.findByHash(tokenHash);

  if (!stored) {
    // Signature is valid but the row is gone: revoked long ago and TTL-swept,
    // or forged against a leaked secret. Either way the session is not usable.
    throw new ApiError(401, 'Session not recognised', { code: ERROR_CODES.SESSION_EXPIRED });
  }

  if (stored.revokedAt) {
    await refreshTokenRepository.revokeFamily(stored.familyId, 'TOKEN_REUSE_DETECTED');
    logger.warn('Refresh token reuse detected - session family revoked', {
      userId: String(stored.userId),
      familyId: stored.familyId,
      ip: context.ip,
    });
    throw new ApiError(401, 'Session revoked for security reasons. Please sign in again.', {
      code: ERROR_CODES.TOKEN_REUSED,
    });
  }

  if (stored.expiresAt.getTime() <= Date.now()) {
    throw new ApiError(401, 'Session expired', { code: ERROR_CODES.SESSION_EXPIRED });
  }

  return { payload, stored, tokenHash };
};

export const revokeSession = (tokenHash, reason) =>
  refreshTokenRepository.revokeByHash(tokenHash, reason);

export const revokeAllSessions = (userId, reason, options) =>
  refreshTokenRepository.revokeAllForUser(userId, reason, options);

export const listActiveSessions = async (userId, currentTokenHash = null) => {
  const sessions = await refreshTokenRepository.findActiveByUser(userId);

  return sessions.map((session) => ({
    id: String(session._id),
    ip: session.ip,
    userAgent: session.userAgent,
    device: session.device,
    rememberMe: session.rememberMe,
    createdAt: session.createdAt,
    lastUsedAt: session.lastUsedAt,
    expiresAt: session.expiresAt,
    // Lets the client label "this device" without exposing any token material.
    current: currentTokenHash ? session.tokenHash === currentTokenHash : false,
  }));
};

export default {
  issueTokenPair,
  rotateRefreshToken,
  revokeSession,
  revokeAllSessions,
  listActiveSessions,
};
