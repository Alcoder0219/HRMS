import mongoose from 'mongoose';
import { LOGIN_STATUS, LOGIN_EVENTS } from '../../utils/constants.js';

const { Schema, model } = mongoose;

/**
 * Append-only audit trail of every authentication event. Two jobs: it lets a
 * user review their own sign-in activity, and it gives support and compliance
 * a factual record of why an account locked or who accessed it and from where.
 *
 * `email` is denormalised because failed attempts against a non-existent
 * account have no userId to reference -- and those are exactly the rows an
 * investigation needs.
 */
const loginHistorySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null, index: true },
    email: { type: String, required: true, lowercase: true, trim: true, index: true },

    event: {
      type: String,
      enum: Object.values(LOGIN_EVENTS),
      default: LOGIN_EVENTS.LOGIN,
    },
    status: { type: String, enum: Object.values(LOGIN_STATUS), required: true },
    failureReason: { type: String, default: null },

    ip: { type: String, default: null },
    userAgent: { type: String, default: null },
    requestId: { type: String, default: null },

    occurredAt: { type: Date, default: Date.now, index: true },
  },
  {
    timestamps: false,
    // Audit rows are written once and never edited.
    versionKey: false,
  },
);

loginHistorySchema.index({ userId: 1, occurredAt: -1 });
loginHistorySchema.index({ email: 1, status: 1, occurredAt: -1 });

export default model('LoginHistory', loginHistorySchema);
