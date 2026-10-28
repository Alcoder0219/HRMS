import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';

/**
 * The scheduled sweep's tenant query.
 *
 * It once projected `biometricDevices` together with `+biometricDevices.password`,
 * which MongoDB 4.4+ rejects as a path collision -- every tick failed with
 * "Biometric sync sweep failed" and no pull device was ever synced on schedule.
 * The device call itself is stubbed: what is under test is that the sweep
 * loads its devices, with the credential a WDMS pull needs.
 *
 * Runs against a THROWAWAY local database and refuses anything else.
 */

const TEST_URI = process.env.MONGODB_TEST_URI_SWEEP ?? 'mongodb://127.0.0.1:27017/hrms_sync_sweep_test';

if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(TEST_URI)) {
  throw new Error(`Refusing to run destructive tests against a non-local database: ${TEST_URI}`);
}

Object.assign(process.env, {
  NODE_ENV: 'test',
  MONGODB_URI: TEST_URI,
  JWT_ACCESS_SECRET: 'test-access-secret',
  JWT_REFRESH_SECRET: 'test-refresh-secret',
  LOG_TO_FILE: 'false',
  LOG_LEVEL: 'error',
});

const mongoose = (await import('mongoose')).default;

let reachable = true;
try {
  await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 2000 });
} catch {
  reachable = false;
}

const { runDueSyncs } = await import('../jobs/biometricSync.job.js');
const { default: biometricSync } = await import('../services/biometric/biometricSync.service.js');
const { AppSettings } = reachable ? await import('../models/index.js') : {};

describe('biometric sync sweep', { skip: !reachable && 'MongoDB is not reachable on localhost' }, () => {
  const original = biometricSync.syncAttendanceLogs;
  const seen = [];

  before(async () => {
    await mongoose.connection.dropDatabase();
    await AppSettings.create({
      tenantId: null,
      biometricDevices: [
        { name: 'WDMS pull', protocol: 'WDMS_API', ipAddress: '10.0.0.5', port: 80, autoSync: true, isActive: true, username: 'wdms', password: 'dummy-device-secret' },
        { name: 'MB360 push', protocol: 'ADMS_PUSH', serialNumber: 'TESTSWEEP0001', autoSync: true, isActive: true },
      ],
    });

    biometricSync.syncAttendanceLogs = async (device) => {
      seen.push(device);
      return { success: true, punchesSynced: 0 };
    };
  });

  after(async () => {
    biometricSync.syncAttendanceLogs = original;
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  test('loads due devices without a projection collision, password included', async () => {
    const summary = await runDueSyncs();

    assert.equal(summary.error, undefined, `the sweep query failed: ${summary.error}`);
    assert.equal(summary.devices, 1);
    assert.equal(summary.succeeded, 1);

    // Only the pull device; an ADMS terminal calls in on its own.
    assert.deepEqual(seen.map((device) => device.name), ['WDMS pull']);
    assert.equal(seen[0].password, 'dummy-device-secret', 'a WDMS pull needs its credential');
  });
});
