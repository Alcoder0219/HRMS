import VerificationToken from '../../models/auth/verificationToken.model.js';

export const create = (payload) => VerificationToken.create(payload);

export const findValidByHash = (tokenHash, type) =>
  VerificationToken.findOne({
    tokenHash,
    type,
    usedAt: null,
    expiresAt: { $gt: new Date() },
  });

/**
 * Marks the token spent, conditional on it still being unused. The
 * `usedAt: null` filter makes redemption atomic -- two concurrent requests
 * carrying the same reset link cannot both succeed.
 */
export const consume = (id) =>
  VerificationToken.findOneAndUpdate(
    { _id: id, usedAt: null },
    { $set: { usedAt: new Date() } },
    { new: true },
  );

/**
 * Issuing a new token invalidates the outstanding ones of that type, so a
 * "resend" leaves exactly one live link per user.
 */
export const invalidateOutstanding = (userId, type) =>
  VerificationToken.updateMany(
    { userId, type, usedAt: null },
    { $set: { usedAt: new Date() } },
  );

export const countRecent = (userId, type, sinceMs) =>
  VerificationToken.countDocuments({
    userId,
    type,
    createdAt: { $gt: new Date(Date.now() - sinceMs) },
  });

export default { create, findValidByHash, consume, invalidateOutstanding, countRecent };
