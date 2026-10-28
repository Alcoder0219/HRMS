/**
 * Moves stored attendance day keys to midnight in the server's NEW time zone.
 *
 *   TZ=Asia/Kolkata npm run migrate:day-keys -- --timezone=Asia/Kolkata            (preview)
 *   TZ=Asia/Kolkata npm run migrate:day-keys -- --timezone=Asia/Kolkata --apply    (write)
 *
 * Why this exists. An attendance day is keyed by midnight in the SERVER's
 * zone (`startOfDay`), and several lookups match that key exactly. While the
 * backend ran in UTC, every day was stored at 00:00Z. Once it runs in
 * Asia/Kolkata the same calendar day is keyed at 18:30Z the evening before,
 * so an old row is no longer found by an exact lookup -- and editing that day
 * would create a second record for it. Range queries (registers, reports,
 * payroll) are unaffected; exact matches are not.
 *
 * What it changes. Only day keys that sit exactly on a UTC midnight -- which,
 * in any zone with a non-zero offset, can only have been written under UTC --
 * and only to the SAME calendar date at local midnight:
 *
 *   attendances.date        (unique per employee)
 *   compoffs.earnedOn       (one EARNED credit per employee-day)
 *   regularizations.date
 *
 * What it does not change. No figure is recomputed: worked minutes, lateness,
 * overtime and status stay exactly as stored, and so does every timestamp
 * (punches, check-in/out, createdAt). Payroll is not touched. If a row already
 * exists at the new key for the same employee, BOTH are left alone and the
 * pair is reported for a person to resolve -- nothing is merged or deleted.
 *
 * Idempotent: a moved key is no longer on a UTC midnight, so a second run
 * finds nothing. Run it once, right after deploying the revision with TZ set,
 * before anyone edits attendance.
 */
import { fileURLToPath } from 'node:url';

import mongoose from 'mongoose';

const DAY_MS = 86_400_000;

/** The collections and fields that hold a day key, and the field that scopes uniqueness. */
export const DAY_KEY_FIELDS = [
  { collection: 'attendances', field: 'date', uniqueWith: 'employeeId' },
  { collection: 'compoffs', field: 'earnedOn', uniqueWith: 'employeeId' },
  { collection: 'regularizations', field: 'date', uniqueWith: null },
];

/** The same calendar date as a UTC-midnight key, at local midnight in this process's zone. */
export const toLocalDayKey = (utcMidnight) =>
  new Date(utcMidnight.getUTCFullYear(), utcMidnight.getUTCMonth(), utcMidnight.getUTCDate());

/**
 * @param {object}  options
 * @param {boolean} options.apply  write the changes; otherwise only report them
 * @returns {Promise<object>} per-collection counts and any conflicts
 */
export const migrateDayKeys = async ({ apply = false } = {}) => {
  if (new Date().getTimezoneOffset() === 0) {
    throw new Error('This process runs in UTC, so there is nothing to move. Run it with TZ set to the new zone.');
  }

  const database = mongoose.connection.db;
  const present = new Set((await database.listCollections().toArray()).map((entry) => entry.name));
  const report = {};

  for (const { collection, field, uniqueWith } of DAY_KEY_FIELDS) {
    const result = { scanned: 0, toMove: 0, moved: 0, conflicts: [] };
    report[`${collection}.${field}`] = result;
    if (!present.has(collection)) continue;

    const rows = database.collection(collection).find(
      // A UTC midnight: the remainder of the epoch milliseconds by one day is 0.
      { $expr: { $eq: [{ $mod: [{ $toLong: `$${field}` }, DAY_MS] }, 0] } },
      { projection: { [field]: 1, ...(uniqueWith ? { [uniqueWith]: 1 } : {}) } },
    );

    const operations = [];

    for await (const row of rows) {
      result.scanned += 1;
      const target = toLocalDayKey(row[field]);

      if (uniqueWith) {
        const clash = await database
          .collection(collection)
          .findOne({ [uniqueWith]: row[uniqueWith], [field]: target }, { projection: { _id: 1 } });

        if (clash) {
          result.conflicts.push({ keep: String(row._id), existing: String(clash._id), day: target.toISOString() });
          continue;
        }
      }

      result.toMove += 1;
      operations.push({ updateOne: { filter: { _id: row._id, [field]: row[field] }, update: { $set: { [field]: target } } } });
    }

    if (apply && operations.length) {
      for (let offset = 0; offset < operations.length; offset += 500) {
        const written = await database.collection(collection).bulkWrite(operations.slice(offset, offset + 500), { ordered: false });
        result.moved += written.modifiedCount;
      }
    }
  }

  return report;
};

/* ---------------------------------------------------------------- command */

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const { connectDatabase, disconnectDatabase } = await import('../config/database.js');
  const { default: logger } = await import('../config/logger.js');

  const apply = process.argv.includes('--apply');
  const wanted = (process.argv.find((value) => value.startsWith('--timezone=')) ?? '').slice('--timezone='.length);
  const actual = Intl.DateTimeFormat().resolvedOptions().timeZone;

  try {
    // Names the zone twice -- in TZ and on the command line -- so the script
    // cannot run by accident under the zone of whatever shell launched it.
    if (!wanted) throw new Error('Pass --timezone=<the zone TZ is set to>, e.g. --timezone=Asia/Kolkata');

    // Compared in canonical form: ICU reports Asia/Kolkata as its legacy
    // alias Asia/Calcutta, and a plain string comparison would refuse a
    // correctly configured process.
    const canonical = new Intl.DateTimeFormat('en-US', { timeZone: wanted }).resolvedOptions().timeZone;
    if (canonical !== actual) throw new Error(`This process runs in ${actual}, not ${wanted}. Set TZ=${wanted} for this command.`);

    await connectDatabase();
    const report = await migrateDayKeys({ apply });

    logger.info(apply ? 'Day keys moved' : 'Day-key preview (nothing written; add --apply to write)', { timezone: actual, report });
    console.log(JSON.stringify({ timezone: actual, applied: apply, report }, null, 2));

    await disconnectDatabase();
    process.exit(0);
  } catch (error) {
    console.error(`Day-key migration failed: ${error.message}`);
    await disconnectDatabase().catch(() => {});
    process.exit(1);
  }
}
