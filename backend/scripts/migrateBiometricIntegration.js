/**
 * Builds the indexes the biometric integration depends on.
 *
 *   npm run migrate:biometric
 *
 * Production runs with `autoIndex` off (config/database.js), so Mongoose never
 * builds an index on its own there. Most indexes are about speed; one here is
 * about correctness: the UNIQUE index on `biometricevents.dedupKey` is what
 * stops two concurrent deliveries of the same punch -- a terminal retrying
 * while the first request is still in flight, or two Cloud Run instances --
 * from storing it twice. Run this once, before pointing a device at the HRMS.
 *
 * Creates only what is missing: the two new collections' indexes and the
 * serial-number lookup on AppSettings. No document is read or changed, and
 * running it again is a no-op.
 */
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import logger from '../config/logger.js';
import AppSettings from '../models/admin/appSettings.model.js';
import BiometricEvent from '../models/attendance/biometricEvent.model.js';
import BiometricSyncLog from '../models/attendance/biometricSyncLog.model.js';

const run = async () => {
  await connectDatabase();

  // `createIndexes`, not `syncIndexes`: sync would also DROP any index not in
  // the schema, and an operator's hand-made index is not this script's to remove.
  for (const model of [BiometricEvent, BiometricSyncLog, AppSettings]) {
    await model.createIndexes();
    const names = Object.keys(await model.collection.indexInformation());
    logger.info(`Indexes on ${model.collection.collectionName}`, { indexes: names });
  }

  const eventIndexes = await BiometricEvent.collection.indexes();
  const unique = eventIndexes.find((index) => index.key?.dedupKey === 1 && index.unique);
  if (!unique) throw new Error('The unique dedupKey index was not created');

  logger.info('Biometric integration indexes are in place');
};

run()
  .then(() => disconnectDatabase())
  .then(() => process.exit(0))
  .catch(async (error) => {
    logger.error('Biometric migration failed', { error: error.message });
    await disconnectDatabase().catch(() => {});
    process.exit(1);
  });
