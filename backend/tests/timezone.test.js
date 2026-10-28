import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';

/**
 * The server time zone, as the attendance module experiences it: the warning
 * on the settings screen, the day key and shift times, and the one-off move of
 * day keys written while the server ran in UTC.
 *
 * Node re-reads process.env.TZ when it changes, which is what lets one process
 * stand in for both the old (UTC) and the new (Asia/Kolkata) deployment.
 * Runs against a THROWAWAY local database and refuses anything else.
 */

const TEST_URI = process.env.MONGODB_TEST_URI_TZ ?? 'mongodb://127.0.0.1:27017/hrms_timezone_test';

if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(TEST_URI)) {
  throw new Error(`Refusing to run destructive tests against a non-local database: ${TEST_URI}`);
}

Object.assign(process.env, {
  TZ: 'UTC',
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

const { startOfDay, timeOnDate } = await import('../helpers/attendanceRules.helper.js');
const { migrateDayKeys } = await import('../scripts/migrateDayKeysToTimezone.js');
const deviceService = reachable ? (await import('../services/admin/biometricDevice.service.js')).default : null;
const { AppSettings } = reachable ? await import('../models/index.js') : {};
const attendanceRepository = reachable ? (await import('../repositories/attendance/attendance.repository.js')).default : null;

const adminReq = { user: { id: null, tenantId: null, role: 'SUPER_ADMIN' } };
const useZone = (zone) => {
  process.env.TZ = zone;
};

describe('server time zone', { skip: !reachable && 'MongoDB is not reachable on localhost' }, () => {
  before(async () => {
    await mongoose.connection.dropDatabase();
    await AppSettings.create({ tenantId: null, company: { timezone: 'Asia/Kolkata' } });
  });

  after(async () => {
    useZone('UTC');
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  test('warns while the server runs in UTC for an Asia/Kolkata company', async () => {
    useZone('UTC');
    const { time } = await deviceService.integrationStatus(adminReq);

    assert.equal(time.serverUtcOffsetMinutes, 0);
    assert.equal(time.warnings.length, 1);
    assert.match(time.warnings[0], /set TZ=Asia\/Kolkata/);
  });

  test('the warning clears on its own once the server really runs in Asia/Kolkata', async () => {
    useZone('Asia/Kolkata');
    const { time } = await deviceService.integrationStatus(adminReq);

    // ICU may report the zone by its legacy alias; the offset is what is compared.
    assert.ok(['Asia/Kolkata', 'Asia/Calcutta'].includes(time.serverTimeZone), time.serverTimeZone);
    assert.equal(time.serverUtcOffsetMinutes, 330);
    assert.deepEqual(time.warnings, []);
  });

  test('a mismatched company zone still warns -- the check is not hardcoded', async () => {
    useZone('Asia/Kolkata');
    await AppSettings.updateOne({ tenantId: null }, { $set: { 'company.timezone': 'Africa/Dar_es_Salaam' } });
    const { time } = await deviceService.integrationStatus(adminReq);
    assert.equal(time.warnings.length, 1);
    await AppSettings.updateOne({ tenantId: null }, { $set: { 'company.timezone': 'Asia/Kolkata' } });
  });

  test('day key and shift times follow the zone; stored instants stay UTC', () => {
    const punch = new Date('2026-10-28T10:00:00Z'); // 15:30 IST

    useZone('UTC');
    assert.equal(startOfDay(punch).toISOString(), '2026-10-28T00:00:00.000Z');
    assert.equal(timeOnDate(startOfDay(punch), '09:00').toISOString(), '2026-10-28T09:00:00.000Z'); // 14:30 IST -- wrong for the office

    useZone('Asia/Kolkata');
    assert.equal(startOfDay(punch).toISOString(), '2026-10-27T18:30:00.000Z'); // IST midnight, as a UTC instant
    assert.equal(timeOnDate(startOfDay(punch), '09:00').toISOString(), '2026-10-28T03:30:00.000Z'); // 09:00 IST
  });

  test('moves UTC-era day keys to IST midnight: previews first, never merges a clash, then does nothing', async () => {
    const db = mongoose.connection.db;
    const [alice, bob] = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
    const utcDay = new Date('2026-10-20T00:00:00Z');
    const istDay = new Date('2026-10-19T18:30:00Z');

    const { insertedIds } = await db.collection('attendances').insertMany([
      { employeeId: alice, date: utcDay, status: 'PRESENT', workedMinutes: 500, lateMinutes: 12 },
      // Bob already has a row at the new key -- the move must not touch either.
      { employeeId: bob, date: utcDay, status: 'PRESENT', workedMinutes: 480 },
      { employeeId: bob, date: istDay, status: 'ABSENT', workedMinutes: 0 },
    ]);
    await db.collection('compoffs').insertOne({ employeeId: alice, earnedOn: utcDay, status: 'EARNED', days: 1 });
    await db.collection('regularizations').insertOne({ employeeId: alice, date: utcDay, status: 'APPROVED' });

    useZone('Asia/Kolkata');

    const preview = await migrateDayKeys({ apply: false });
    assert.equal(preview['attendances.date'].toMove, 1);
    assert.equal(preview['attendances.date'].conflicts.length, 1);
    assert.equal(preview['compoffs.earnedOn'].toMove, 1);
    assert.equal(preview['regularizations.date'].toMove, 1);
    assert.equal((await db.collection('attendances').findOne({ _id: insertedIds[0] })).date.toISOString(), utcDay.toISOString(), 'a preview writes nothing');

    // Before the move, the IST-era lookup cannot see Alice's UTC-era day.
    assert.equal(await attendanceRepository.findByEmployeeAndDate(alice, new Date('2026-10-20T06:00:00Z')), null);

    const applied = await migrateDayKeys({ apply: true });
    assert.equal(applied['attendances.date'].moved, 1);
    assert.equal(applied['compoffs.earnedOn'].moved, 1);
    assert.equal(applied['regularizations.date'].moved, 1);

    const moved = await attendanceRepository.findByEmployeeAndDate(alice, new Date('2026-10-20T06:00:00Z'));
    assert.ok(moved, 'the same calendar day is found again');
    assert.equal(moved.date.toISOString(), istDay.toISOString());
    assert.equal(moved.workedMinutes, 500, 'figures are not recomputed');
    assert.equal(moved.lateMinutes, 12);

    // The clash is left exactly as it was.
    assert.equal((await db.collection('attendances').findOne({ _id: insertedIds[1] })).date.toISOString(), utcDay.toISOString());
    assert.equal((await db.collection('attendances').findOne({ _id: insertedIds[2] })).status, 'ABSENT');

    const again = await migrateDayKeys({ apply: true });
    assert.equal(again['attendances.date'].moved, 0);
    assert.equal(again['compoffs.earnedOn'].moved, 0);
    assert.equal(again['regularizations.date'].moved, 0);
  });

  test('refuses to run in UTC, where there is nothing to move', async () => {
    useZone('UTC');
    await assert.rejects(() => migrateDayKeys({ apply: true }), /runs in UTC/);
  });
});
