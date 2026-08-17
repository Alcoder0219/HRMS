import User from '../../models/auth/user.model.js';

/**
 * The only module permitted to query the User collection. Centralising it here
 * is what makes credential handling auditable -- there are exactly two methods
 * that select the password field, and both are named for it.
 */

export const findById = (id) => User.findById(id);

export const findByIdWithPassword = (id) => User.findById(id).select('+password +passwordHistory');

/**
 * Login lookup. Tenant scope is optional so a single-tenant deployment or a
 * SUPER_ADMIN can sign in without supplying one; when present it is applied,
 * which keeps identical emails in different tenants distinct.
 */
export const findByEmail = (email, tenantId = null) => {
  const filter = { email: String(email).toLowerCase().trim() };
  if (tenantId) filter.tenantId = tenantId;
  return User.findOne(filter);
};

export const findByEmailWithPassword = (email, tenantId = null) => {
  const filter = { email: String(email).toLowerCase().trim() };
  if (tenantId) filter.tenantId = tenantId;
  return User.findOne(filter).select('+password +passwordHistory');
};

export const existsByEmail = async (email, tenantId = null) => {
  const filter = { email: String(email).toLowerCase().trim() };
  if (tenantId) filter.tenantId = tenantId;
  return Boolean(await User.exists(filter));
};

export const create = (payload) => User.create(payload);

export const updateById = (id, update) =>
  User.findByIdAndUpdate(id, update, { new: true, runValidators: true });

/* ------------------------------------------------- brute-force counters */

/**
 * `$inc` rather than read-modify-write: concurrent login attempts must not
 * lose increments, which is precisely what an attacker parallelising guesses
 * would exploit.
 */
export const incrementFailedAttempts = (id) =>
  User.findByIdAndUpdate(
    id,
    { $inc: { failedLoginAttempts: 1 }, $set: { lastFailedLoginAt: new Date() } },
    { new: true },
  );

export const applyLock = (id, lockUntil, status) =>
  User.findByIdAndUpdate(id, { $set: { lockUntil, status } }, { new: true });

export const resetFailedAttempts = (id, { status } = {}) =>
  User.findByIdAndUpdate(
    id,
    {
      $set: {
        failedLoginAttempts: 0,
        lockUntil: null,
        ...(status ? { status } : {}),
      },
    },
    { new: true },
  );

export const recordSuccessfulLogin = (id, { ip }) =>
  User.findByIdAndUpdate(
    id,
    {
      $set: {
        failedLoginAttempts: 0,
        lockUntil: null,
        lastLoginAt: new Date(),
        lastLoginIp: ip,
      },
    },
    { new: true },
  );

/* ---------------------------------------------------------- credentials */

/**
 * `passwordChangedAt` is written in the same update as the new hash, so the
 * token-staleness check can never observe one without the other.
 */
export const updatePassword = (id, { passwordHash, history }) =>
  User.findByIdAndUpdate(
    id,
    {
      $set: {
        password: passwordHash,
        passwordHistory: history,
        passwordChangedAt: new Date(),
        mustChangePassword: false,
        failedLoginAttempts: 0,
        lockUntil: null,
      },
    },
    { new: true },
  );

export const markEmailVerified = (id, status) =>
  User.findByIdAndUpdate(
    id,
    { $set: { isEmailVerified: true, emailVerifiedAt: new Date(), status } },
    { new: true },
  );

export default {
  findById,
  findByIdWithPassword,
  findByEmail,
  findByEmailWithPassword,
  existsByEmail,
  create,
  updateById,
  incrementFailedAttempts,
  applyLock,
  resetFailedAttempts,
  recordSuccessfulLogin,
  updatePassword,
  markEmailVerified,
};
