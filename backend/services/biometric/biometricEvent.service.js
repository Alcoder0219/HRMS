import mongoose from 'mongoose';

import logger from '../../config/logger.js';
import BiometricEvent, { BIOMETRIC_EVENT_STATUS as STATUS } from '../../models/attendance/biometricEvent.model.js';
import BiometricSyncLog from '../../models/attendance/biometricSyncLog.model.js';
import { buildDedupKey } from '../../helpers/adms.helper.js';
import { ingestBiometric, PUNCH_OUTCOME } from '../attendance/attendanceIngest.service.js';

/**
 * The raw-event layer every biometric punch passes through.
 *
 * Every transport -- an ADMS push, a scheduled SDK/web/WDMS pull, a reprocess --
 * ends here, and here does three things in order:
 *
 *   1. STORE the punch as the device reported it, under a deduplication key.
 *      The unique index on that key is the guarantee that a retry, a re-upload
 *      or two instances racing on the same request never produce two rows.
 *   2. APPLY only the punches that were new, through `ingestBiometric` -- the
 *      one path that writes attendance -- so no transport computes a day itself.
 *   3. RECORD on each event what became of it, and on a sync log what became of
 *      the batch.
 *
 * Unmapped and held punches are therefore never lost: they sit here with a
 * reason until a mapping exists or someone decides, and Reprocess applies them.
 */

/** A batch larger than this is applied in slices, so one request cannot hold the loop. */
const APPLY_CHUNK = 500;

/** Reprocess works through at most this many events per run. */
const REPROCESS_LIMIT = 5000;

/** Error text kept on a sync log: enough to diagnose, never a dump. */
const MAX_LOGGED_ERRORS = 20;

/**
 * ZKTeco punch states, as the device records them.
 *
 * The break and overtime pairs collapse onto IN and OUT: attendance here is
 * first-punch-to-last-punch for the day, so a break-out is an exit and a
 * break-in is an entry, and modelling them as a third state would mean
 * teaching the whole attendance engine about a distinction it does not use.
 */
export const ZK_PUNCH_TYPES = {
  0: 'IN', // Check-In
  1: 'OUT', // Check-Out
  2: 'OUT', // Break-Out
  3: 'IN', // Break-In
  4: 'IN', // Overtime-In
  5: 'OUT', // Overtime-Out
};

/**
 * A device punch type mapped to the direction the attendance model stores.
 *
 * Anything unrecognised -- and anything absent -- becomes UNKNOWN rather than
 * being guessed at. That is a safe answer here: `reducePunches` derives check-in
 * and check-out from the punch TIMES and reads the direction labels only to
 * detect a contradiction, so an unlabelled punch computes the same day as a
 * labelled one. Guessing would instead risk inventing the contradiction.
 */
export const mapPunchDirection = (punchType) => {
  if (punchType === null || punchType === undefined || punchType === '') return 'UNKNOWN';

  const code = Number(punchType);
  return Number.isFinite(code) ? (ZK_PUNCH_TYPES[code] ?? 'UNKNOWN') : 'UNKNOWN';
};

/**
 * The request context an unattended sync acts under.
 *
 * `ingestBiometric` reads `req.user.tenantId` and stamps `req.user.id` on the
 * rows it creates, so it needs a user of some kind. There is no logged-in
 * person behind a scheduled sync or a device push, so the id is null and the
 * role says SYSTEM -- which is what the audit trail should show. Inventing a
 * user id here would attribute machine-made records to somebody who was asleep.
 */
export const systemContext = (tenantId) => ({
  user: { id: null, tenantId: tenantId ?? null, email: 'system@biometric-sync', role: 'SYSTEM' },
  // `recordAudit` reaches for these; they are optional-chained, but a stub
  // keeps the shape honest for anything that is not.
  ip: null,
  get: () => null,
});

/** The identifier stamped on every attendance punch from this device. */
export const deviceKeyOf = (device) => device.serialNumber || String(device._id);

const emptyCounts = () => ({
  received: 0,
  imported: 0,
  duplicate: 0,
  unmapped: 0,
  held: 0,
  ignored: 0,
  rejected: 0,
  failed: 0,
  daysUpdated: 0,
});

/* -------------------------------------------------------------------------- */
/*                                    Store                                   */
/* -------------------------------------------------------------------------- */

/**
 * Inserts what is new and reports which rows those were.
 *
 * An upsert per event with `$setOnInsert`, so an existing row is never
 * modified by a re-delivery -- its status in particular is not reset. Unordered,
 * so one bad row does not stop the rest.
 *
 * A duplicate-key error is not a failure here. Two requests carrying the same
 * punch can both decide to insert it at the same moment; the index lets one
 * win, and the loser's row is exactly a duplicate.
 */
const insertNew = async (docs) => {
  if (!docs.length) return [];

  const operations = docs.map((doc) => ({
    updateOne: { filter: { dedupKey: doc.dedupKey }, update: { $setOnInsert: doc }, upsert: true },
  }));

  let result;
  try {
    result = await BiometricEvent.bulkWrite(operations, { ordered: false });
  } catch (error) {
    const writeErrors = error.writeErrors ?? [];
    const onlyDuplicates = writeErrors.length > 0 && writeErrors.every((entry) => (entry.code ?? entry.err?.code) === 11000);
    if (!onlyDuplicates || !error.result) throw error;
    result = error.result;
  }

  const upserted = result.upsertedIds ?? {};
  return Object.entries(upserted).map(([index, id]) => ({ ...docs[Number(index)], _id: id }));
};

/* -------------------------------------------------------------------------- */
/*                                    Apply                                   */
/* -------------------------------------------------------------------------- */

const OUTCOME_TO_STATUS = {
  [PUNCH_OUTCOME.IMPORTED]: STATUS.IMPORTED,
  // Already on the day -- usually because the same terminal is ALSO pulled
  // over another transport. The punch is in attendance, which is what
  // IMPORTED means.
  [PUNCH_OUTCOME.DUPLICATE]: STATUS.IMPORTED,
  [PUNCH_OUTCOME.HELD]: STATUS.HELD,
  [PUNCH_OUTCOME.FAILED]: STATUS.FAILED,
  [PUNCH_OUTCOME.INVALID]: STATUS.FAILED,
  // Mapped, but to a code with no active employee behind it -- a leaver, or a
  // typo. Back in the review queue, which is where it can be fixed.
  [PUNCH_OUTCOME.UNKNOWN_EMPLOYEE]: STATUS.UNMAPPED,
};

/**
 * Hands PENDING events to the attendance engine and records each outcome.
 *
 * @returns {object} counts by outcome, plus `errors`
 */
const applyEvents = async (events, { device, req, allowCorrectedDays = false }) => {
  const counts = { imported: 0, held: 0, failed: 0, unmapped: 0, daysUpdated: 0, unknownEmployeeCodes: new Set() };
  const errors = [];

  for (let offset = 0; offset < events.length; offset += APPLY_CHUNK) {
    const slice = events.slice(offset, offset + APPLY_CHUNK);
    const now = new Date();
    let outcomes;

    try {
      const result = await ingestBiometric(
        {
          deviceId: deviceKeyOf(device),
          punches: slice.map((event) => ({
            employeeCode: event.employeeCode,
            timestamp: event.punchTime,
            direction: event.direction,
            ref: String(event._id),
          })),
          // On an unattended sync there is no user for the audit entry to point
          // at, and `entityId` is required -- so it points at the device.
          auditEntityId: device._id,
          allowCorrectedDays,
        },
        req,
      );

      outcomes = result.outcomes;
      counts.daysUpdated += result.daysUpdated;
      (result.unknownEmployeeCodes ?? []).forEach((code) => counts.unknownEmployeeCodes.add(code));
      errors.push(...(result.failures ?? []).map((failure) => failure.error));
    } catch (error) {
      // The whole slice failed before any per-punch outcome existed -- the
      // database went away, typically. Every event in it stays retryable.
      logger.error('Biometric event batch failed to apply', { device: device.name, error: error.message });
      errors.push(error.message);
      outcomes = slice.map((event) => ({ ref: String(event._id), status: PUNCH_OUTCOME.FAILED, reason: error.message }));
    }

    const byRef = new Map(outcomes.map((outcome) => [outcome.ref, outcome]));

    await BiometricEvent.bulkWrite(
      slice.map((event) => {
        const outcome = byRef.get(String(event._id)) ?? { status: PUNCH_OUTCOME.FAILED, reason: 'No outcome reported' };
        const status = OUTCOME_TO_STATUS[outcome.status] ?? STATUS.FAILED;

        if (status === STATUS.IMPORTED) counts.imported += 1;
        else if (status === STATUS.HELD) counts.held += 1;
        else if (status === STATUS.UNMAPPED) counts.unmapped += 1;
        else counts.failed += 1;

        return {
          updateOne: {
            filter: { _id: event._id },
            update: {
              $set: {
                status,
                statusReason: outcome.reason ? String(outcome.reason).slice(0, 300) : null,
                attendanceDate: outcome.attendanceDate ?? null,
                employeeId: outcome.employeeId ?? null,
                processedAt: now,
              },
              $inc: { attempts: 1 },
            },
          },
        };
      }),
      { ordered: false },
    );
  }

  return { ...counts, unknownEmployeeCodes: [...counts.unknownEmployeeCodes], errors };
};

/** Appends a sync log. Never allowed to fail the request it describes. */
const writeLog = async ({ errors = [], ...entry }) => {
  try {
    await BiometricSyncLog.create({
      ...entry,
      errorMessages: [...new Set(errors)].slice(0, MAX_LOGGED_ERRORS).map((text) => String(text).slice(0, 300)),
    });
  } catch (error) {
    logger.warn('Could not write a biometric sync log', { error: error.message });
  }
};

/* -------------------------------------------------------------------------- */
/*                                   Ingest                                   */
/* -------------------------------------------------------------------------- */

/**
 * Stores a batch of device punches and applies the new ones.
 *
 * @param {object}   input
 * @param {object}   input.device     The device row (mappings and accept-from are read from it)
 * @param {string}   input.transport  ADMS_PUSH, ZK_UDP, WDMS_API, ...
 * @param {string}   input.kind       PUSH or PULL, for the sync log
 * @param {object[]} input.logs       `{ deviceUserId, timestamp, punchType, verifyMode?, workCode?, deviceLocalTime? }`
 * @param {object[]} input.rejected   Lines that failed validation upstream, `{ line, reason }`
 * @param {object}   input.req        Acting request, or null for an unattended one
 */
export const recordAndApply = async ({
  tenantId,
  device,
  transport,
  kind,
  logs = [],
  rejected = [],
  req = null,
  remoteIp = null,
}) => {
  const startedAt = Date.now();
  const actor = req ?? systemContext(tenantId);
  const counts = emptyCounts();
  counts.received = logs.length + rejected.length;
  counts.rejected = rejected.length;

  const mappings = new Map((device.userMappings ?? []).map((entry) => [String(entry.deviceUserId), entry.employeeCode]));
  const acceptFrom = device.acceptPunchesFrom ? new Date(device.acceptPunchesFrom) : null;
  const deviceKey = deviceKeyOf(device);

  const docs = logs.map((log) => {
    const employeeCode = mappings.get(String(log.deviceUserId)) ?? null;

    let status = STATUS.PENDING;
    let statusReason = null;

    if (!employeeCode) {
      status = STATUS.UNMAPPED;
      statusReason = 'No employee is mapped to this device user ID';
    } else if (acceptFrom && log.timestamp < acceptFrom) {
      status = STATUS.IGNORED;
      statusReason = 'Earlier than the device’s accept-punches-from date';
    }

    return {
      tenantId: tenantId ?? null,
      deviceId: device._id,
      deviceSerial: device.serialNumber ?? null,
      transport,
      deviceUserId: String(log.deviceUserId),
      employeeCode,
      punchTime: log.timestamp,
      deviceLocalTime: log.deviceLocalTime ?? null,
      punchType: Number.isFinite(log.punchType) ? log.punchType : null,
      direction: mapPunchDirection(log.punchType),
      verifyMode: Number.isFinite(log.verifyMode) ? log.verifyMode : null,
      workCode: log.workCode ?? null,
      dedupKey: buildDedupKey({ tenantId, deviceKey, deviceUserId: log.deviceUserId, timestamp: log.timestamp }),
      status,
      statusReason,
      receivedAt: new Date(),
    };
  });

  const inserted = await insertNew(docs);
  counts.duplicate = docs.length - inserted.length;
  counts.unmapped = inserted.filter((doc) => doc.status === STATUS.UNMAPPED).length;
  counts.ignored = inserted.filter((doc) => doc.status === STATUS.IGNORED).length;

  const pending = inserted.filter((doc) => doc.status === STATUS.PENDING);
  const errors = rejected.map((entry) => `Line ${entry.line}: ${entry.reason}`);
  let unknownEmployeeCodes = [];

  if (pending.length) {
    const applied = await applyEvents(pending, { device, req: actor });
    counts.imported = applied.imported;
    counts.held = applied.held;
    counts.failed = applied.failed;
    counts.unmapped += applied.unmapped;
    counts.daysUpdated = applied.daysUpdated;
    unknownEmployeeCodes = applied.unknownEmployeeCodes;
    errors.push(...applied.errors);
  }

  const unmappedUserIds = [
    ...new Set(inserted.filter((doc) => doc.status === STATUS.UNMAPPED).map((doc) => doc.deviceUserId)),
  ];

  await writeLog({
    tenantId: tenantId ?? null,
    deviceId: device._id,
    deviceSerial: device.serialNumber ?? null,
    kind,
    transport,
    success: counts.failed === 0,
    ...counts,
    errors,
    message: `${counts.imported} imported, ${counts.duplicate} duplicate, ${counts.unmapped} unmapped, ${counts.held} held, ${counts.rejected} rejected`,
    remoteIp,
    triggeredBy: req?.user?.id ?? null,
    durationMs: Date.now() - startedAt,
  });

  const newest = docs.reduce((latest, doc) => (!latest || doc.punchTime > latest ? doc.punchTime : latest), null);

  return { ...counts, unmappedUserIds, unknownEmployeeCodes, errors, newestPunchTime: newest };
};

/* -------------------------------------------------------------------------- */
/*                                  Reprocess                                 */
/* -------------------------------------------------------------------------- */

/**
 * Re-applies stored events that did not make it into attendance.
 *
 * The normal use is the one this whole layer exists for: a punch arrived before
 * its enrolment was mapped, the mapping now exists, and the punch should count.
 *
 * UNMAPPED events are re-resolved against the CURRENT mappings. IGNORED events
 * are re-checked against the CURRENT accept-from date, so importing a backlog
 * means back-dating that date first -- a deliberate act, not a side effect.
 * HELD events are only included on request, and then go through with
 * `allowCorrectedDays`: the administrator has decided the punch should replace
 * a correction. Locked days stay held regardless; unlocking is a payroll act.
 */
export const reprocessEvents = async ({
  tenantId,
  device,
  includeHeld = false,
  includeIgnored = false,
  from = null,
  to = null,
  req,
}) => {
  const startedAt = Date.now();
  const statuses = [STATUS.UNMAPPED, STATUS.FAILED, STATUS.PENDING];
  if (includeHeld) statuses.push(STATUS.HELD);
  if (includeIgnored) statuses.push(STATUS.IGNORED);

  const filter = { tenantId: tenantId ?? null, deviceId: device._id, status: { $in: statuses } };
  if (from || to) {
    filter.punchTime = {};
    if (from) filter.punchTime.$gte = new Date(from);
    if (to) filter.punchTime.$lte = new Date(to);
  }

  const events = await BiometricEvent.find(filter).sort({ punchTime: 1 }).limit(REPROCESS_LIMIT).lean();

  const mappings = new Map((device.userMappings ?? []).map((entry) => [String(entry.deviceUserId), entry.employeeCode]));
  const acceptFrom = device.acceptPunchesFrom ? new Date(device.acceptPunchesFrom) : null;

  const counts = emptyCounts();
  counts.received = events.length;

  const ready = [];
  const stillBlocked = [];

  events.forEach((event) => {
    const employeeCode = mappings.get(event.deviceUserId) ?? null;

    if (!employeeCode) {
      stillBlocked.push({ _id: event._id, status: STATUS.UNMAPPED, reason: 'No employee is mapped to this device user ID' });
      return;
    }
    if (acceptFrom && event.punchTime < acceptFrom) {
      stillBlocked.push({ _id: event._id, status: STATUS.IGNORED, reason: 'Earlier than the device’s accept-punches-from date' });
      return;
    }

    ready.push({ ...event, employeeCode });
  });

  if (stillBlocked.length) {
    await BiometricEvent.bulkWrite(
      stillBlocked.map((entry) => ({
        updateOne: { filter: { _id: entry._id }, update: { $set: { status: entry.status, statusReason: entry.reason } } },
      })),
      { ordered: false },
    );
  }

  counts.unmapped = stillBlocked.filter((entry) => entry.status === STATUS.UNMAPPED).length;
  counts.ignored = stillBlocked.filter((entry) => entry.status === STATUS.IGNORED).length;

  const errors = [];

  if (ready.length) {
    // The mapping may have changed since the event was stored.
    await BiometricEvent.bulkWrite(
      ready.map((event) => ({
        updateOne: {
          filter: { _id: event._id },
          update: { $set: { employeeCode: event.employeeCode, status: STATUS.PENDING } },
        },
      })),
      { ordered: false },
    );

    const applied = await applyEvents(ready, { device, req, allowCorrectedDays: includeHeld });
    counts.imported = applied.imported;
    counts.held = applied.held;
    counts.failed = applied.failed;
    counts.unmapped += applied.unmapped;
    counts.daysUpdated = applied.daysUpdated;
    errors.push(...applied.errors);
  }

  await writeLog({
    tenantId: tenantId ?? null,
    deviceId: device._id,
    deviceSerial: device.serialNumber ?? null,
    kind: 'REPROCESS',
    transport: device.protocol,
    success: counts.failed === 0,
    ...counts,
    errors,
    message: `Reprocessed ${events.length} event(s): ${counts.imported} imported, ${counts.unmapped} still unmapped, ${counts.held} held`,
    triggeredBy: req?.user?.id ?? null,
    durationMs: Date.now() - startedAt,
  });

  return { ...counts, limited: events.length === REPROCESS_LIMIT, errors };
};

/* -------------------------------------------------------------------------- */
/*                                    Reads                                   */
/* -------------------------------------------------------------------------- */

const toObjectId = (value) => (value instanceof mongoose.Types.ObjectId ? value : new mongoose.Types.ObjectId(String(value)));

/**
 * The counters behind the device status panel.
 *
 * Event counts are exact and all-time -- they are rows. Duplicate and rejected
 * counts are not rows, so they come from the sync logs, which are kept for 90
 * days; the panel says so.
 */
export const deviceStats = async (tenantId, deviceId) => {
  const match = { tenantId: tenantId ?? null, deviceId: toObjectId(deviceId) };

  const [byStatus, lastEvent, logTotals, lastSuccess] = await Promise.all([
    BiometricEvent.aggregate([{ $match: match }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    BiometricEvent.findOne(match)
      .sort({ punchTime: -1 })
      .select('deviceUserId employeeCode punchTime deviceLocalTime direction status receivedAt')
      .lean(),
    BiometricSyncLog.aggregate([
      { $match: match },
      { $group: { _id: null, duplicate: { $sum: '$duplicate' }, rejected: { $sum: '$rejected' } } },
    ]),
    BiometricSyncLog.findOne({ ...match, success: true, kind: { $in: ['PUSH', 'PULL'] } })
      .sort({ createdAt: -1 })
      .select('createdAt kind')
      .lean(),
  ]);

  const counts = Object.fromEntries(Object.values(STATUS).map((status) => [status, 0]));
  byStatus.forEach((row) => {
    counts[row._id] = row.count;
  });

  return {
    totalEvents: Object.values(counts).reduce((sum, value) => sum + value, 0),
    imported: counts.IMPORTED,
    unmapped: counts.UNMAPPED,
    held: counts.HELD,
    ignored: counts.IGNORED,
    failed: counts.FAILED + counts.PENDING,
    duplicateLast90Days: logTotals[0]?.duplicate ?? 0,
    rejectedLast90Days: logTotals[0]?.rejected ?? 0,
    lastEvent: lastEvent ?? null,
    lastSuccessfulSyncAt: lastSuccess?.createdAt ?? null,
  };
};

const page = ({ page: pageNumber = 1, limit = 25 }) => {
  const size = Math.min(Math.max(Number(limit) || 25, 1), 200);
  const current = Math.max(Number(pageNumber) || 1, 1);
  return { size, current, skip: (current - 1) * size };
};

export const listEvents = async (tenantId, deviceId, { status = null, from = null, to = null, ...paging } = {}) => {
  const filter = { tenantId: tenantId ?? null, deviceId: toObjectId(deviceId) };
  if (status) filter.status = status;
  if (from || to) {
    filter.punchTime = {};
    if (from) filter.punchTime.$gte = new Date(from);
    if (to) filter.punchTime.$lte = new Date(to);
  }

  const { size, current, skip } = page(paging);

  const [items, total] = await Promise.all([
    BiometricEvent.find(filter)
      .sort({ punchTime: -1 })
      .skip(skip)
      .limit(size)
      .select('-dedupKey -tenantId')
      .lean(),
    BiometricEvent.countDocuments(filter),
  ]);

  return { items, total, page: current, limit: size };
};

export const listLogs = async (tenantId, deviceId, paging = {}) => {
  const filter = { tenantId: tenantId ?? null, deviceId: toObjectId(deviceId) };
  const { size, current, skip } = page(paging);

  const [items, total] = await Promise.all([
    BiometricSyncLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(size).select('-tenantId').lean(),
    BiometricSyncLog.countDocuments(filter),
  ]);

  return { items, total, page: current, limit: size };
};

/**
 * The review queue: device user IDs that have punched but map to nobody.
 *
 * One row per ID rather than per punch -- the action is "map this person", not
 * "look at their 40 punches".
 */
export const unmappedUsers = async (tenantId, deviceId) =>
  BiometricEvent.aggregate([
    { $match: { tenantId: tenantId ?? null, deviceId: toObjectId(deviceId), status: STATUS.UNMAPPED } },
    {
      $group: {
        _id: '$deviceUserId',
        punches: { $sum: 1 },
        firstPunchAt: { $min: '$punchTime' },
        lastPunchAt: { $max: '$punchTime' },
      },
    },
    { $sort: { lastPunchAt: -1 } },
    { $limit: 1000 },
    { $project: { _id: 0, deviceUserId: '$_id', punches: 1, firstPunchAt: 1, lastPunchAt: 1 } },
  ]);

/**
 * Event counters for every device of a tenant, in one aggregation.
 *
 * Feeds the device LIST, where a row per device needs its totals without a
 * status request per row. Keyed by device id.
 */
export const countsByDevice = async (tenantId) => {
  const rows = await BiometricEvent.aggregate([
    { $match: { tenantId: tenantId ?? null } },
    { $group: { _id: { deviceId: '$deviceId', status: '$status' }, count: { $sum: 1 } } },
  ]);

  const byDevice = new Map();
  rows.forEach(({ _id, count }) => {
    const key = String(_id.deviceId);
    const entry = byDevice.get(key) ?? { received: 0, imported: 0, unmapped: 0, held: 0, ignored: 0, failed: 0 };
    entry.received += count;
    if (_id.status === STATUS.IMPORTED) entry.imported += count;
    else if (_id.status === STATUS.UNMAPPED) entry.unmapped += count;
    else if (_id.status === STATUS.HELD) entry.held += count;
    else if (_id.status === STATUS.IGNORED) entry.ignored += count;
    else entry.failed += count;
    byDevice.set(key, entry);
  });

  return byDevice;
};

/** Device user IDs seen in events, for an ADMS device that has not reported its roster. */
export const seenDeviceUserIds = async (tenantId, deviceId) =>
  BiometricEvent.distinct('deviceUserId', { tenantId: tenantId ?? null, deviceId: toObjectId(deviceId) });

export default {
  recordAndApply,
  reprocessEvents,
  deviceStats,
  listEvents,
  listLogs,
  unmappedUsers,
  seenDeviceUserIds,
  countsByDevice,
  mapPunchDirection,
  systemContext,
  deviceKeyOf,
  ZK_PUNCH_TYPES,
};
