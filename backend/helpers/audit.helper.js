import logger from '../config/logger.js';
import { AUDIT_REDACTED_FIELDS } from '../utils/constants.js';
import auditLogRepository from '../repositories/audit/auditLog.repository.js';

const REDACTED = '[REDACTED]';

/**
 * Values that are objects to JavaScript but a single value to a reader.
 *
 * An ObjectId is internally `{ buffer: Uint8Array(12) }`. Without this check the
 * diff recursed into it and recorded a department change as twelve entries --
 * `departmentId.buffer.0` through `.11`, one per byte -- which is unreadable
 * and buries the real change. Buffers and typed arrays have the same problem.
 */
const isAtomicObject = (value) =>
  value instanceof Date ||
  // Every BSON type (ObjectId, Decimal128, Long) carries this marker.
  typeof value?._bsontype === 'string' ||
  ArrayBuffer.isView(value) ||
  (typeof Buffer !== 'undefined' && Buffer.isBuffer(value));

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && !isAtomicObject(value);

const normalize = (value) => {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  // Before the array/object branch: an ObjectId stringifies to its hex, which
  // is the identifier a reader recognises.
  if (isAtomicObject(value)) return String(value);
  if (Array.isArray(value) || isPlainObject(value)) return JSON.stringify(value);
  if (typeof value === 'object' && typeof value.toString === 'function') return String(value);
  return value;
};

/**
 * Field-level diff between two plain objects, walking nested documents so a
 * change to `bankDetails.swiftCode` is reported at that path rather than as a
 * whole replaced sub-document.
 *
 * Arrays are compared as a unit -- knowing that the emergency-contact list
 * changed is enough; a per-element diff would be noise.
 */
export const diffObjects = (before = {}, after = {}, prefix = '') => {
  const changes = [];
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);

  for (const key of keys) {
    if (['_id', '__v', 'createdAt', 'updatedAt', 'id'].includes(key)) continue;

    const path = prefix ? `${prefix}.${key}` : key;
    const from = before?.[key];
    const to = after?.[key];

    const fromIsObject = isPlainObject(from);
    const toIsObject = isPlainObject(to);
    const fromIsEmpty = from === undefined || from === null;
    const toIsEmpty = to === undefined || to === null;

    // Recurse when either side is a nested document and the other is absent,
    // not only when both are present. On a create the `before` side is empty,
    // and treating the whole sub-document as one value would serialise it --
    // putting the fields below into the log verbatim, redaction list bypassed.
    if ((fromIsObject || toIsObject) && (fromIsObject || fromIsEmpty) && (toIsObject || toIsEmpty)) {
      changes.push(...diffObjects(from ?? {}, to ?? {}, path));
      continue;
    }

    const normalizedFrom = normalize(from);
    const normalizedTo = normalize(to);
    if (normalizedFrom === normalizedTo) continue;

    // A national id or account number in a `before` snapshot has simply been
    // copied into a second, longer-lived table.
    //
    // Matched by prefix in both directions as a backstop: `statutory` is
    // redacted because `statutory.nationalIdNumber` is, and so is anything below
    // a redacted path. Belt and braces against a future shape change quietly
    // reopening the leak this check exists to close.
    const redacted = AUDIT_REDACTED_FIELDS.some(
      (field) => path === field || field.startsWith(`${path}.`) || path.startsWith(`${field}.`),
    );

    changes.push({
      field: path,
      from: redacted ? (normalizedFrom === null ? null : REDACTED) : normalizedFrom,
      to: redacted ? (normalizedTo === null ? null : REDACTED) : normalizedTo,
    });
  }

  return changes;
};

const actorFrom = (req) => ({
  actorId: req?.user?.id ?? null,
  actorEmail: req?.user?.email ?? null,
  actorRole: req?.user?.role ?? null,
  ip: req?.ip ?? null,
  userAgent: req?.get?.('User-Agent') ?? null,
  requestId: req?.id ?? null,
});

/**
 * Writes one audit entry.
 *
 * Never throws. An audit failure must not roll back the business operation
 * that succeeded -- it is logged at error level so the gap is visible, which
 * is the honest trade-off between availability and completeness here.
 */
export const recordAudit = async ({
  req,
  entity,
  entityId,
  entityLabel = null,
  action,
  changes = [],
  metadata = null,
}) => {
  try {
    await auditLogRepository.record({
      tenantId: req?.user?.tenantId ?? null,
      entity,
      entityId,
      entityLabel,
      action,
      changes,
      metadata,
      ...actorFrom(req),
      occurredAt: new Date(),
    });
  } catch (error) {
    logger.error('Failed to write audit log', { entity, entityId, action, error: error.message });
  }
};

/** Batch variant for imports and bulk operations. */
export const recordAuditBatch = async ({ req, entries }) => {
  if (!entries?.length) return;

  const actor = actorFrom(req);
  const tenantId = req?.user?.tenantId ?? null;
  const occurredAt = new Date();

  try {
    await auditLogRepository.recordMany(
      entries.map((entry) => ({ tenantId, ...entry, ...actor, occurredAt })),
    );
  } catch (error) {
    logger.error('Failed to write audit batch', { count: entries.length, error: error.message });
  }
};

export default { diffObjects, recordAudit, recordAuditBatch };
