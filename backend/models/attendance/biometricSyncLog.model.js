import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/** How long sync logs are kept. Events are permanent; their bookkeeping is not. */
const RETENTION_DAYS = 90;

/**
 * One batch of punches arriving, and what became of it.
 *
 * A row per data-bearing exchange -- an ATTLOG upload, a scheduled pull, a
 * manual reprocess -- and deliberately NOT per heartbeat. A terminal polls every
 * few seconds; logging those would bury the hundred rows that matter under ten
 * thousand that say "still here", which is what `lastSeenAt` on the device is for.
 */
const biometricSyncLogSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null, index: true },
    deviceId: { type: Schema.Types.ObjectId, default: null, index: true },
    deviceSerial: { type: String, trim: true, maxlength: 60, default: null },

    /** PUSH (the device called us), PULL (we called it), REPROCESS, COMMAND. */
    kind: { type: String, enum: ['PUSH', 'PULL', 'REPROCESS', 'COMMAND'], required: true },
    transport: { type: String, trim: true, maxlength: 20, default: null },
    success: { type: Boolean, default: true },

    received: { type: Number, default: 0 },
    imported: { type: Number, default: 0 },
    duplicate: { type: Number, default: 0 },
    unmapped: { type: Number, default: 0 },
    held: { type: Number, default: 0 },
    ignored: { type: Number, default: 0 },
    rejected: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    daysUpdated: { type: Number, default: 0 },

    /**
     * What went wrong, in words. Capped and sanitised by the writer: reasons
     * and line numbers, never a raw payload, a credential or a connection string.
     */
    errorMessages: { type: [String], default: [] },
    message: { type: String, trim: true, maxlength: 500, default: null },

    remoteIp: { type: String, trim: true, maxlength: 64, default: null },
    triggeredBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    durationMs: { type: Number, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

biometricSyncLogSchema.index({ tenantId: 1, deviceId: 1, createdAt: -1 });
biometricSyncLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: RETENTION_DAYS * 86_400 });

export default model('BiometricSyncLog', biometricSyncLogSchema);
