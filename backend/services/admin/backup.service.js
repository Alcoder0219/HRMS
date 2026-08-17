import mongoose from 'mongoose';

import AppSettings from '../../models/admin/appSettings.model.js';

import ApiError from '../../utils/ApiError.js';
import logger from '../../config/logger.js';
import { AUDIT_ACTIONS } from '../../utils/constants.js';
import { recordAudit } from '../../helpers/audit.helper.js';

/**
 * Backup and restore of a tenant's own data.
 *
 * Restore is the most destructive operation in the product, so the design is
 * built around three rules:
 *
 *   1. It cannot happen by accident. A restore runs only against collections
 *      the archive names, only in a mode the caller chose explicitly, and only
 *      with a confirmation phrase typed by hand.
 *   2. It cannot be discovered by trying it. `dryRun` is the default, and it
 *      reports exactly what would change without touching anything.
 *   3. It cannot lock anyone out. Users, roles and the audit trail are never
 *      restored -- see EXCLUDED below.
 */

/**
 * What a backup contains.
 *
 * Operational data only. Deliberately absent:
 *
 *   users, refreshtokens, verificationtokens -- credentials. A restore that
 *   rolled accounts back would resurrect deleted logins and revive passwords
 *   that were changed for a reason, and an archive containing password hashes
 *   is a liability the moment it leaves the server.
 *
 *   auditlogs, loginhistories -- the record of what happened. An audit trail
 *   that can be replaced from a file is not an audit trail. It only ever grows,
 *   including with an entry for the restore itself.
 */
export const BACKUP_COLLECTIONS = [
  'units',
  'departments',
  'designations',
  'grades',
  'shifts',
  'salarytemplates',
  'holidays',
  'employees',
  'assets',
  'attendances',
  'attendancepolicies',
  'attendancesheets',
  'regularizations',
  'compoffs',
  'leavetypes',
  'leavebalances',
  'leaverequests',
  'salarystructures',
  'payrollsettings',
  'payrollruns',
  'payslips',
  'loans',
  'settlements',
  'jobopenings',
  'candidates',
  'interviews',
  'offers',
];

const EXCLUDED = ['users', 'refreshtokens', 'verificationtokens', 'auditlogs', 'loginhistories'];

/**
 * Bumped whenever the archive's shape changes.
 *
 * A restore refuses an archive it does not recognise rather than guessing: a
 * half-understood file applied to a live database is worse than no restore.
 */
export const ARCHIVE_VERSION = 1;

const tenantOf = (req) => req.user?.tenantId ?? null;

const db = () => {
  const connection = mongoose.connection;
  if (!connection?.db) throw ApiError.badRequest('The database connection is not ready');
  return connection.db;
};

const tenantFilter = (tenantId) => (tenantId ? { tenantId: new mongoose.Types.ObjectId(String(tenantId)) } : { tenantId: null });

/* -------------------------------------------------------------------------- */
/*                                   Backup                                   */
/* -------------------------------------------------------------------------- */

/** Row counts per collection, for the screen to show before anything is downloaded. */
export const backupPreview = async (req) => {
  const tenantId = tenantOf(req);
  const database = db();
  const present = new Set((await database.listCollections().toArray()).map((entry) => entry.name));

  const collections = [];
  let documents = 0;

  for (const name of BACKUP_COLLECTIONS) {
    if (!present.has(name)) continue;

    const count = await database.collection(name).countDocuments(tenantFilter(tenantId));
    documents += count;
    collections.push({ name, count });
  }

  const settings = await AppSettings.findOne({ tenantId }).lean();

  return {
    version: ARCHIVE_VERSION,
    collections: collections.filter((entry) => entry.count > 0),
    emptyCollections: collections.filter((entry) => entry.count === 0).map((entry) => entry.name),
    documents,
    excluded: EXCLUDED,
    lastBackupAt: settings?.lastBackupAt ?? null,
    lastRestoreAt: settings?.lastRestoreAt ?? null,
  };
};

/**
 * The archive itself, as a plain object the controller serialises.
 *
 * Held in memory rather than streamed: this is one tenant's operational data,
 * and the alternative -- a streaming NDJSON writer -- buys nothing until that
 * is large enough to matter, at which point the answer is `mongodump` rather
 * than a bigger version of this.
 */
export const createBackup = async (req) => {
  const tenantId = tenantOf(req);
  const database = db();
  const present = new Set((await database.listCollections().toArray()).map((entry) => entry.name));

  const data = {};
  const counts = {};
  let documents = 0;

  for (const name of BACKUP_COLLECTIONS) {
    if (!present.has(name)) continue;

    const rows = await database.collection(name).find(tenantFilter(tenantId)).toArray();
    if (!rows.length) continue;

    data[name] = rows;
    counts[name] = rows.length;
    documents += rows.length;
  }

  const settings = await AppSettings.findOne({ tenantId });
  if (settings) {
    settings.lastBackupAt = new Date();
    settings.lastBackupBy = req.user?.id ?? null;
    await settings.save();
  }

  await recordAudit({
    req,
    entity: 'Backup',
    entityId: settings?._id ?? new mongoose.Types.ObjectId(),
    entityLabel: `Backup of ${documents} document(s)`,
    action: AUDIT_ACTIONS.EXPORT,
    changes: [],
    metadata: { collections: Object.keys(counts), documents },
  });

  logger.info('Backup created', { tenantId: String(tenantId), documents });

  return {
    meta: {
      version: ARCHIVE_VERSION,
      createdAt: new Date().toISOString(),
      createdBy: req.user?.email ?? null,
      tenantId: tenantId ? String(tenantId) : null,
      documents,
      counts,
      excluded: EXCLUDED,
    },
    data,
  };
};

/* -------------------------------------------------------------------------- */
/*                                   Restore                                  */
/* -------------------------------------------------------------------------- */

export const RESTORE_MODES = {
  /** Insert what is missing, leave everything already present untouched. */
  MERGE: 'MERGE',
  /** Insert what is missing and overwrite documents whose _id matches. */
  OVERWRITE: 'OVERWRITE',
  /** Empty each collection the archive names, then insert. The only destructive one. */
  REPLACE: 'REPLACE',
};

export const CONFIRMATION_PHRASE = 'RESTORE';

const parseArchive = (raw) => {
  let archive = raw;

  if (Buffer.isBuffer(raw) || typeof raw === 'string') {
    try {
      archive = JSON.parse(raw.toString('utf8'));
    } catch {
      throw ApiError.badRequest('That file is not valid JSON');
    }
  }

  if (!archive?.meta || !archive?.data) {
    throw ApiError.badRequest('That file is not an HRMS backup archive');
  }

  if (archive.meta.version !== ARCHIVE_VERSION) {
    throw ApiError.badRequest(
      `This archive is version ${archive.meta.version}; this server reads version ${ARCHIVE_VERSION}`,
    );
  }

  const unknown = Object.keys(archive.data).filter((name) => !BACKUP_COLLECTIONS.includes(name));
  if (unknown.length) {
    // Refused rather than skipped: an archive naming collections this server
    // does not restore is a different product or a tampered file, and either
    // way applying the parts we do recognise would leave a mixed state.
    throw ApiError.badRequest(`The archive contains unsupported collections: ${unknown.join(', ')}`);
  }

  return archive;
};

/**
 * Rewrites every document to belong to the restoring tenant.
 *
 * An archive taken from one tenant and applied to another must not carry the
 * original's tenantId with it, or the restored rows would be invisible to
 * everyone in the tenant that restored them and visible to a tenant that never
 * asked for them.
 */
const retenant = (rows, tenantId) =>
  rows.map((row) => ({
    ...row,
    _id: row._id ? new mongoose.Types.ObjectId(String(row._id)) : new mongoose.Types.ObjectId(),
    tenantId: tenantId ? new mongoose.Types.ObjectId(String(tenantId)) : null,
  }));

/**
 * Applies an archive, or reports what applying it would do.
 *
 * `dryRun` defaults to true at the validator, so the destructive path is
 * always something the caller asked for by name.
 */
export const restoreBackup = async (rawArchive, options, req) => {
  const { mode = RESTORE_MODES.MERGE, dryRun = true, confirm = null } = options ?? {};
  const tenantId = tenantOf(req);

  const archive = parseArchive(rawArchive);
  const database = db();

  if (!dryRun && confirm !== CONFIRMATION_PHRASE) {
    throw ApiError.badRequest(`Type ${CONFIRMATION_PHRASE} to confirm a restore`);
  }

  const settings = await AppSettings.findOne({ tenantId });

  // Two restores at once would interleave their deletes and inserts. The flag
  // is cleared in the finally below, including when the restore throws.
  if (!dryRun && settings?.maintenanceMode) {
    throw ApiError.conflict('A restore is already running');
  }

  if (!dryRun && settings) {
    settings.maintenanceMode = true;
    settings.maintenanceMessage = 'A restore is in progress';
    await settings.save();
  }

  const report = [];
  let inserted = 0;
  let updated = 0;
  let removed = 0;
  let skipped = 0;

  try {
    for (const [name, rows] of Object.entries(archive.data)) {
      if (!Array.isArray(rows) || !rows.length) continue;

      const collection = database.collection(name);
      const documents = retenant(rows, tenantId);
      const ids = documents.map((row) => row._id);

      const existingIds = new Set(
        (await collection.find({ ...tenantFilter(tenantId), _id: { $in: ids } }, { projection: { _id: 1 } }).toArray()).map(
          (row) => String(row._id),
        ),
      );

      const current = await collection.countDocuments(tenantFilter(tenantId));

      const willInsert = documents.filter((row) => !existingIds.has(String(row._id))).length;
      const willUpdate = mode === RESTORE_MODES.MERGE ? 0 : existingIds.size;
      const willRemove = mode === RESTORE_MODES.REPLACE ? current : 0;
      const willSkip = mode === RESTORE_MODES.MERGE ? existingIds.size : 0;

      report.push({
        collection: name,
        inArchive: documents.length,
        currentlyPresent: current,
        toInsert: willInsert,
        toUpdate: willUpdate,
        toRemove: willRemove,
        toSkip: willSkip,
      });

      inserted += willInsert;
      updated += willUpdate;
      removed += willRemove;
      skipped += willSkip;

      if (dryRun) continue;

      if (mode === RESTORE_MODES.REPLACE) {
        // Scoped to this tenant. A bare deleteMany({}) here would take another
        // customer's data with it.
        await collection.deleteMany(tenantFilter(tenantId));
      }

      const operations = documents.map((row) => {
        if (mode === RESTORE_MODES.MERGE) {
          return { updateOne: { filter: { _id: row._id }, update: { $setOnInsert: row }, upsert: true } };
        }
        return { replaceOne: { filter: { _id: row._id }, replacement: row, upsert: true } };
      });

      // MongoDB here is standalone, so there is no transaction to wrap this in.
      // `ordered: false` at least means one bad document does not abandon the
      // rest of the collection, and the report says exactly what landed.
      if (operations.length) await collection.bulkWrite(operations, { ordered: false });
    }

    if (!dryRun) {
      if (settings) {
        settings.lastRestoreAt = new Date();
        settings.lastRestoreBy = req.user?.id ?? null;
        await settings.save();
      }

      await recordAudit({
        req,
        entity: 'Restore',
        entityId: settings?._id ?? new mongoose.Types.ObjectId(),
        entityLabel: `Restore (${mode})`,
        action: AUDIT_ACTIONS.RESTORE,
        changes: [],
        metadata: {
          mode,
          archivedAt: archive.meta.createdAt,
          archivedBy: archive.meta.createdBy,
          inserted,
          updated,
          removed,
          collections: report.map((entry) => entry.collection),
        },
      });

      logger.warn('Restore applied', { tenantId: String(tenantId), mode, inserted, updated, removed });
    }
  } finally {
    if (!dryRun && settings) {
      settings.maintenanceMode = false;
      settings.maintenanceMessage = null;
      await settings.save();
    }
  }

  return {
    dryRun,
    mode,
    archive: {
      version: archive.meta.version,
      createdAt: archive.meta.createdAt,
      createdBy: archive.meta.createdBy,
      documents: archive.meta.documents ?? null,
    },
    totals: { inserted, updated, removed, skipped },
    report,
    excluded: EXCLUDED,
  };
};

export default {
  BACKUP_COLLECTIONS,
  ARCHIVE_VERSION,
  RESTORE_MODES,
  CONFIRMATION_PHRASE,
  backupPreview,
  createBackup,
  restoreBackup,
};
