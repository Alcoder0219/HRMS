import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * One row per active session. A refresh token that lived only inside a JWT
 * could never be revoked, so logout, "sign out everywhere" and reuse detection
 * all depend on this table existing.
 *
 * Only the SHA-256 digest is stored -- a database dump yields nothing
 * replayable.
 */
const refreshTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null, index: true },

    tokenHash: { type: String, required: true, unique: true },

    /**
     * All tokens descending from one login share a family id. When a token is
     * replayed after rotation, the whole family is revoked at once -- that is
     * the standard response to a suspected token theft, since the attacker and
     * the legitimate user cannot be told apart.
     */
    familyId: { type: String, required: true, index: true },

    rememberMe: { type: Boolean, default: false },

    userAgent: { type: String, default: null },
    ip: { type: String, default: null },
    device: { type: String, default: null },

    expiresAt: { type: Date, required: true },

    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, default: null },
    // Set when this token is rotated, forming the audit chain.
    replacedByHash: { type: String, default: null },

    lastUsedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// TTL index: MongoDB removes expired sessions on its own, so the table cannot
// grow unbounded and no cleanup job is required.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
refreshTokenSchema.index({ userId: 1, revokedAt: 1 });

refreshTokenSchema.virtual('isActive').get(function isActive() {
  return !this.revokedAt && this.expiresAt.getTime() > Date.now();
});

export default model('RefreshToken', refreshTokenSchema);
