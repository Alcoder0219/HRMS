import User from '../../models/auth/user.model.js';
import RefreshToken from '../../models/auth/refreshToken.model.js';

import ApiError from '../../utils/ApiError.js';
import logger from '../../config/logger.js';
import { ACCOUNT_STATUS, AUDIT_ACTIONS, ROLE_RANK, ROLES } from '../../utils/constants.js';
import { recordAudit } from '../../helpers/audit.helper.js';
import { hashPassword, generatePassword } from '../../helpers/password.helper.js';

/**
 * Portal access: the login account behind an employee, managed from the
 * Employee Master.
 *
 * Every user in this product is an employee, so the Employee form is where
 * access is granted rather than a separate Users screen. That does NOT collapse
 * the two records. A User is still a credential with its own lifecycle, and it
 * has to outlive the employee: the audit trail references it, refresh tokens
 * point at it, and login history is meaningless without it.
 *
 * The rules that follow from that, and that this module exists to hold:
 *
 *   - A user is NEVER deleted here, only deactivated.
 *   - A SUPER_ADMIN account is never touched through an employee, in any
 *     direction. It is a platform account that may have no employee at all.
 *   - Nobody may grant a role at or above their own, exactly as the Users
 *     screen enforces. Without that this form would be a clean privilege
 *     escalation: an HR user cannot mint a COMPANY_ADMIN there, and must not be
 *     able to here either.
 */

const rankOf = (role) => ROLE_RANK[role] ?? 0;

/**
 * The same escalation guard `user.service.js` applies, restated for this path.
 *
 * Strictly greater-than, so an administrator cannot clone their own authority
 * either -- only a higher rank can grant a rank.
 */
const assertCanGrant = (actorRole, targetRole, what) => {
  if (rankOf(actorRole) <= rankOf(targetRole)) {
    throw ApiError.forbidden(
      `You cannot ${what} a ${targetRole} account from a ${actorRole} account`,
    );
  }
};

/**
 * SUPER_ADMIN is out of reach from this screen entirely.
 *
 * It is not in the role list the form offers, so arriving here means a
 * hand-made request -- and the account it targets may be the only way back into
 * the system.
 */
const assertNotSuperAdmin = (user, what) => {
  if (user?.role === ROLES.SUPER_ADMIN) {
    throw ApiError.forbidden(`A Super Admin account cannot be ${what} from the Employee Master`);
  }
};

/** The login address: what was typed, or the work email it defaults to. */
const resolveEmail = (payload, employee) => {
  const email = String(payload.portalEmail || employee.workEmail || '').trim().toLowerCase();

  if (!email) {
    throw ApiError.unprocessable('Validation failed', [
      {
        field: 'portalEmail',
        message: 'A login email is required. Set a work email, or enter one here.',
      },
    ]);
  }

  return email;
};

/**
 * Refuses an address already spoken for.
 *
 * Scoped to the tenant, matching the unique index on the User collection: the
 * same person may legitimately hold accounts in two customer organisations.
 */
const assertEmailFree = async (email, tenantId, exceptUserId = null) => {
  const taken = await User.findOne({
    email,
    tenantId: tenantId ?? null,
    ...(exceptUserId ? { _id: { $ne: exceptUserId } } : {}),
  })
    .select('_id')
    .lean();

  if (taken) {
    throw ApiError.conflict('This email is already in use by another account', [
      { field: 'portalEmail', message: 'This email is already in use by another account' },
    ]);
  }
};

/* -------------------------------------------------------------------------- */
/*                                   Grant                                    */
/* -------------------------------------------------------------------------- */

/**
 * Creates the login account for an employee who has none.
 *
 * Returns the generated password when one was invented, so the caller can show
 * it to the administrator ONCE. It is never stored in the clear and never
 * returned again -- which is why `mustChangePassword` is set either way: the
 * person who set the password should not be the person who keeps using it.
 */
const grantAccess = async (employee, payload, req) => {
  const tenantId = employee.tenantId ?? null;
  const role = payload.portalRole ?? ROLES.EMPLOYEE;

  assertCanGrant(req.user?.role, role, 'grant');

  const email = resolveEmail(payload, employee);
  await assertEmailFree(email, tenantId);

  const generated = payload.portalPassword ? null : generatePassword();
  const password = payload.portalPassword || generated;

  const user = await User.create({
    tenantId,
    email,
    password: await hashPassword(password),
    firstName: employee.firstName,
    // The User schema requires a surname; an employee's is optional, because a
    // mononym is a real name. A single space would fail `trim` + `required`,
    // so the employee code stands in -- it is at least identifying.
    lastName: employee.lastName?.trim() || employee.employeeCode,
    phone: employee.mobile ?? null,
    role,
    employeeId: employee._id,
    departmentId: employee.departmentId ?? null,
    status: payload.portalStatus ?? ACCOUNT_STATUS.ACTIVE,
    // Whoever set this password knows it, so it cannot be the one that stays.
    mustChangePassword: true,
    isEmailVerified: false,
    createdBy: req.user?.id ?? null,
  });

  await recordAudit({
    req,
    entity: 'User',
    entityId: user._id,
    entityLabel: user.email,
    action: AUDIT_ACTIONS.CREATE,
    metadata: { source: 'EMPLOYEE_MASTER', employeeCode: employee.employeeCode },
    changes: [
      { field: 'email', from: null, to: user.email },
      { field: 'role', from: null, to: user.role },
      { field: 'status', from: null, to: user.status },
    ],
  });

  logger.info('Portal access granted from the Employee Master', {
    employeeCode: employee.employeeCode,
    email: user.email,
    role: user.role,
  });

  return { user, generatedPassword: generated };
};

/* -------------------------------------------------------------------------- */
/*                                   Revise                                   */
/* -------------------------------------------------------------------------- */

/** Applies the form's changes to an account the employee already has. */
const reviseAccess = async (user, employee, payload, req) => {
  assertNotSuperAdmin(user, 'changed');
  assertCanGrant(req.user?.role, user.role, 'edit');

  const changes = [];

  if (payload.portalRole && payload.portalRole !== user.role) {
    assertCanGrant(req.user?.role, payload.portalRole, 'assign');
    changes.push({ field: 'role', from: user.role, to: payload.portalRole });
    user.role = payload.portalRole;
  }

  const email = resolveEmail(payload, employee);
  if (email !== user.email) {
    await assertEmailFree(email, employee.tenantId ?? null, user._id);
    changes.push({ field: 'email', from: user.email, to: email });
    user.email = email;
  }

  if (payload.portalStatus && payload.portalStatus !== user.status) {
    changes.push({ field: 'status', from: user.status, to: payload.portalStatus });
    user.status = payload.portalStatus;
  }

  /**
   * A password supplied here is a reset, with everything that implies.
   *
   * Live sessions are revoked, because a reset that leaves the old ones signed
   * in has not actually taken the account back -- the same rule the Users
   * screen follows. Blank means "leave it alone", so an unrelated edit cannot
   * silently change somebody's password.
   */
  let sessionsRevoked = 0;

  if (payload.portalPassword) {
    user.password = await hashPassword(payload.portalPassword);
    user.passwordChangedAt = new Date();
    user.mustChangePassword = true;
    user.failedLoginAttempts = 0;
    user.lockUntil = null;

    const result = await RefreshToken.updateMany(
      { userId: user._id, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
    sessionsRevoked = result.modifiedCount ?? 0;

    changes.push({ field: 'password', from: '********', to: '********' });
  }

  // The department follows the employee: RBAC scope filters read it, and a
  // stale one would scope a transferred manager to the team they left.
  if (String(user.departmentId ?? '') !== String(employee.departmentId ?? '')) {
    user.departmentId = employee.departmentId ?? null;
  }

  // Names follow too, so a marriage or a correction does not leave the login
  // showing a name nobody uses.
  user.firstName = employee.firstName;
  user.lastName = employee.lastName?.trim() || employee.employeeCode;

  if (!changes.length) {
    await user.save();
    return { user, generatedPassword: null, sessionsRevoked: 0 };
  }

  /**
   * A status change away from ACTIVE revokes sessions too.
   *
   * Suspending an account that keeps working until its access token expires is
   * not suspended. Skipped when a password reset above already revoked them.
   */
  if (
    user.status !== ACCOUNT_STATUS.ACTIVE &&
    changes.some((change) => change.field === 'status') &&
    !payload.portalPassword
  ) {
    const result = await RefreshToken.updateMany(
      { userId: user._id, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
    sessionsRevoked = result.modifiedCount ?? 0;
  }

  await user.save();

  await recordAudit({
    req,
    entity: 'User',
    entityId: user._id,
    entityLabel: user.email,
    action: AUDIT_ACTIONS.UPDATE,
    changes,
    metadata: { source: 'EMPLOYEE_MASTER', employeeCode: employee.employeeCode, sessionsRevoked },
  });

  return { user, generatedPassword: null, sessionsRevoked };
};

/* -------------------------------------------------------------------------- */
/*                                   Revoke                                   */
/* -------------------------------------------------------------------------- */

/**
 * Withdraws access without destroying the account.
 *
 * Deactivated, never deleted: the audit trail, login history and refresh tokens
 * all reference this user, and deleting it would orphan the record of what the
 * person actually did. Sessions are revoked so the withdrawal takes effect now
 * rather than whenever the current access token happens to expire.
 *
 * `employee.userId` is deliberately left pointing at the account. Clearing it
 * would sever the only link back to that history, and re-enabling access later
 * would mint a second user for the same person while the first sat orphaned.
 * The account's STATUS is what says whether access is granted.
 */
export const revokePortalAccess = async (user, employee, req, { reason = null } = {}) => {
  if (!user) return { revoked: false };

  // A Super Admin is not withdrawn by an employee edit, and not by an employee
  // being deleted either. It may be the only way back in.
  if (user.role === ROLES.SUPER_ADMIN) {
    logger.warn('Refused to deactivate a Super Admin through the Employee Master', {
      employeeCode: employee?.employeeCode,
      email: user.email,
    });
    return { revoked: false, reason: 'SUPER_ADMIN_PROTECTED' };
  }

  if (user.status === ACCOUNT_STATUS.DEACTIVATED) return { revoked: false, reason: 'ALREADY_DEACTIVATED' };

  const from = user.status;
  user.status = ACCOUNT_STATUS.DEACTIVATED;
  await user.save();

  const result = await RefreshToken.updateMany(
    { userId: user._id, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );

  await recordAudit({
    req,
    entity: 'User',
    entityId: user._id,
    entityLabel: user.email,
    action: AUDIT_ACTIONS.STATUS_CHANGE,
    changes: [{ field: 'status', from, to: ACCOUNT_STATUS.DEACTIVATED }],
    metadata: {
      source: 'EMPLOYEE_MASTER',
      employeeCode: employee?.employeeCode ?? null,
      reason,
      sessionsRevoked: result.modifiedCount ?? 0,
    },
  });

  logger.info('Portal access revoked from the Employee Master', {
    employeeCode: employee?.employeeCode,
    email: user.email,
    sessionsRevoked: result.modifiedCount ?? 0,
  });

  return { revoked: true, sessionsRevoked: result.modifiedCount ?? 0 };
};

/* -------------------------------------------------------------------------- */
/*                                Entry point                                 */
/* -------------------------------------------------------------------------- */

/** The portal fields the Employee form sends. Not part of the employee schema. */
export const PORTAL_FIELDS = [
  'portalAccess',
  'portalEmail',
  'portalRole',
  'portalPassword',
  'portalStatus',
];

/**
 * Reconciles an employee's login account with what the form asked for.
 *
 * Four cases, decided by what exists against what was requested:
 *
 *   no account + access on   -> create one
 *   an account + access on   -> apply the changes
 *   an account + access off  -> deactivate it
 *   no account + access off  -> nothing
 *
 * Returns what the employee record needs written back (`userId`) plus anything
 * the caller should show once (a generated password).
 *
 * Absent `portalAccess` means the form did not touch the section, which is what
 * a partial update from another tab looks like. That is not the same as
 * `false`, and treating it as such would revoke somebody's access every time a
 * colleague edited their address.
 */
export const applyPortalAccess = async (employee, payload, req) => {
  if (payload?.portalAccess === undefined) return { changed: false };

  const existing = employee.userId
    ? await User.findById(employee.userId).select('+password')
    : null;

  /* --- requested off ---------------------------------------------------- */
  if (payload.portalAccess !== true) {
    if (!existing) return { changed: false };

    const result = await revokePortalAccess(existing, employee, req, { reason: 'Access withdrawn' });
    return { changed: result.revoked, userId: employee.userId, ...result };
  }

  /* --- requested on ----------------------------------------------------- */
  if (existing) {
    /**
     * A deactivated account being switched back on is REINSTATED, not replaced.
     *
     * The form has no separate "reactivate" control, so turning the toggle back
     * on has to mean this -- otherwise an employee who left and returned would
     * accumulate a second login while the first stayed dead, and their history
     * would be split across two accounts.
     */
    if (existing.status === ACCOUNT_STATUS.DEACTIVATED && !payload.portalStatus) {
      payload = { ...payload, portalStatus: ACCOUNT_STATUS.ACTIVE };
    }

    const revised = await reviseAccess(existing, employee, payload, req);
    return { changed: true, userId: revised.user._id, ...revised };
  }

  const granted = await grantAccess(employee, payload, req);
  return { changed: true, userId: granted.user._id, ...granted };
};

export default { applyPortalAccess, revokePortalAccess, PORTAL_FIELDS };
