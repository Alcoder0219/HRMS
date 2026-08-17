import env from '../../config/env.js';
import logger from '../../config/logger.js';
import ApiError from '../../utils/ApiError.js';
import {
  ACCOUNT_STATUS,
  LOGIN_EVENTS,
  LOGIN_STATUS,
  TOKEN_TYPES,
} from '../../utils/constants.js';

import userRepository from '../../repositories/auth/user.repository.js';
import verificationTokenRepository from '../../repositories/auth/verificationToken.repository.js';
import loginHistoryRepository from '../../repositories/auth/loginHistory.repository.js';

import { hashPassword, comparePassword } from '../../helpers/password.helper.js';
import { generateOpaqueToken, hashOpaqueToken } from '../../helpers/token.helper.js';
import { sendPasswordResetEmail, sendPasswordChangedEmail } from '../../helpers/mailer.helper.js';
import tokenService from './token.service.js';

const audit = async (payload) => {
  try {
    await loginHistoryRepository.record(payload);
  } catch (error) {
    logger.error('Failed to write password audit entry', { error: error.message });
  }
};

/**
 * Blocks reuse of the last N passwords. Each historical hash must be compared
 * individually because bcrypt salts every hash differently -- there is no way
 * to look one up by equality.
 */
const assertNotReused = async (plain, user) => {
  const history = [user.password, ...(user.passwordHistory ?? [])]
    .filter(Boolean)
    .slice(0, env.auth.passwordHistorySize);

  const matches = await Promise.all(history.map((hash) => comparePassword(plain, hash)));

  if (matches.some(Boolean)) {
    throw ApiError.badRequest(
      `You cannot reuse any of your last ${env.auth.passwordHistorySize} passwords`,
    );
  }
};

const buildHistory = (user, previousHash) =>
  [previousHash, ...(user.passwordHistory ?? [])]
    .filter(Boolean)
    .slice(0, env.auth.passwordHistorySize);

/* --------------------------------------------------------- forgot password */

/**
 * Always resolves successfully, whether or not the address exists. Reporting
 * "no such account" here would turn the endpoint into a free user-enumeration
 * oracle.
 */
export const forgotPassword = async ({ email, tenantId = null }, req) => {
  const user = await userRepository.findByEmail(email, tenantId);

  if (!user || user.status === ACCOUNT_STATUS.DEACTIVATED) {
    logger.info('Password reset requested for unknown or inactive account', { email });
    return { sent: true };
  }

  const recent = await verificationTokenRepository.countRecent(
    user._id,
    TOKEN_TYPES.PASSWORD_RESET,
    60_000,
  );
  if (recent >= 2) {
    // Still a generic success -- the throttle must not reveal that the account
    // exists either.
    return { sent: true };
  }

  // One live reset link per account at a time.
  await verificationTokenRepository.invalidateOutstanding(user._id, TOKEN_TYPES.PASSWORD_RESET);

  const { raw, hash } = generateOpaqueToken();

  await verificationTokenRepository.create({
    userId: user._id,
    tenantId: user.tenantId ?? null,
    tokenHash: hash,
    type: TOKEN_TYPES.PASSWORD_RESET,
    expiresAt: new Date(Date.now() + env.auth.passwordResetExpiryMinutes * 60_000),
    requestedIp: req.ip,
    requestedUserAgent: req.get('User-Agent') ?? null,
  });

  const delivery = await sendPasswordResetEmail({
    to: user.email,
    name: user.firstName,
    token: raw,
  });

  // Echoed back only outside production, and only when delivery failed. In
  // production an SMTP outage must never hand a reset token to the caller --
  // whoever typed the address is not necessarily its owner.
  return { sent: true, resetToken: !delivery.delivered && !env.isProduction ? raw : undefined };
};

/* ---------------------------------------------------------- reset password */

export const resetPassword = async ({ token, newPassword }, req) => {
  const record = await verificationTokenRepository.findValidByHash(
    hashOpaqueToken(token),
    TOKEN_TYPES.PASSWORD_RESET,
  );

  if (!record) {
    throw ApiError.badRequest('This reset link is invalid or has expired');
  }

  const user = await userRepository.findByIdWithPassword(record.userId);
  if (!user) throw ApiError.notFound('Account not found');

  await assertNotReused(newPassword, user);

  // Consumed only after validation passes, so a rejected weak password does
  // not burn the user's one-time link.
  const consumed = await verificationTokenRepository.consume(record._id);
  if (!consumed) throw ApiError.badRequest('This reset link has already been used');

  const previousHash = user.password;
  await userRepository.updatePassword(user._id, {
    passwordHash: await hashPassword(newPassword),
    history: buildHistory(user, previousHash),
  });

  // A reset is the recovery path for a suspected compromise: every existing
  // session dies, and the lock (if any) is lifted by updatePassword.
  await tokenService.revokeAllSessions(user._id, 'PASSWORD_RESET');

  if (user.status === ACCOUNT_STATUS.LOCKED) {
    await userRepository.resetFailedAttempts(user._id, { status: ACCOUNT_STATUS.ACTIVE });
  }

  await audit({
    userId: user._id,
    tenantId: user.tenantId ?? null,
    email: user.email,
    event: LOGIN_EVENTS.PASSWORD_RESET,
    status: LOGIN_STATUS.SUCCESS,
    ip: req.ip,
    userAgent: req.get('User-Agent') ?? null,
    requestId: req.id ?? null,
  });

  await sendPasswordChangedEmail({ to: user.email, name: user.firstName });
  logger.info('Password reset completed', { userId: String(user._id) });

  return { reset: true };
};

/* --------------------------------------------------------- change password */

/**
 * For an authenticated user. `currentToken` is the caller's own refresh token:
 * every other session is revoked, but the device performing the change stays
 * signed in, which is what users expect.
 */
export const changePassword = async ({ userId, currentPassword, newPassword, currentToken }, req) => {
  const user = await userRepository.findByIdWithPassword(userId);
  if (!user) throw ApiError.notFound('Account not found');

  const matches = await comparePassword(currentPassword, user.password);
  if (!matches) {
    await audit({
      userId: user._id,
      tenantId: user.tenantId ?? null,
      email: user.email,
      event: LOGIN_EVENTS.PASSWORD_CHANGE,
      status: LOGIN_STATUS.FAILED,
      failureReason: 'INVALID_PASSWORD',
      ip: req.ip,
      userAgent: req.get('User-Agent') ?? null,
      requestId: req.id ?? null,
    });
    throw ApiError.unauthorized('Your current password is incorrect');
  }

  await assertNotReused(newPassword, user);

  const previousHash = user.password;
  await userRepository.updatePassword(user._id, {
    passwordHash: await hashPassword(newPassword),
    history: buildHistory(user, previousHash),
  });

  await tokenService.revokeAllSessions(user._id, 'PASSWORD_CHANGED', {
    exceptHash: currentToken ? hashOpaqueToken(currentToken) : null,
  });

  await audit({
    userId: user._id,
    tenantId: user.tenantId ?? null,
    email: user.email,
    event: LOGIN_EVENTS.PASSWORD_CHANGE,
    status: LOGIN_STATUS.SUCCESS,
    ip: req.ip,
    userAgent: req.get('User-Agent') ?? null,
    requestId: req.id ?? null,
  });

  await sendPasswordChangedEmail({ to: user.email, name: user.firstName });
  logger.info('Password changed', { userId: String(user._id) });

  return { changed: true };
};

export default { forgotPassword, resetPassword, changePassword };
