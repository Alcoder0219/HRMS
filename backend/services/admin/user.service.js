import User from '../../models/auth/user.model.js';
import Employee from '../../models/employee/employee.model.js';
import LoginHistory from '../../models/auth/loginHistory.model.js';
import RefreshToken from '../../models/auth/refreshToken.model.js';

import ApiError from '../../utils/ApiError.js';
import { AUDIT_ACTIONS, ROLE_RANK, ROLES, ACCOUNT_STATUS } from '../../utils/constants.js';
import { buildPagination, buildSort, buildSearch } from '../../utils/queryBuilder.js';
import { recordAudit, diffObjects } from '../../helpers/audit.helper.js';
import { hashPassword } from '../../helpers/password.helper.js';
import { sendPasswordChangedEmail } from '../../helpers/mailer.helper.js';

/**
 * Login account administration.
 *
 * A User is not an Employee. The employee record is the person; the user is
 * their way in. Most employees never get one, and some users -- a platform
 * operator, an auditor from outside -- are on nobody's payroll. Linking them
 * is optional and reversible, which is why `employeeId` is a nullable pointer
 * rather than the two being one document.
 */

const tenantOf = (req) => req.user?.tenantId ?? null;

const SORTABLE = ['email', 'firstName', 'lastName', 'role', 'status', 'lastLoginAt', 'createdAt'];

const rankOf = (role) => ROLE_RANK[role] ?? 0;

/**
 * Nobody may create, promote to, or edit a role at or above their own.
 *
 * Without this, an HR user could mint a COMPANY_ADMIN and inherit the whole
 * tenant -- privilege escalation dressed up as a form submission. The rule is
 * strictly greater-than so an admin cannot quietly clone their own authority
 * either; only a higher rank can.
 */
const assertCanManage = (actorRole, targetRole, what) => {
  if (rankOf(actorRole) <= rankOf(targetRole)) {
    throw ApiError.forbidden(`You cannot ${what} a ${targetRole} account from a ${actorRole} account`);
  }
};

const assertNotSelf = (req, userId, what) => {
  if (String(req.user?.id) === String(userId)) {
    throw ApiError.badRequest(`You cannot ${what} your own account`);
  }
};

/** The shape every screen gets. Never carries the password or its history. */
const present = (user) => ({
  _id: user._id,
  email: user.email,
  firstName: user.firstName,
  lastName: user.lastName,
  fullName: `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim(),
  phone: user.phone ?? null,
  role: user.role,
  status: user.status,
  employeeId: user.employeeId ?? null,
  departmentId: user.departmentId ?? null,
  isEmailVerified: user.isEmailVerified,
  mustChangePassword: user.mustChangePassword,
  failedLoginAttempts: user.failedLoginAttempts ?? 0,
  // A lock in the past has expired; reporting it as locked would have support
  // unlocking accounts that already let the user in.
  isLocked: Boolean(user.lockUntil && new Date(user.lockUntil) > new Date()),
  lockUntil: user.lockUntil ?? null,
  lastLoginAt: user.lastLoginAt ?? null,
  lastLoginIp: user.lastLoginIp ?? null,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

export const listUsers = async (query, req) => {
  const { page, limit, skip } = buildPagination(query);
  const filter = { tenantId: tenantOf(req) };

  if (query.role) filter.role = query.role;
  if (query.status) filter.status = query.status;
  if (query.isEmailVerified !== undefined && query.isEmailVerified !== '') {
    filter.isEmailVerified = query.isEmailVerified === true || query.isEmailVerified === 'true';
  }
  if (query.linked === 'true') filter.employeeId = { $ne: null };
  if (query.linked === 'false') filter.employeeId = null;

  Object.assign(filter, buildSearch(query.search, ['email', 'firstName', 'lastName']));

  const sort = buildSort({ sortBy: query.sortBy, sortOrder: query.sortOrder }, SORTABLE, { createdAt: -1 });

  const [items, total] = await Promise.all([
    User.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate({ path: 'employeeId', select: 'employeeCode employeeId firstName lastName' })
      .populate({ path: 'departmentId', select: 'name' })
      .lean(),
    User.countDocuments(filter),
  ]);

  return {
    items: items.map((user) => ({
      ...present(user),
      employee: user.employeeId ?? null,
      department: user.departmentId ?? null,
    })),
    page,
    limit,
    total,
  };
};

export const getUser = async (id, req) => {
  const user = await User.findOne({ _id: id, tenantId: tenantOf(req) })
    .populate({ path: 'employeeId', select: 'employeeCode employeeId firstName lastName designationId' })
    .populate({ path: 'departmentId', select: 'name' })
    .lean();

  if (!user) throw ApiError.notFound('No such user');

  // The last few sign-ins, because "when did this account last work" is the
  // first question asked about any user being looked at.
  const [recentLogins, activeSessions] = await Promise.all([
    LoginHistory.find({ userId: user._id }).sort({ occurredAt: -1 }).limit(10).lean(),
    RefreshToken.countDocuments({ userId: user._id, revokedAt: null, expiresAt: { $gt: new Date() } }),
  ]);

  return {
    ...present(user),
    employee: user.employeeId ?? null,
    department: user.departmentId ?? null,
    activeSessions,
    recentLogins: recentLogins.map((entry) => ({
      _id: entry._id,
      event: entry.event,
      status: entry.status,
      failureReason: entry.failureReason,
      ip: entry.ip,
      userAgent: entry.userAgent,
      occurredAt: entry.occurredAt,
    })),
  };
};

export const createUser = async (payload, req) => {
  const tenantId = tenantOf(req);

  assertCanManage(req.user?.role, payload.role, 'create');

  const existing = await User.findOne({ email: String(payload.email).toLowerCase(), tenantId }).lean();
  if (existing) throw ApiError.conflict('That email address already has an account');

  if (payload.employeeId) {
    const employee = await Employee.findOne({ _id: payload.employeeId, tenantId, deletedAt: null }).lean();
    if (!employee) throw ApiError.badRequest('No such employee to link to');

    const taken = await User.findOne({ employeeId: payload.employeeId, tenantId }).lean();
    if (taken) throw ApiError.conflict('That employee already has a login account');
  }

  const user = await User.create({
    tenantId,
    email: payload.email,
    password: await hashPassword(payload.password),
    firstName: payload.firstName,
    lastName: payload.lastName,
    phone: payload.phone ?? null,
    role: payload.role,
    employeeId: payload.employeeId ?? null,
    departmentId: payload.departmentId ?? null,
    status: payload.status ?? ACCOUNT_STATUS.ACTIVE,
    // An administrator setting someone's first password knows it, so the
    // account is required to replace it at first sign-in.
    mustChangePassword: payload.mustChangePassword ?? true,
    isEmailVerified: payload.isEmailVerified ?? false,
    createdBy: req.user?.id ?? null,
  });

  await recordAudit({
    req,
    entity: 'User',
    entityId: user._id,
    entityLabel: user.email,
    action: AUDIT_ACTIONS.CREATE,
    changes: [
      { field: 'email', from: null, to: user.email },
      { field: 'role', from: null, to: user.role },
      { field: 'status', from: null, to: user.status },
    ],
  });

  return present(user.toObject());
};

export const updateUser = async (id, payload, req) => {
  const tenantId = tenantOf(req);
  const user = await User.findOne({ _id: id, tenantId });
  if (!user) throw ApiError.notFound('No such user');

  assertCanManage(req.user?.role, user.role, 'edit');

  if (payload.role && payload.role !== user.role) {
    assertCanManage(req.user?.role, payload.role, 'assign');
    assertNotSelf(req, id, 'change the role of');
  }

  if (payload.employeeId && String(payload.employeeId) !== String(user.employeeId ?? '')) {
    const employee = await Employee.findOne({ _id: payload.employeeId, tenantId, deletedAt: null }).lean();
    if (!employee) throw ApiError.badRequest('No such employee to link to');

    const taken = await User.findOne({ employeeId: payload.employeeId, tenantId, _id: { $ne: id } }).lean();
    if (taken) throw ApiError.conflict('That employee already has a login account');
  }

  const before = user.toObject({ depopulate: true });

  ['firstName', 'lastName', 'phone', 'role', 'employeeId', 'departmentId', 'mustChangePassword'].forEach((field) => {
    if (payload[field] !== undefined) user[field] = payload[field];
  });

  await user.save();

  const changes = diffObjects(before, user.toObject({ depopulate: true }));
  if (changes.length) {
    await recordAudit({
    req,
      entity: 'User',
      entityId: user._id,
      entityLabel: user.email,
      action: AUDIT_ACTIONS.UPDATE,
      changes,
    });
  }

  return present(user.toObject());
};

/**
 * Suspend or reinstate an account.
 *
 * Suspending revokes live refresh tokens as well as flipping the flag. Without
 * that the account keeps working until its access token expires, which is
 * exactly the window that matters when someone is being locked out in a hurry.
 */
export const setStatus = async (id, { status, reason }, req) => {
  const user = await User.findOne({ _id: id, tenantId: tenantOf(req) });
  if (!user) throw ApiError.notFound('No such user');

  assertCanManage(req.user?.role, user.role, 'suspend');
  assertNotSelf(req, id, 'suspend');

  if (user.status === status) throw ApiError.badRequest(`The account is already ${status}`);

  const from = user.status;
  user.status = status;
  await user.save();

  let revoked = 0;
  if (status !== ACCOUNT_STATUS.ACTIVE) {
    const result = await RefreshToken.updateMany(
      { userId: user._id, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
    revoked = result.modifiedCount ?? 0;
  }

  await recordAudit({
    req,
    entity: 'User',
    entityId: user._id,
    entityLabel: user.email,
    action: AUDIT_ACTIONS.STATUS_CHANGE,
    changes: [{ field: 'status', from, to: status }],
    metadata: { reason: reason ?? null, sessionsRevoked: revoked },
  });

  return { ...present(user.toObject()), sessionsRevoked: revoked };
};

/** Clears a lockout from repeated failed sign-ins. Not the same as reinstating a suspended account. */
export const unlockUser = async (id, req) => {
  const user = await User.findOne({ _id: id, tenantId: tenantOf(req) });
  if (!user) throw ApiError.notFound('No such user');

  assertCanManage(req.user?.role, user.role, 'unlock');

  if (!user.lockUntil && !user.failedLoginAttempts) {
    throw ApiError.badRequest('That account is not locked');
  }

  const wasLockedUntil = user.lockUntil;
  user.lockUntil = null;
  user.failedLoginAttempts = 0;
  if (user.status === ACCOUNT_STATUS.LOCKED) user.status = ACCOUNT_STATUS.ACTIVE;
  await user.save();

  await recordAudit({
    req,
    entity: 'User',
    entityId: user._id,
    entityLabel: user.email,
    action: AUDIT_ACTIONS.UPDATE,
    changes: [{ field: 'lockUntil', from: wasLockedUntil, to: null }],
    metadata: { unlockedBy: req.user?.email ?? null },
  });

  return present(user.toObject());
};

/**
 * Sets a new password on someone else's account.
 *
 * Every live session is revoked: a password reset that leaves the old sessions
 * signed in has not actually taken the account back. The new password is
 * marked as needing a change, so the administrator's chosen string is never
 * the one the user keeps.
 */
export const resetPassword = async (id, { password, notify }, req) => {
  const user = await User.findOne({ _id: id, tenantId: tenantOf(req) }).select('+password +passwordHistory');
  if (!user) throw ApiError.notFound('No such user');

  assertCanManage(req.user?.role, user.role, 'reset the password of');

  user.password = await hashPassword(password);
  user.passwordChangedAt = new Date();
  user.mustChangePassword = true;
  user.failedLoginAttempts = 0;
  user.lockUntil = null;
  await user.save();

  const result = await RefreshToken.updateMany(
    { userId: user._id, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );

  let emailed = false;
  if (notify) {
    try {
      // "Your password was changed", not a reset link. The administrator has
      // already set it; sending a link would invite a second, competing reset.
      await sendPasswordChangedEmail({ to: user.email, name: user.firstName });
      emailed = true;
    } catch {
      // A mail failure must not undo a completed reset. The caller is told
      // the password changed and the notification did not.
      emailed = false;
    }
  }

  await recordAudit({
    req,
    entity: 'User',
    entityId: user._id,
    entityLabel: user.email,
    action: AUDIT_ACTIONS.UPDATE,
    changes: [{ field: 'password', from: '********', to: '********' }],
    metadata: { resetBy: req.user?.email ?? null, sessionsRevoked: result.modifiedCount ?? 0, emailed },
  });

  return { sessionsRevoked: result.modifiedCount ?? 0, emailed };
};

/** Signs an account out everywhere without changing anything about it. */
export const revokeSessions = async (id, req) => {
  const user = await User.findOne({ _id: id, tenantId: tenantOf(req) }).lean();
  if (!user) throw ApiError.notFound('No such user');

  assertCanManage(req.user?.role, user.role, 'sign out');

  const result = await RefreshToken.updateMany(
    { userId: user._id, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );

  await recordAudit({
    req,
    entity: 'User',
    entityId: user._id,
    entityLabel: user.email,
    action: AUDIT_ACTIONS.UPDATE,
    changes: [{ field: 'sessions', from: result.modifiedCount ?? 0, to: 0 }],
  });

  return { sessionsRevoked: result.modifiedCount ?? 0 };
};

/**
 * Deletes an account outright.
 *
 * Genuinely deleted rather than flagged: a login account has no history worth
 * preserving in itself -- what it did lives in the audit trail, which keeps the
 * actor's email as a plain string precisely so the record survives the account.
 */
export const deleteUser = async (id, req) => {
  const user = await User.findOne({ _id: id, tenantId: tenantOf(req) });
  if (!user) throw ApiError.notFound('No such user');

  assertCanManage(req.user?.role, user.role, 'delete');
  assertNotSelf(req, id, 'delete');

  if (user.role === ROLES.SUPER_ADMIN) {
    const remaining = await User.countDocuments({
      role: ROLES.SUPER_ADMIN,
      status: ACCOUNT_STATUS.ACTIVE,
      _id: { $ne: user._id },
    });

    // Deleting the last administrator leaves nobody able to create another.
    if (remaining === 0) throw ApiError.badRequest('This is the last active Super Admin and cannot be deleted');
  }

  await Promise.all([
    RefreshToken.updateMany({ userId: user._id, revokedAt: null }, { $set: { revokedAt: new Date() } }),
    User.deleteOne({ _id: user._id }),
  ]);

  await recordAudit({
    req,
    entity: 'User',
    entityId: user._id,
    entityLabel: user.email,
    action: AUDIT_ACTIONS.DELETE,
    changes: [
      { field: 'email', from: user.email, to: null },
      { field: 'role', from: user.role, to: null },
    ],
  });

  return { deleted: true };
};

/** Headline counts for the user list. */
export const userSummary = async (req) => {
  const tenantId = tenantOf(req);
  const now = new Date();

  const [total, byStatus, byRole, locked, unlinked, neverSignedIn] = await Promise.all([
    User.countDocuments({ tenantId }),
    User.aggregate([{ $match: { tenantId } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    User.aggregate([{ $match: { tenantId } }, { $group: { _id: '$role', count: { $sum: 1 } } }]),
    User.countDocuments({ tenantId, lockUntil: { $gt: now } }),
    User.countDocuments({ tenantId, employeeId: null }),
    User.countDocuments({ tenantId, lastLoginAt: null }),
  ]);

  return {
    total,
    locked,
    unlinked,
    neverSignedIn,
    byStatus: Object.fromEntries(byStatus.map((entry) => [entry._id, entry.count])),
    byRole: Object.fromEntries(byRole.map((entry) => [entry._id, entry.count])),
  };
};

export default {
  listUsers,
  getUser,
  createUser,
  updateUser,
  setStatus,
  unlockUser,
  resetPassword,
  revokeSessions,
  deleteUser,
  userSummary,
};
