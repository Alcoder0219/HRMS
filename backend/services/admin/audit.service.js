import AuditLog from '../../models/audit/auditLog.model.js';
import LoginHistory from '../../models/auth/loginHistory.model.js';
import User from '../../models/auth/user.model.js';

import ApiError from '../../utils/ApiError.js';
import { AUDIT_ACTIONS, LOGIN_EVENTS, LOGIN_STATUS } from '../../utils/constants.js';
import { buildPagination } from '../../utils/queryBuilder.js';

/**
 * Two different questions, two different logs.
 *
 * The audit log answers "what changed" -- every field, its old value and its
 * new one, written by the services as they save. The activity log answers "who
 * was here" -- sign-ins, sign-outs, failures, password changes. They are kept
 * apart because a failed login has no `changes` to show and a salary revision
 * has no `ip` worth reading, and folding them into one collection would make
 * both queries worse.
 *
 * The activity timeline is the union of the two, resolved at read time.
 */

const tenantOf = (req) => req.user?.tenantId ?? null;

const dateRange = (query, field) => {
  const range = {};
  if (query.from) range.$gte = new Date(`${query.from}T00:00:00.000Z`);
  if (query.to) range.$lte = new Date(`${query.to}T23:59:59.999Z`);
  return Object.keys(range).length ? { [field]: range } : {};
};

/**
 * Values in the audit trail are stored as whatever they were -- dates, ids,
 * objects -- and a table needs a string.
 *
 * An ObjectId is rendered as the raw id rather than being resolved to a name:
 * resolving would need a lookup per row against a collection the row may no
 * longer exist in, and a wrong name is worse than an honest id.
 */
const readable = (value) => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if (value._bsontype === 'ObjectId') return String(value);
    return JSON.stringify(value);
  }
  return String(value);
};

const presentAudit = (entry) => ({
  _id: entry._id,
  entity: entry.entity,
  entityId: entry.entityId,
  entityLabel: entry.entityLabel,
  action: entry.action,
  changeCount: (entry.changes ?? []).length,
  changes: (entry.changes ?? []).map((change) => ({
    field: change.field,
    from: readable(change.from),
    to: readable(change.to),
  })),
  metadata: entry.metadata ?? null,
  actorEmail: entry.actorEmail,
  actorRole: entry.actorRole,
  ip: entry.ip,
  // A user agent is 200 characters of browser trivia; the list only needs to
  // distinguish a person from a script.
  source: (entry.userAgent ?? '').toLowerCase().startsWith('node') ? 'API' : 'Browser',
  userAgent: entry.userAgent,
  requestId: entry.requestId,
  occurredAt: entry.occurredAt,
});

const presentLogin = (entry) => ({
  _id: entry._id,
  email: entry.email,
  event: entry.event,
  status: entry.status,
  failureReason: entry.failureReason,
  ip: entry.ip,
  userAgent: entry.userAgent,
  source: (entry.userAgent ?? '').toLowerCase().startsWith('node') ? 'API' : 'Browser',
  occurredAt: entry.occurredAt,
});

/* -------------------------------------------------------------------------- */
/*                                 Audit logs                                 */
/* -------------------------------------------------------------------------- */

export const listAuditLogs = async (query, req) => {
  const { page, limit, skip } = buildPagination(query);

  const filter = { tenantId: tenantOf(req), ...dateRange(query, 'occurredAt') };

  if (query.entity) filter.entity = query.entity;
  if (query.action) filter.action = query.action;
  if (query.actorId) filter.actorId = query.actorId;
  if (query.entityId) filter.entityId = query.entityId;
  if (query.search) filter.entityLabel = { $regex: String(query.search).trim(), $options: 'i' };

  const [items, total] = await Promise.all([
    AuditLog.find(filter).sort({ occurredAt: -1 }).skip(skip).limit(limit).lean(),
    AuditLog.countDocuments(filter),
  ]);

  return { items: items.map(presentAudit), page, limit, total };
};

export const getAuditLog = async (id, req) => {
  const entry = await AuditLog.findOne({ _id: id, tenantId: tenantOf(req) }).lean();
  if (!entry) throw ApiError.notFound('No such audit entry');

  return presentAudit(entry);
};

/**
 * The distinct entity names actually present in the log.
 *
 * Read from the data rather than from a constant, because the audit trail
 * accumulates whatever the services chose to write. A hardcoded list would
 * offer filters that match nothing and miss the ones that do.
 */
export const auditFilters = async (req) => {
  const tenantId = tenantOf(req);

  const [entities, actors] = await Promise.all([
    AuditLog.distinct('entity', { tenantId }),
    AuditLog.aggregate([
      { $match: { tenantId, actorId: { $ne: null } } },
      { $group: { _id: '$actorId', email: { $last: '$actorEmail' }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 50 },
    ]),
  ]);

  return {
    entities: entities.filter(Boolean).sort(),
    actions: Object.values(AUDIT_ACTIONS),
    actors: actors.map((entry) => ({ _id: entry._id, email: entry.email, count: entry.count })),
  };
};

/* -------------------------------------------------------------------------- */
/*                                Login history                               */
/* -------------------------------------------------------------------------- */

/**
 * Org-wide sign-in history.
 *
 * `/auth/login-history` returns the caller's own and is the right endpoint for
 * a profile page. This one is the administrator's view of everybody, which is
 * a separate disclosure and so sits behind a separate permission.
 */
export const listLoginHistory = async (query, req) => {
  const { page, limit, skip } = buildPagination(query);

  const filter = { tenantId: tenantOf(req), ...dateRange(query, 'occurredAt') };

  if (query.status) filter.status = query.status;
  if (query.event) filter.event = query.event;
  if (query.userId) filter.userId = query.userId;
  if (query.search) filter.email = { $regex: String(query.search).trim(), $options: 'i' };

  const [items, total] = await Promise.all([
    LoginHistory.find(filter).sort({ occurredAt: -1 }).skip(skip).limit(limit).lean(),
    LoginHistory.countDocuments(filter),
  ]);

  return { items: items.map(presentLogin), page, limit, total };
};

/* -------------------------------------------------------------------------- */
/*                               Activity feed                                */
/* -------------------------------------------------------------------------- */

/**
 * One chronological feed of everything that happened.
 *
 * Both sources are read with the same window and merged in memory. That is
 * honest about its limits: it over-reads by one page from each side so the
 * merge has enough to fill a page from either, rather than pretending a
 * cross-collection cursor exists. For an operations timeline of recent events
 * -- which is what this screen is -- that is the right trade.
 */
export const activityFeed = async (query, req) => {
  const { page, limit, skip } = buildPagination(query);
  const tenantId = tenantOf(req);

  const window = skip + limit;
  const range = dateRange(query, 'occurredAt');

  const wantsChanges = !query.kind || query.kind === 'CHANGE';
  const wantsAccess = !query.kind || query.kind === 'ACCESS';

  const auditFilter = { tenantId, ...range };
  if (query.actorId) auditFilter.actorId = query.actorId;
  if (query.search) auditFilter.entityLabel = { $regex: String(query.search).trim(), $options: 'i' };

  const loginFilter = { tenantId, ...range };
  if (query.actorId) loginFilter.userId = query.actorId;
  if (query.search) loginFilter.email = { $regex: String(query.search).trim(), $options: 'i' };

  const [changes, access] = await Promise.all([
    wantsChanges ? AuditLog.find(auditFilter).sort({ occurredAt: -1 }).limit(window).lean() : [],
    wantsAccess ? LoginHistory.find(loginFilter).sort({ occurredAt: -1 }).limit(window).lean() : [],
  ]);

  const merged = [
    ...changes.map((entry) => ({
      _id: entry._id,
      kind: 'CHANGE',
      occurredAt: entry.occurredAt,
      actor: entry.actorEmail ?? 'system',
      actorRole: entry.actorRole ?? null,
      action: entry.action,
      summary: `${entry.action} ${entry.entity}${entry.entityLabel ? ` — ${entry.entityLabel}` : ''}`,
      detail: `${(entry.changes ?? []).length} field(s) changed`,
      ip: entry.ip,
      ok: true,
    })),
    ...access.map((entry) => ({
      _id: entry._id,
      kind: 'ACCESS',
      occurredAt: entry.occurredAt,
      actor: entry.email,
      actorRole: null,
      action: entry.event,
      summary: `${entry.event} — ${entry.status}`,
      detail: entry.failureReason ?? null,
      ip: entry.ip,
      ok: entry.status === LOGIN_STATUS.SUCCESS,
    })),
  ].sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt));

  return {
    items: merged.slice(skip, skip + limit),
    page,
    limit,
    // The true total across both collections, so paging is not driven by the
    // truncated window above.
    total: await (async () => {
      const [a, b] = await Promise.all([
        wantsChanges ? AuditLog.countDocuments(auditFilter) : 0,
        wantsAccess ? LoginHistory.countDocuments(loginFilter) : 0,
      ]);
      return a + b;
    })(),
  };
};

/* -------------------------------------------------------------------------- */
/*                                 Statistics                                 */
/* -------------------------------------------------------------------------- */

export const activityStats = async (query, req) => {
  const tenantId = tenantOf(req);
  const days = Math.min(90, Math.max(1, Number(query.days) || 30));
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);

  const [byAction, byEntity, topActors, logins, failures, uniqueUsers, totalUsers] = await Promise.all([
    AuditLog.aggregate([
      { $match: { tenantId, occurredAt: { $gte: since } } },
      { $group: { _id: '$action', count: { $sum: 1 } } },
    ]),
    AuditLog.aggregate([
      { $match: { tenantId, occurredAt: { $gte: since } } },
      { $group: { _id: '$entity', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
    AuditLog.aggregate([
      { $match: { tenantId, occurredAt: { $gte: since }, actorEmail: { $ne: null } } },
      { $group: { _id: '$actorEmail', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
    LoginHistory.countDocuments({
      tenantId,
      occurredAt: { $gte: since },
      event: LOGIN_EVENTS.LOGIN,
      status: LOGIN_STATUS.SUCCESS,
    }),
    LoginHistory.countDocuments({ tenantId, occurredAt: { $gte: since }, status: LOGIN_STATUS.FAILED }),
    LoginHistory.distinct('email', {
      tenantId,
      occurredAt: { $gte: since },
      status: LOGIN_STATUS.SUCCESS,
    }),
    User.countDocuments({ tenantId }),
  ]);

  const changes = byAction.reduce((total, entry) => total + entry.count, 0);

  return {
    days,
    since,
    changes,
    logins,
    failures,
    activeUsers: uniqueUsers.length,
    totalUsers,
    // Accounts that never signed in during the window are the ones worth
    // reviewing -- either dormant or never handed over.
    dormantUsers: Math.max(0, totalUsers - uniqueUsers.length),
    byAction: Object.fromEntries(byAction.map((entry) => [entry._id, entry.count])),
    byEntity: byEntity.map((entry) => ({ entity: entry._id, count: entry.count })),
    topActors: topActors.map((entry) => ({ actor: entry._id, count: entry.count })),
  };
};

export default {
  listAuditLogs,
  getAuditLog,
  auditFilters,
  listLoginHistory,
  activityFeed,
  activityStats,
};
