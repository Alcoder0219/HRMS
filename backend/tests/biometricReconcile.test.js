import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Historical punches of mapped employees reaching attendance.
 *
 * Covers the two ways they were lost: a reprocess that never got past the
 * punches of people who are not mapped, and punches imported onto an employee
 * record that no longer exists. Runs in the production zone against a THROWAWAY
 * local database, and refuses anything else.
 */

const TEST_URI = process.env.MONGODB_TEST_URI_RECONCILE ?? 'mongodb://127.0.0.1:27017/hrms_biometric_reconcile_test';

if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(TEST_URI)) {
  throw new Error(`Refusing to run destructive tests against a non-local database: ${TEST_URI}`);
}

Object.assign(process.env, {
  TZ: 'Asia/Kolkata',
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

const models = reachable ? await import('../models/index.js') : {};
const { AppSettings, Attendance, BiometricEvent, Employee } = models;
const events = reachable ? await import('../services/biometric/biometricEvent.service.js') : {};
const deviceService = reachable ? (await import('../services/admin/biometricDevice.service.js')).default : null;
const reconcile = reachable ? await import('../scripts/reconcileBiometricAttendance.js') : {};
const reports = reachable ? await import('../services/attendance/attendanceReport.service.js') : {};
const { startOfDay } = await import('../helpers/attendanceRules.helper.js');

const adminReq = { user: { id: null, tenantId: null, role: 'SUPER_ADMIN', email: 'admin@test' }, ip: '127.0.0.1', get: () => null };

const at = (date, time) => new Date(`${date}T${time}:00+05:30`);
const log = (deviceUserId, date, time) => ({ deviceUserId, timestamp: at(date, time), punchType: 0 });

let serial = 0;

/** A device on its own settings document; the default tenant owns a single one. */
const addDevice = async (mappings = [], tenantId = null) => {
  serial += 1;
  const settings = await AppSettings.findOneAndUpdate(
    { tenantId },
    { $setOnInsert: { tenantId }, $push: { biometricDevices: { name: `Device ${serial}`, protocol: 'ADMS_PUSH', serialNumber: `RECON${serial}`, port: 8081, userMappings: mappings } } },
    { upsert: true, new: true },
  );
  return settings.biometricDevices.at(-1).toObject();
};

const reload = async (device, tenantId = null) => {
  const settings = await AppSettings.findOne({ tenantId }).lean();
  return settings.biometricDevices.find((entry) => String(entry._id) === String(device._id));
};

const store = (device, logs, tenantId = null) =>
  events.recordAndApply({ tenantId, device, transport: 'ADMS_PUSH', kind: 'PUSH', logs });

const employee = (code, tenantId = null) =>
  Employee.create({ tenantId, employeeCode: code, firstName: `Test ${code}`, joiningDate: new Date('2025-01-01') });

const dayOf = (person, date) => Attendance.findOne({ employeeId: person._id, date: startOfDay(at(date, '12:00')) }).lean();

const remap = async (device, mappings) => {
  await deviceService.mapUsers(String(device._id), mappings, adminReq);
  return reload(device);
};

describe('historical biometric punches after mapping', { skip: !reachable && 'MongoDB is not reachable on localhost' }, () => {
  before(async () => {
    await mongoose.connection.dropDatabase();
    await Promise.all([BiometricEvent.syncIndexes(), Attendance.syncIndexes()]);

    const { ensureSystemRoles } = await import('../services/admin/role.service.js');
    const { loadRoleCache } = await import('../services/auth/roleCache.service.js');
    await ensureSystemRoles();
    await loadRoleCache();
  });

  after(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  test('1. an employee mapped before the punch arrives goes straight to attendance', async () => {
    const person = await employee('MAP001');
    const device = await addDevice([{ deviceUserId: '11', employeeCode: 'MAP001' }]);

    await store(device, [log('11', '2026-10-05', '08:30'), log('11', '2026-10-05', '17:30')]);

    assert.equal((await dayOf(person, '2026-10-05')).punches.length, 2);
  });

  test('2. mapped after import: punches are reached past thousands of other unmapped events', async () => {
    const person = await employee('MAP002');
    const device = await addDevice();

    // Older than the mapped person's punches, and more than one run can hold.
    await BiometricEvent.insertMany(
      Array.from({ length: 5001 }, (_, index) => ({
        tenantId: null, deviceId: device._id, transport: 'ADMS_PUSH', deviceUserId: `other-${index % 40}`,
        punchTime: new Date(at('2026-10-01', '08:00').getTime() + index * 1000),
        dedupKey: `flood-${index}`, status: 'UNMAPPED', statusReason: 'No employee is mapped to this device user ID',
      })),
    );
    await store(device, [log('22', '2026-10-25', '08:30'), log('22', '2026-10-25', '17:30')]);

    const mapped = await remap(device, [{ deviceUserId: '22', employeeCode: 'MAP002' }]);
    const result = await deviceService.reprocessDevice(String(mapped._id), {}, adminReq);

    assert.equal(result.received, 2, 'only punches that can be applied are examined');
    assert.equal(result.imported, 2);
    assert.equal(result.unmapped, 5001, 'the screens still see who is waiting');
    assert.equal((await dayOf(person, '2026-10-25')).punches.length, 2);
    assert.equal(await BiometricEvent.countDocuments({ deviceId: device._id, status: 'UNMAPPED' }), 5001, 'other people are untouched');
  });

  test('3. a changed biometric ID: both IDs land on the employee, without duplicates', async () => {
    const person = await employee('MAP003');
    const device = await addDevice([{ deviceUserId: '31', employeeCode: 'MAP003' }]);

    await store(device, [log('31', '2026-10-06', '08:30')]);
    await store(device, [log('32', '2026-10-07', '08:30')]); // re-enrolled, not mapped yet

    const mapped = await remap(device, [{ deviceUserId: '32', employeeCode: 'MAP003' }]);
    assert.equal((await deviceService.reprocessDevice(String(mapped._id), {}, adminReq)).imported, 1);

    assert.equal((await dayOf(person, '2026-10-06')).punches.length, 1, 'punches from the old ID stay');
    assert.equal((await dayOf(person, '2026-10-07')).punches.length, 1);
  });

  test('4. several employees on one device each get only their own punches', async () => {
    const [first, second] = [await employee('MAP004'), await employee('MAP005')];
    const device = await addDevice();

    await store(device, [log('41', '2026-10-08', '08:30'), log('42', '2026-10-08', '09:00')]);

    const mapped = await remap(device, [
      { deviceUserId: '41', employeeCode: 'MAP004' },
      { deviceUserId: '42', employeeCode: 'MAP005' },
    ]);
    assert.equal((await deviceService.reprocessDevice(String(mapped._id), {}, adminReq)).imported, 2);

    assert.equal((await dayOf(first, '2026-10-08')).punches[0].time.toISOString(), at('2026-10-08', '08:30').toISOString());
    assert.equal((await dayOf(second, '2026-10-08')).punches[0].time.toISOString(), at('2026-10-08', '09:00').toISOString());
  });

  test('5. duplicate punches and repeat runs add nothing', async () => {
    const person = await employee('MAP006');
    const device = await addDevice();
    const punch = [log('51', '2026-10-09', '08:30')];

    await store(device, punch);
    const again = await store(device, punch);
    assert.equal(again.duplicate, 1);

    const mapped = await remap(device, [{ deviceUserId: '51', employeeCode: 'MAP006' }]);
    assert.equal((await deviceService.reprocessDevice(String(mapped._id), {}, adminReq)).imported, 1);
    assert.equal((await deviceService.reprocessDevice(String(mapped._id), {}, adminReq)).received, 0);

    assert.equal((await dayOf(person, '2026-10-09')).punches.length, 1);
  });

  test('6. punches from different months appear in each month’s register on the right date', async () => {
    const person = await employee('MAP007');
    const device = await addDevice();

    await store(device, [log('61', '2026-09-30', '08:30'), log('61', '2026-09-30', '17:30'), log('61', '2026-10-01', '08:30'), log('61', '2026-10-01', '17:30')]);

    const mapped = await remap(device, [{ deviceUserId: '61', employeeCode: 'MAP007' }]);
    await deviceService.reprocessDevice(String(mapped._id), {}, adminReq);

    const dayIn = async (month, day) => {
      const register = await reports.monthlyRegister({ year: 2026, month, employeeId: String(person._id) }, adminReq);
      return register.employees[0].days.find((entry) => entry.day === day);
    };

    assert.notEqual((await dayIn(9, 30)).status, null);
    assert.notEqual((await dayIn(10, 1)).status, null);
    assert.equal((await dayIn(10, 2)).status, null, 'nothing spills onto the next day');
  });

  test('7. a manually corrected day is held, not overwritten', async () => {
    const person = await employee('MAP008');
    const device = await addDevice();

    await Attendance.create({ employeeId: person._id, date: startOfDay(at('2026-10-12', '12:00')), status: 'ON_DUTY', source: 'MANUAL', remarks: 'Client site' });
    await store(device, [log('71', '2026-10-12', '08:30')]);

    const mapped = await remap(device, [{ deviceUserId: '71', employeeCode: 'MAP008' }]);
    const result = await deviceService.reprocessDevice(String(mapped._id), {}, adminReq);

    assert.equal(result.held, 1);
    const day = await dayOf(person, '2026-10-12');
    assert.equal(day.status, 'ON_DUTY');
    assert.equal(day.punches.length, 0);
  });

  test('8. another tenant’s events and employees are not touched', async () => {
    const otherTenant = new mongoose.Types.ObjectId();
    const theirs = await employee('MAP009', otherTenant);
    const ours = await employee('MAP009');

    const device = await addDevice();
    const otherDevice = await addDevice([], otherTenant);

    await store(device, [log('81', '2026-10-13', '08:30')]);
    await store(otherDevice, [log('81', '2026-10-13', '09:30')], otherTenant);

    const mapped = await remap(device, [{ deviceUserId: '81', employeeCode: 'MAP009' }]);
    await deviceService.reprocessDevice(String(mapped._id), {}, adminReq);

    assert.equal((await dayOf(ours, '2026-10-13')).punches.length, 1);
    assert.equal(await dayOf(theirs, '2026-10-13'), null);
    assert.equal((await BiometricEvent.findOne({ tenantId: otherTenant, deviceUserId: '81' }).lean()).status, 'UNMAPPED');
  });

  describe('reconciliation', () => {
    let device;
    let person;
    let goneId;
    let manualDay;

    before(async () => {
      // A person imported under an employee record that is then removed outright.
      goneId = (await employee('OLD100'))._id;
    });

    test('previews, then recovers punches left on a removed employee', async () => {
      const keeper = await employee('MAP012');
      device = await addDevice([{ deviceUserId: '91', employeeCode: 'OLD100' }, { deviceUserId: '93', employeeCode: 'MAP012' }]);

      await store(device, [
        log('91', '2026-10-14', '08:30'), log('91', '2026-10-14', '17:30'),
        log('91', '2026-10-15', '08:30'), log('91', '2026-10-15', '17:30'),
        log('91', '2026-10-16', '08:30'),
        log('91', '2026-10-17', '08:30'),
        log('93', '2026-10-14', '08:30'),
      ]);

      await Employee.collection.deleteOne({ _id: goneId });
      person = await employee('MAP011');

      // Already has its own row on the 15th, and a human's correction on the 16th.
      await Attendance.create({ employeeId: person._id, date: startOfDay(at('2026-10-15', '12:00')), status: 'ABSENT', source: 'BIOMETRIC' });
      await Attendance.create({ employeeId: person._id, date: startOfDay(at('2026-10-16', '12:00')), status: 'ON_LEAVE', source: 'MANUAL' });
      manualDay = await dayOf(person, '2026-10-16');

      const orphanRows = await Attendance.find({ employeeId: goneId }).sort({ date: 1 }).lean();
      assert.equal(orphanRows.length, 4);

      device = await remap(device, [{ deviceUserId: '91', employeeCode: 'MAP011' }, { deviceUserId: '93', employeeCode: 'MAP012' }]);

      /* The screens' reprocess never touches them. */
      assert.equal((await deviceService.reprocessDevice(String(device._id), {}, adminReq)).received, 0);

      /* Preview writes nothing. */
      const eventsBefore = await BiometricEvent.find({ deviceId: device._id }).sort({ _id: 1 }).lean();
      const preview = await reconcile.previewDevice({ tenantId: null, device });
      assert.deepEqual(await BiometricEvent.find({ deviceId: device._id }).sort({ _id: 1 }).lean(), eventsBefore);

      assert.equal(preview.length, 1, 'only the employee with something to recover');
      assert.equal(preview[0].employeeCode, 'MAP011');
      assert.equal(preview[0].orphaned, 6);
      assert.equal(preview[0].newDays, 2);
      assert.equal(preview[0].existingDays, 1);
      assert.equal(preview[0].heldDays, 1);

      /* Apply. */
      const applied = await reconcile.applyDevice({ tenantId: null, device });
      assert.equal(applied.imported, 5);
      assert.equal(applied.held, 1);

      assert.equal((await dayOf(person, '2026-10-14')).punches.length, 2);
      assert.equal((await dayOf(person, '2026-10-15')).punches.length, 2, 'added to the existing row');
      assert.equal((await dayOf(person, '2026-10-17')).punches.length, 1);

      /* Corrections and the original rows are exactly as they were. */
      assert.deepEqual(await dayOf(person, '2026-10-16'), manualDay);
      assert.deepEqual(await Attendance.find({ employeeId: goneId }).sort({ date: 1 }).lean(), orphanRows);

      /* Punch times and the other person are untouched. */
      const eventsAfter = await BiometricEvent.find({ deviceId: device._id }).sort({ _id: 1 }).lean();
      assert.deepEqual(eventsAfter.map((event) => [event.punchTime, event.deviceLocalTime, event.dedupKey, event.deviceUserId, event.transport]), eventsBefore.map((event) => [event.punchTime, event.deviceLocalTime, event.dedupKey, event.deviceUserId, event.transport]));
      assert.equal((await dayOf(keeper, '2026-10-14')).punches.length, 1);
    });

    test('the command works in a fresh process, and backs up before it writes', async () => {
      // A separate process: the models this file loaded must not hide a missing registration.
      const fresh = await employee('MAP018');
      const freshDevice = await addDevice();
      await store(freshDevice, [log('97', '2026-10-21', '08:30')]);
      await remap(freshDevice, [{ deviceUserId: '97', employeeCode: 'MAP018' }]);

      const backup = path.join(os.tmpdir(), `reconcile-test-${process.pid}-${Date.now()}.json`);
      const { stdout } = await run(
        process.execPath,
        ['scripts/reconcileBiometricAttendance.js', '--timezone=Asia/Kolkata', '--apply', `--backup=${backup}`],
        { env: { ...process.env, MONGODB_URI: TEST_URI, TZ: 'Asia/Kolkata' }, cwd: path.resolve(import.meta.dirname, '..') },
      );

      const entry = JSON.parse(stdout).report.find((row) => row.device === freshDevice.name);
      assert.equal(entry.applied.failed, 0);
      assert.equal(entry.applied.imported, 1);
      assert.equal((await dayOf(fresh, '2026-10-21')).punches.length, 1);

      const saved = JSON.parse(fs.readFileSync(backup, 'utf8'));
      assert.ok(saved.some((row) => row.events.some((event) => event.deviceUserId === '97')), 'the event is in the backup');
      fs.rmSync(backup);
    });

    test('a second run finds nothing and changes nothing', async () => {
      const before = await Attendance.find({ employeeId: person._id }).sort({ date: 1 }).lean();

      const preview = await reconcile.previewDevice({ tenantId: null, device });
      assert.deepEqual(preview.map((row) => row.orphaned), []);

      const applied = await reconcile.applyDevice({ tenantId: null, device });
      assert.equal(applied.imported, 0);
      assert.deepEqual(await Attendance.find({ employeeId: person._id }).sort({ date: 1 }).lean(), before);
    });

    test('punches of an employee who still exists are not moved by a remap', async () => {
      const [old, replacement] = [await employee('MAP013'), await employee('MAP014')];
      const remapped = await addDevice([{ deviceUserId: '94', employeeCode: 'MAP013' }]);
      await store(remapped, [log('94', '2026-10-18', '08:30')]);

      const current = await remap(remapped, [{ deviceUserId: '94', employeeCode: 'MAP014' }]);

      assert.deepEqual(await reconcile.previewDevice({ tenantId: null, device: current }), []);
      await reconcile.applyDevice({ tenantId: null, device: current });

      assert.equal((await dayOf(old, '2026-10-18')).punches.length, 1);
      assert.equal(await dayOf(replacement, '2026-10-18'), null);
    });

    test('a soft-deleted employee is not treated as missing', async () => {
      const left = await employee('MAP015');
      await employee('MAP016');
      const softDevice = await addDevice([{ deviceUserId: '95', employeeCode: 'MAP015' }]);
      await store(softDevice, [log('95', '2026-10-19', '08:30')]);

      await Employee.updateOne({ _id: left._id }, { $set: { deletedAt: new Date() } });
      const current = await remap(softDevice, [{ deviceUserId: '95', employeeCode: 'MAP016' }]);

      assert.deepEqual(await reconcile.previewDevice({ tenantId: null, device: current }), []);
    });

    test('a locked day stays held', async () => {
      const locked = await employee('MAP017');
      const lockedDevice = await addDevice([{ deviceUserId: '96', employeeCode: 'MAP017' }]);
      await Attendance.create({ employeeId: locked._id, date: startOfDay(at('2026-10-20', '12:00')), status: 'ABSENT', source: 'BIOMETRIC', isLocked: true });

      await BiometricEvent.create({
        tenantId: null, deviceId: lockedDevice._id, transport: 'ADMS_PUSH', deviceUserId: '96', employeeCode: 'GONE',
        employeeId: new mongoose.Types.ObjectId(), punchTime: at('2026-10-20', '08:30'), dedupKey: 'locked-orphan', status: 'IMPORTED',
      });

      const applied = await reconcile.applyDevice({ tenantId: null, device: lockedDevice });
      assert.equal(applied.held, 1);
      assert.equal((await dayOf(locked, '2026-10-20')).punches.length, 0);
    });
  });
});
