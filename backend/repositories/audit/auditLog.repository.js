import AuditLog from '../../models/audit/auditLog.model.js';

export const record = (payload) => AuditLog.create(payload);

/** Bulk path for imports, where one row per record would be thousands of writes. */
export const recordMany = (entries) =>
  entries.length ? AuditLog.insertMany(entries, { ordered: false }) : Promise.resolve([]);

export const findForEntity = async (entity, entityId, { page = 1, limit = 20 } = {}) => {
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    AuditLog.find({ entity, entityId }).sort({ occurredAt: -1 }).skip(skip).limit(limit).lean(),
    AuditLog.countDocuments({ entity, entityId }),
  ]);

  return { items, total, page, limit };
};

export const findForTenant = async (tenantId, { page = 1, limit = 50, entity, action, actorId } = {}) => {
  const filter = { tenantId };
  if (entity) filter.entity = entity;
  if (action) filter.action = action;
  if (actorId) filter.actorId = actorId;

  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    AuditLog.find(filter).sort({ occurredAt: -1 }).skip(skip).limit(limit).lean(),
    AuditLog.countDocuments(filter),
  ]);

  return { items, total, page, limit };
};

export default { record, recordMany, findForEntity, findForTenant };
