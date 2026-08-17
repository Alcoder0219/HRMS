import env from '../../config/env.js';
import logger from '../../config/logger.js';
import ApiError from '../../utils/ApiError.js';
import {
  ACCOUNT_STATUS,
  ERROR_CODES,
  LOGIN_EVENTS,
  LOGIN_FAILURE_REASONS,
  LOGIN_STATUS,
  ROLES,
  ROLE_LABELS,
  ROLE_VALUES,
  TOKEN_TYPES,
} from '../../utils/constants.js';
import { permissionsFor, scopeFor, describeRole } from '../../helpers/permission.helper.js';

import userRepository from '../../repositories/auth/user.repository.js';
import loginHistoryRepository from '../../repositories/auth/loginHistory.repository.js';
import verificationTokenRepository from '../../repositories/auth/verificationToken.repository.js';

import { hashPassword, comparePassword, fakeComparePassword } from '../../helpers/password.helper.js';
import { generateOpaqueToken, hashOpaqueToken } from '../../helpers/token.helper.js';
import { sendVerificationEmail, sendAccountLockedEmail } from '../../helpers/mailer.helper.js';
import tokenService from './token.service.js';

/* ------------------------------------------------------------------ audit */

/**
 * Audit writes must never break the request that triggered them -- a failed
 * history insert should not turn a successful login into a 500.
 */
const audit = async (payload) => {
  try {
    await loginHistoryRepository.record(payload);
  } catch (error) {
    logger.error('Failed to write login history', { error: error.message, ...payload });
  }
};

const requestContext = (req) => ({
  ip: req.ip,
  userAgent: req.get('User-Agent') ?? null,
  requestId: req.id ?? null,
});

/**
 * Returns the raw token only when mail was not delivered AND this is not
 * production, so local development can complete the flow without SMTP.
 *
 * The production guard is not optional. Without it, an SMTP outage would make
 * "forgot password" hand a reset token straight back to whoever typed the
 * address -- including an attacker who typed someone else's.
 */
const devTokenEcho = (delivered, rawToken) =>
  !delivered && !env.isProduction ? rawToken : undefined;

/**
 * Uniform public shape for a user. Never includes credential fields.
 *
 * The resolved permission list travels with the user so the client can hide
 * what the caller cannot do. It is derived from the same matrix the middleware
 * enforces -- the client never gets its own copy of the rules to drift from.
 */
export const toPublicUser = (user) => ({
  id: String(user._id),
  tenantId: user.tenantId ? String(user.tenantId) : null,
  email: user.email,
  firstName: user.firstName,
  lastName: user.lastName,
  fullName: `${user.firstName} ${user.lastName}`.trim(),
  phone: user.phone ?? null,
  avatar: user.avatar ?? null,
  role: user.role,
  roleLabel: ROLE_LABELS[user.role] ?? user.role,
  scope: scopeFor(user.role),
  permissions: permissionsFor(user.role),
  status: user.status,
  isEmailVerified: user.isEmailVerified,
  mustChangePassword: user.mustChangePassword,
  lastLoginAt: user.lastLoginAt,
  createdAt: user.createdAt,
});

/** Full RBAC description of the caller, for `/auth/permissions`. */
export const getMyPermissions = async (userId) => {
  const user = await userRepository.findById(userId);
  if (!user) throw ApiError.notFound('Account not found');

  return describeRole(user.role);
};

/**
 * The whole matrix, for an RBAC administration screen. Read-only: the matrix
 * is code, so this reports it rather than offering to change it.
 */
export const listRoleDefinitions = () =>
  ROLE_VALUES.map((role) => describeRole(role)).filter(Boolean);

/* --------------------------------------------------- email verification */

const issueVerificationToken = async (user, context) => {
  await verificationTokenRepository.invalidateOutstanding(
    user._id,
    TOKEN_TYPES.EMAIL_VERIFICATION,
  );

  const { raw, hash } = generateOpaqueToken();

  await verificationTokenRepository.create({
    userId: user._id,
    tenantId: user.tenantId ?? null,
    tokenHash: hash,
    type: TOKEN_TYPES.EMAIL_VERIFICATION,
    expiresAt: new Date(Date.now() + env.auth.emailVerificationExpiryHours * 3_600_000),
    requestedIp: context?.ip ?? null,
    requestedUserAgent: context?.userAgent ?? null,
  });

  return raw;
};

/* --------------------------------------------------------------- register */

export const register = async (payload, req) => {
  const context = requestContext(req);
  const email = payload.email.toLowerCase().trim();

  // Role is never taken from the request body on self-registration; privilege
  // escalation via a crafted payload is the classic failure here.
  const role = ROLES.EMPLOYEE;

  if (await userRepository.existsByEmail(email, payload.tenantId ?? null)) {
    throw ApiError.conflict('An account with this email already exists');
  }

  const user = await userRepository.create({
    tenantId: payload.tenantId ?? null,
    email,
    password: await hashPassword(payload.password),
    firstName: payload.firstName,
    lastName: payload.lastName,
    phone: payload.phone ?? null,
    role,
    status: ACCOUNT_STATUS.PENDING,
  });

  const rawToken = await issueVerificationToken(user, context);
  const delivery = await sendVerificationEmail({
    to: user.email,
    name: user.firstName,
    token: rawToken,
  });

  logger.info('User registered', { userId: String(user._id), email: user.email });

  return {
    user: toPublicUser(user),
    emailDelivered: delivery.delivered,
    verificationToken: devTokenEcho(delivery.delivered, rawToken),
  };
};

export const verifyEmail = async (rawToken) => {
  const record = await verificationTokenRepository.findValidByHash(
    hashOpaqueToken(rawToken),
    TOKEN_TYPES.EMAIL_VERIFICATION,
  );

  if (!record) {
    throw ApiError.badRequest('This verification link is invalid or has expired');
  }

  // Atomic consume: a double-clicked link cannot verify twice.
  const consumed = await verificationTokenRepository.consume(record._id);
  if (!consumed) throw ApiError.badRequest('This verification link has already been used');

  const user = await userRepository.findById(record.userId);
  if (!user) throw ApiError.notFound('Account not found');

  if (user.isEmailVerified) return { user: toPublicUser(user), alreadyVerified: true };

  // A suspended or deactivated account must not be revived by verification.
  const nextStatus =
    user.status === ACCOUNT_STATUS.PENDING ? ACCOUNT_STATUS.ACTIVE : user.status;
  const updated = await userRepository.markEmailVerified(user._id, nextStatus);

  logger.info('Email verified', { userId: String(user._id) });
  return { user: toPublicUser(updated), alreadyVerified: false };
};

export const resendVerification = async (email, tenantId, req) => {
  const context = requestContext(req);
  const user = await userRepository.findByEmail(email, tenantId);

  // Always reports success: whether an address is registered is not something
  // an unauthenticated caller gets to learn.
  if (!user || user.isEmailVerified) return { sent: true };

  // Cheap throttle on top of the route limiter, scoped per account.
  const recent = await verificationTokenRepository.countRecent(
    user._id,
    TOKEN_TYPES.EMAIL_VERIFICATION,
    60_000,
  );
  if (recent >= 2) {
    throw ApiError.tooManyRequests('Please wait a moment before requesting another email');
  }

  const rawToken = await issueVerificationToken(user, context);
  const delivery = await sendVerificationEmail({
    to: user.email,
    name: user.firstName,
    token: rawToken,
  });

  return { sent: true, verificationToken: devTokenEcho(delivery.delivered, rawToken) };
};

/* ------------------------------------------------------------------ login */

/**
 * Applies the failed-attempt counter and locks the account once the threshold
 * is reached. Returns the lock expiry when a lock was applied.
 */
const registerFailedAttempt = async (user) => {
  const updated = await userRepository.incrementFailedAttempts(user._id);
  if (!updated) return null;

  if (updated.failedLoginAttempts < env.auth.maxLoginAttempts) return null;

  const lockUntil = new Date(Date.now() + env.auth.lockMinutes * 60_000);
  await userRepository.applyLock(user._id, lockUntil, ACCOUNT_STATUS.LOCKED);

  logger.warn('Account locked after repeated failed logins', {
    userId: String(user._id),
    attempts: updated.failedLoginAttempts,
  });

  await sendAccountLockedEmail({
    to: user.email,
    name: user.firstName,
    unlockAt: lockUntil.toISOString(),
  });

  return lockUntil;
};

const denyLogin = async ({ email, tenantId, userId, reason, context, message, code }) => {
  await audit({
    userId: userId ?? null,
    tenantId: tenantId ?? null,
    email,
    event: LOGIN_EVENTS.LOGIN,
    status: LOGIN_STATUS.FAILED,
    failureReason: reason,
    ...context,
  });

  throw new ApiError(401, message, { code });
};

export const login = async ({ email, password, rememberMe = false, tenantId = null, allowedRoles = null }, req) => {
  const context = requestContext(req);
  const normalizedEmail = email.toLowerCase().trim();

  const user = await userRepository.findByEmailWithPassword(normalizedEmail, tenantId);

  if (!user) {
    // Burn equivalent time so response latency cannot distinguish an unknown
    // email from a wrong password.
    await fakeComparePassword(password);
    return denyLogin({
      email: normalizedEmail,
      tenantId,
      reason: LOGIN_FAILURE_REASONS.USER_NOT_FOUND,
      context,
      message: 'Invalid email or password',
      code: ERROR_CODES.INVALID_CREDENTIALS,
    });
  }

  /* --- lock check runs before the password comparison ------------------- */
  if (user.isLocked) {
    const minutes = Math.ceil((user.lockUntil.getTime() - Date.now()) / 60_000);
    return denyLogin({
      email: normalizedEmail,
      tenantId: user.tenantId,
      userId: user._id,
      reason: LOGIN_FAILURE_REASONS.ACCOUNT_LOCKED,
      context,
      message: `Account locked. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      code: ERROR_CODES.ACCOUNT_LOCKED,
    });
  }

  // The lock has elapsed: clear it before evaluating the credentials.
  if (user.lockUntil && !user.isLocked) {
    await userRepository.resetFailedAttempts(user._id, {
      status: user.status === ACCOUNT_STATUS.LOCKED ? ACCOUNT_STATUS.ACTIVE : user.status,
    });
    user.status = user.status === ACCOUNT_STATUS.LOCKED ? ACCOUNT_STATUS.ACTIVE : user.status;
    user.failedLoginAttempts = 0;
    user.lockUntil = null;
  }

  /* --- credentials ------------------------------------------------------ */
  const passwordMatches = await comparePassword(password, user.password);

  if (!passwordMatches) {
    const lockUntil = await registerFailedAttempt(user);
    const remaining = env.auth.maxLoginAttempts - (user.failedLoginAttempts + 1);

    return denyLogin({
      email: normalizedEmail,
      tenantId: user.tenantId,
      userId: user._id,
      reason: lockUntil
        ? LOGIN_FAILURE_REASONS.ACCOUNT_LOCKED
        : LOGIN_FAILURE_REASONS.INVALID_PASSWORD,
      context,
      message: lockUntil
        ? `Account locked after ${env.auth.maxLoginAttempts} failed attempts. Try again in ${env.auth.lockMinutes} minutes.`
        : remaining > 0
          ? `Invalid email or password. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
          : 'Invalid email or password',
      code: lockUntil ? ERROR_CODES.ACCOUNT_LOCKED : ERROR_CODES.INVALID_CREDENTIALS,
    });
  }

  /* --- account state ---------------------------------------------------- */
  const eligibility = user.canLogin();
  if (!eligibility.allowed) {
    const messages = {
      [ACCOUNT_STATUS.PENDING]: 'Please verify your email address before signing in',
      [ACCOUNT_STATUS.SUSPENDED]: 'This account has been suspended. Contact your administrator.',
      [ACCOUNT_STATUS.DEACTIVATED]: 'This account is no longer active',
      [ACCOUNT_STATUS.LOCKED]: 'This account is temporarily locked',
    };
    const reasons = {
      [ACCOUNT_STATUS.PENDING]: LOGIN_FAILURE_REASONS.EMAIL_NOT_VERIFIED,
      [ACCOUNT_STATUS.SUSPENDED]: LOGIN_FAILURE_REASONS.ACCOUNT_SUSPENDED,
      [ACCOUNT_STATUS.DEACTIVATED]: LOGIN_FAILURE_REASONS.ACCOUNT_DEACTIVATED,
      [ACCOUNT_STATUS.LOCKED]: LOGIN_FAILURE_REASONS.ACCOUNT_LOCKED,
    };

    return denyLogin({
      email: normalizedEmail,
      tenantId: user.tenantId,
      userId: user._id,
      reason: reasons[eligibility.status],
      context,
      message: messages[eligibility.status],
      code:
        eligibility.status === ACCOUNT_STATUS.PENDING
          ? ERROR_CODES.EMAIL_NOT_VERIFIED
          : ERROR_CODES.INVALID_CREDENTIALS,
    });
  }

  /* --- role-scoped login portals --------------------------------------- */
  // Lets a route restrict which roles may authenticate through it -- an admin
  // console rejecting an EMPLOYEE credential, for example.
  if (allowedRoles?.length && !allowedRoles.includes(user.role)) {
    return denyLogin({
      email: normalizedEmail,
      tenantId: user.tenantId,
      userId: user._id,
      reason: LOGIN_FAILURE_REASONS.ROLE_NOT_PERMITTED,
      context,
      message: 'Your account is not permitted to sign in here',
      code: ERROR_CODES.FORBIDDEN_ROLE,
    });
  }

  /* --- success ---------------------------------------------------------- */
  const tokens = await tokenService.issueTokenPair({ user, rememberMe, context });
  await userRepository.recordSuccessfulLogin(user._id, { ip: context.ip });

  await audit({
    userId: user._id,
    tenantId: user.tenantId ?? null,
    email: normalizedEmail,
    event: LOGIN_EVENTS.LOGIN,
    status: LOGIN_STATUS.SUCCESS,
    ...context,
  });

  logger.info('Login successful', { userId: String(user._id), role: user.role });

  return {
    user: toPublicUser(user),
    ...tokens,
    rememberMe,
  };
};

/* ---------------------------------------------------------------- refresh */

/**
 * Silent re-authentication. Every call rotates the refresh token, so a stolen
 * one is only usable until the legitimate client next refreshes -- at which
 * point reuse detection fires and both sessions die.
 */
export const refresh = async (rawToken, req) => {
  const context = requestContext(req);

  const { stored, tokenHash } = await tokenService.rotateRefreshToken({
    token: rawToken,
    context,
  });

  const user = await userRepository.findById(stored.userId);
  if (!user) throw ApiError.unauthorized('Account no longer exists');

  const eligibility = user.canLogin();
  if (!eligibility.allowed) {
    // Status changed mid-session (suspended, deactivated): end it now rather
    // than let the existing session run to its natural expiry.
    await tokenService.revokeAllSessions(user._id, 'ACCOUNT_NOT_ELIGIBLE');
    throw ApiError.unauthorized('This account can no longer sign in');
  }

  const tokens = await tokenService.issueTokenPair({
    user,
    rememberMe: stored.rememberMe,
    context,
    familyId: stored.familyId,
  });

  await tokenService.revokeSession(tokenHash, 'ROTATED');

  return { user: toPublicUser(user), ...tokens, rememberMe: stored.rememberMe };
};

/* ----------------------------------------------------------------- logout */

export const logout = async (rawToken, req) => {
  if (!rawToken) return { loggedOut: true };

  const tokenHash = hashOpaqueToken(rawToken);
  const session = await tokenService.revokeSession(tokenHash, 'USER_LOGOUT');

  if (session) {
    await audit({
      userId: session.userId,
      tenantId: session.tenantId ?? null,
      email: req.user?.email ?? 'unknown',
      event: LOGIN_EVENTS.LOGOUT,
      status: LOGIN_STATUS.SUCCESS,
      ...requestContext(req),
    });
  }

  // Idempotent by design: logging out twice is a success, not an error.
  return { loggedOut: true };
};

export const logoutAll = async (userId, req) => {
  const result = await tokenService.revokeAllSessions(userId, 'USER_LOGOUT_ALL');

  await audit({
    userId,
    tenantId: req.user?.tenantId ?? null,
    email: req.user?.email ?? 'unknown',
    event: LOGIN_EVENTS.LOGOUT,
    status: LOGIN_STATUS.SUCCESS,
    ...requestContext(req),
  });

  return { loggedOut: true, sessionsRevoked: result.modifiedCount ?? 0 };
};

/* ------------------------------------------------------------------ reads */

export const getProfile = async (userId) => {
  const user = await userRepository.findById(userId);
  if (!user) throw ApiError.notFound('Account not found');
  return toPublicUser(user);
};

export const getLoginHistory = (userId, pagination) =>
  loginHistoryRepository.findByUser(userId, pagination);

export const getSessions = (userId, currentToken) =>
  tokenService.listActiveSessions(
    userId,
    currentToken ? hashOpaqueToken(currentToken) : null,
  );

export default {
  register,
  verifyEmail,
  resendVerification,
  login,
  refresh,
  logout,
  logoutAll,
  getProfile,
  getLoginHistory,
  getSessions,
  getMyPermissions,
  listRoleDefinitions,
  toPublicUser,
};
