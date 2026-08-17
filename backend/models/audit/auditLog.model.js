import mongoose from 'mongoose';
import { AUDIT_ACTIONS } from '../../utils/constants.js';

const { Schema, model } = mongoose;

/**
 * Append-only change trail, shared by every module.
 *
 * Generic on purpose -- `entity` plus `entityId` rather than a typed reference
 * -- so a new module gets auditing by calling the helper, with no schema change
 * and no second audit table to keep consistent.
 */
const auditLogSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null, index: true },

    entity: { type: String, required: true, index: true }, // 'Employee', 'Payroll', ...
    entityId: { type: Schema.Types.ObjectId, required: true, index: true },
    // Human label captured at write time: the record may later be renamed or
    // deleted, and an audit line reading "Employee 65f2..." helps nobody.
    entityLabel: { type: String, default: null },

    action: { type: String, enum: Object.values(AUDIT_ACTIONS), required: true, index: true },

    /**
     * Field-level diff, not full snapshots. Storing before/after copies of a
     * whole employee on every edit would multiply PII across the database;
     * a diff records only what actually moved.
     */
    changes: {
      type: [
        new Schema(
          {
            field: { type: String, required: true },
            from: { type: Schema.Types.Mixed, default: null },
            to: { type: Schema.Types.Mixed, default: null },
          },
          { _id: false },
        ),
      ],
      default: [],
    },

    // Free-form context: import batch size, export row count, exit reason.
    metadata: { type: Schema.Types.Mixed, default: null },

    actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    actorEmail: { type: String, default: null },
    actorRole: { type: String, default: null },

    ip: { type: String, default: null },
    userAgent: { type: String, default: null },
    requestId: { type: String, default: null },

    occurredAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false, versionKey: false },
);

// The two queries that matter: one record's history, and one tenant's recent
// activity feed.
auditLogSchema.index({ entity: 1, entityId: 1, occurredAt: -1 });
auditLogSchema.index({ tenantId: 1, occurredAt: -1 });

export default model('AuditLog', auditLogSchema);
