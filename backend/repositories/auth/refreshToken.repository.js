import RefreshToken from '../../models/auth/refreshToken.model.js';

export const create = (payload) => RefreshToken.create(payload);

export const findByHash = (tokenHash) => RefreshToken.findOne({ tokenHash });

export const findActiveByUser = (userId) =>
  RefreshToken.find({ userId, revokedAt: null, expiresAt: { $gt: new Date() } }).sort({
    createdAt: -1,
  });

export const countActiveByUser = (userId) =>
  RefreshToken.countDocuments({ userId, revokedAt: null, expiresAt: { $gt: new Date() } });

export const touch = (tokenHash) =>
  RefreshToken.updateOne({ tokenHash }, { $set: { lastUsedAt: new Date() } });

export const revokeByHash = (tokenHash, reason, replacedByHash = null) =>
  RefreshToken.findOneAndUpdate(
    { tokenHash, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: reason, replacedByHash } },
    { new: true },
  );

/**
 * Revokes an entire rotation lineage. Invoked when a already-rotated token is
 * replayed: the legitimate holder and the thief are indistinguishable at that
 * point, so the only safe move is to end the whole session chain.
 */
export const revokeFamily = (familyId, reason) =>
  RefreshToken.updateMany(
    { familyId, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: reason } },
  );

/** Backs "sign out everywhere" and the forced sign-out after a password change. */
export const revokeAllForUser = (userId, reason, { exceptHash = null } = {}) => {
  const filter = { userId, revokedAt: null };
  if (exceptHash) filter.tokenHash = { $ne: exceptHash };
  return RefreshToken.updateMany(filter, {
    $set: { revokedAt: new Date(), revokedReason: reason },
  });
};

/**
 * Enforces the concurrent-session cap by retiring the oldest sessions once the
 * limit is exceeded, so a new login is never rejected for it.
 */
export const revokeOldestBeyondLimit = async (userId, limit, reason) => {
  const active = await RefreshToken.find({
    userId,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  })
    .sort({ createdAt: 1 })
    .select('_id');

  const excess = active.length - limit;
  if (excess <= 0) return 0;

  const ids = active.slice(0, excess).map((doc) => doc._id);
  await RefreshToken.updateMany(
    { _id: { $in: ids } },
    { $set: { revokedAt: new Date(), revokedReason: reason } },
  );
  return ids.length;
};

export default {
  create,
  findByHash,
  findActiveByUser,
  countActiveByUser,
  touch,
  revokeByHash,
  revokeFamily,
  revokeAllForUser,
  revokeOldestBeyondLimit,
};
