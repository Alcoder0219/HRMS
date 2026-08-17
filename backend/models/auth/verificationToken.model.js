import mongoose from 'mongoose';
import { TOKEN_TYPES } from '../../utils/constants.js';

const { Schema, model } = mongoose;

/**
 * Single-use, out-of-band tokens for email verification and password reset.
 * Both flows share one collection because their lifecycle is identical --
 * issue, email, redeem once, expire -- and `type` keeps them from being used
 * interchangeably.
 *
 * Only the SHA-256 digest is stored; the raw value exists solely in the email.
 */
const verificationTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null },

    tokenHash: { type: String, required: true, index: true },
    type: { type: String, enum: Object.values(TOKEN_TYPES), required: true },

    expiresAt: { type: Date, required: true },
    // Set on redemption. A token with this populated is spent and can never be
    // accepted again, even before its TTL removes the row.
    usedAt: { type: Date, default: null },

    requestedIp: { type: String, default: null },
    requestedUserAgent: { type: String, default: null },
  },
  { timestamps: true },
);

verificationTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
verificationTokenSchema.index({ userId: 1, type: 1, usedAt: 1 });

export default model('VerificationToken', verificationTokenSchema);
