import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';

/**
 * A shorter Saturday, and a biometric punch repeated within a minute or two.
 *
 * The engine half runs on fixtures; the second half sends real terminal punches
 * through the biometric path into a THROWAWAY local MongoDB, and refuses
 * anything else. Pinned to the production zone.
 */

const TEST_URI = process.env.MONGODB_TEST_URI_SATURDAY ?? 'mongodb://127.0.0.1:27017/hrms_saturday_duplicate_test';

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

const { evaluateDay, reducePunches, startOfDay, DEFAULT_POLICY } = await import('../helpers/attendanceRules.helper.js');

const mongoose = (await import('mongoose')).default;
let reachable = true;
try {
  await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 2000 });
} catch {
  reachable = false;
}

const models = reachable ? await import('../models/index.js') : {};
const events = reachable ? await import('../services/biometric/biometricEvent.service.js') : {};

/* ------------------------------------------------------------------ fixtures */

const at = (date, time) => new Date(`${date}T${time}:00+05:30`);
const punch = (date, time, source = 'BIOMETRIC', direction = 'UNKNOWN') => ({ time: at(date, time), source, direction });

const WEEKDAY_SHIFT = { startTime: '08:30', endTime: '17:00', breakMinutes: 60, weeklyOffs: [0] };
const SATURDAY_SHIFT = { ...WEEKDAY_SHIFT, saturdayWorkMinutes: 330 };

// 2026-11-13 is a Friday, 11-14 a Saturday, 11-15 a Sunday.
const FRIDAY = '2026-11-13';
const SATURDAY = '2026-11-14';
const SUNDAY = '2026-11-15';

const day = (date, punches, shift = SATURDAY_SHIFT, extra = {}) =>
  evaluateDay({ date: startOfDay(at(date, '12:00')), punches, shift, isWeeklyOff: shift.weeklyOffs.includes(at(date, '12:00').getDay()), ...extra });

/* -------------------------------------------------------------- the engine */

describe('Saturday working time', () => {
  test('1. Monday to Friday are graded exactly as before, setting or not', () => {
    const scenarios = [
      [punch(FRIDAY, '08:30'), punch(FRIDAY, '17:00')],
      [punch(FRIDAY, '08:50'), punch(FRIDAY, '19:30')],
      [punch(FRIDAY, '08:30'), punch(FRIDAY, '13:00')],
      [punch(FRIDAY, '08:30'), punch(FRIDAY, '10:00')],
      [punch(FRIDAY, '08:30')],
    ];

    scenarios.forEach((punches) => {
      const without = day(FRIDAY, punches, WEEKDAY_SHIFT);
      const withSetting = day(FRIDAY, punches, SATURDAY_SHIFT);
      assert.deepEqual(withSetting, without, JSON.stringify(punches.map((entry) => entry.time)));
    });

    const full = day(FRIDAY, scenarios[0], SATURDAY_SHIFT);
    assert.equal(full.status, 'PRESENT');
    assert.equal(full.expectedMinutes, 510);
    assert.equal(day(FRIDAY, scenarios[2], SATURDAY_SHIFT).status, 'HALF_DAY', 'four and a half hours on a weekday is still half');
  });

  test('2. 5h30 on a Saturday is a full day, not a half day', () => {
    const result = day(SATURDAY, [punch(SATURDAY, '08:30'), punch(SATURDAY, '14:00')]);

    assert.equal(result.status, 'PRESENT');
    assert.equal(result.workedMinutes, 330);
    assert.equal(result.expectedMinutes, 330);
    assert.equal(result.earlyGoingMinutes, 0, 'leaving at the Saturday end is not early');
    assert.equal(result.overtimeMinutes, 0);

    const before = day(SATURDAY, [punch(SATURDAY, '08:30'), punch(SATURDAY, '14:00')], WEEKDAY_SHIFT);
    assert.equal(before.status, 'HALF_DAY', 'without the setting Saturday is still a weekday');
  });

  test('3. under 5h30 on a Saturday follows the usual rules against the Saturday length', () => {
    assert.equal(day(SATURDAY, [punch(SATURDAY, '08:30'), punch(SATURDAY, '13:59')]).status, 'HALF_DAY');
    assert.equal(day(SATURDAY, [punch(SATURDAY, '08:30'), punch(SATURDAY, '11:15')]).status, 'HALF_DAY', '2h45 is half of 5h30');
    assert.equal(day(SATURDAY, [punch(SATURDAY, '08:30'), punch(SATURDAY, '11:00')]).status, 'ABSENT');
    assert.equal(day(SATURDAY, [punch(SATURDAY, '08:30')]).status, 'MISSING_PUNCH');
    assert.equal(day(SATURDAY, []).status, 'ABSENT');

    const late = day(SATURDAY, [punch(SATURDAY, '09:00'), punch(SATURDAY, '14:30')]);
    assert.equal(late.lateMinutes, 30 - DEFAULT_POLICY.lateGraceMinutes, 'lateness still runs from the shift start');
    assert.equal(late.status, 'PRESENT');
  });

  test('Saturday time beyond 5h30 is overtime, by the same rule as any day', () => {
    const result = day(SATURDAY, [punch(SATURDAY, '08:30'), punch(SATURDAY, '15:30')]);
    assert.equal(result.workedMinutes, 420);
    assert.equal(result.overtimeMinutes, 90);
  });

  test('where the break is deducted, Saturday still needs 5h30 of work', () => {
    const policy = { countBreakAsWorked: false };
    const shortDay = evaluateDay({ date: startOfDay(at(SATURDAY, '12:00')), shift: SATURDAY_SHIFT, policy, punches: [punch(SATURDAY, '08:30'), punch(SATURDAY, '14:00')] });
    const fullDay = evaluateDay({ date: startOfDay(at(SATURDAY, '12:00')), shift: SATURDAY_SHIFT, policy, punches: [punch(SATURDAY, '08:30'), punch(SATURDAY, '15:00')] });

    assert.equal(shortDay.workedMinutes, 270);
    assert.equal(shortDay.status, 'HALF_DAY');
    assert.equal(fullDay.workedMinutes, 330);
    assert.equal(fullDay.status, 'PRESENT');
    assert.equal(fullDay.earlyGoingMinutes, 0);
  });

  test('4. Sunday is still a weekly off', () => {
    assert.equal(day(SUNDAY, []).status, 'WEEKLY_OFF');
    assert.equal(day(SUNDAY, [punch(SUNDAY, '09:00'), punch(SUNDAY, '12:00')]).status, 'PRESENT', 'working a Sunday still counts');
  });

  test('a shift that rests on Saturday keeps resting on Saturday', () => {
    const result = day(SATURDAY, [], { ...SATURDAY_SHIFT, weeklyOffs: [0, 6] });
    assert.equal(result.status, 'WEEKLY_OFF');
  });
});

describe('duplicate biometric punches', () => {
  test('5. 08:30 and 08:31 are one entry, not an entry and an exit', () => {
    const result = day(FRIDAY, [punch(FRIDAY, '08:30'), punch(FRIDAY, '08:31')]);

    assert.equal(result.checkInAt.toISOString(), at(FRIDAY, '08:30').toISOString());
    assert.equal(result.checkOutAt, null);
    assert.equal(result.status, 'MISSING_PUNCH', 'waiting for the exit, not a one-minute day');
    assert.equal(result.duplicatePunches, 1);

    const before = day(FRIDAY, [punch(FRIDAY, '08:30'), punch(FRIDAY, '08:31')], SATURDAY_SHIFT, { policy: { duplicatePunchWindowMinutes: 0 } });
    assert.equal(before.checkOutAt.toISOString(), at(FRIDAY, '08:31').toISOString(), 'what happened before');
    assert.equal(before.status, 'ABSENT');
  });

  test('6. 08:30 and 08:32 follow the configured window', () => {
    const punches = [punch(FRIDAY, '08:30'), punch(FRIDAY, '08:32')];

    assert.equal(day(FRIDAY, punches).checkOutAt, null, 'inside the default 2 minutes, which is inclusive');
    assert.equal(day(FRIDAY, punches, SATURDAY_SHIFT, { policy: { duplicatePunchWindowMinutes: 1 } }).checkOutAt.toISOString(), at(FRIDAY, '08:32').toISOString(), 'outside a 1-minute window');
    assert.equal(day(FRIDAY, [{ ...punches[0] }, { ...punches[1], time: new Date(at(FRIDAY, '08:32').getTime() + 1000) }]).duplicatePunches, 0, '2m01s is not a repeat');
  });

  test('7. the 17:00 exit is kept', () => {
    const result = day(FRIDAY, [punch(FRIDAY, '08:30'), punch(FRIDAY, '08:31'), punch(FRIDAY, '17:00')]);

    assert.equal(result.checkInAt.toISOString(), at(FRIDAY, '08:30').toISOString());
    assert.equal(result.checkOutAt.toISOString(), at(FRIDAY, '17:00').toISOString());
    assert.equal(result.status, 'PRESENT');
    assert.equal(result.workedMinutes, 510);
  });

  test('a run of quick touches cannot creep forward into a real exit', () => {
    const punches = ['08:30', '08:31', '08:32', '08:33', '08:34'].map((time) => punch(FRIDAY, time));
    const { punchCount, checkOut, duplicates } = reducePunches(punches, { duplicateWindowMinutes: 2 });

    // 08:31 and 08:32 repeat 08:30; 08:33 is three minutes on, so it is kept,
    // and 08:34 then repeats 08:33. A chain of one-minute gaps does not merge.
    assert.equal(duplicates, 3, 'compared with the last punch kept');
    assert.equal(punchCount, 2);
    assert.equal(new Date(checkOut.time).toISOString(), at(FRIDAY, '08:33').toISOString());
  });

  test('punches entered by a person or a file are never set aside', () => {
    const manual = [punch(FRIDAY, '08:30', 'MANUAL'), punch(FRIDAY, '08:31', 'MANUAL')];
    assert.equal(reducePunches(manual, { duplicateWindowMinutes: 2 }).duplicates, 0);

    const mixed = [punch(FRIDAY, '08:30', 'CSV'), punch(FRIDAY, '08:31')];
    assert.equal(reducePunches(mixed, { duplicateWindowMinutes: 2 }).duplicates, 0);
  });

  test('8. a night shift across midnight still reads its entry and exit', () => {
    const night = { startTime: '22:00', endTime: '06:00', breakMinutes: 30, isNightShift: true, weeklyOffs: [0], saturdayWorkMinutes: 330 };
    const result = evaluateDay({
      date: startOfDay(at('2026-11-12', '12:00')),
      shift: night,
      punches: [punch('2026-11-12', '22:00'), punch('2026-11-12', '22:01'), punch('2026-11-13', '06:00'), punch('2026-11-13', '06:01')],
    });

    assert.equal(result.checkInAt.toISOString(), at('2026-11-12', '22:00').toISOString());
    assert.equal(result.checkOutAt.toISOString(), at('2026-11-13', '06:00').toISOString());
    assert.equal(result.workedMinutes, 480);
    assert.equal(result.status, 'PRESENT');
    assert.equal(result.isNightShift, true);
  });
});

/* ------------------------------------------------- through the device path */

describe('through the biometric path', { skip: !reachable && 'MongoDB is not reachable on localhost' }, () => {
  let device;
  let employee;

  before(async () => {
    await mongoose.connection.dropDatabase();
    await Promise.all([models.BiometricEvent.syncIndexes(), models.Attendance.syncIndexes()]);

    const shift = await models.Shift.create({ name: 'General', code: 'GEN', startTime: '08:30', endTime: '17:00', breakMinutes: 60, weeklyOffs: [0], saturdayWorkMinutes: 330 });
    employee = await models.Employee.create({ employeeCode: 'SAT001', firstName: 'Test', joiningDate: new Date('2025-01-01'), shiftId: shift._id, overtimeEligible: true });

    const settings = await models.AppSettings.create({
      tenantId: null,
      biometricDevices: [{ name: 'MB360', protocol: 'ADMS_PUSH', serialNumber: 'SATTEST1', port: 8081, userMappings: [{ deviceUserId: '7', employeeCode: 'SAT001' }] }],
    });
    device = settings.biometricDevices[0].toObject();
  });

  after(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  const push = (date, times) =>
    events.recordAndApply({ tenantId: null, device, transport: 'ADMS_PUSH', kind: 'PUSH', logs: times.map((time) => ({ deviceUserId: '7', timestamp: at(date, time), punchType: 0 })) });

  const stored = (date) => models.Attendance.findOne({ employeeId: employee._id, date: startOfDay(at(date, '12:00')) }).lean();

  test('a double touch then the exit, sent the way the terminal sends them', async () => {
    await push(FRIDAY, ['08:30']);
    await push(FRIDAY, ['08:31']);
    assert.equal((await stored(FRIDAY)).status, 'MISSING_PUNCH', 'not a one-minute absence at 08:31');

    await push(FRIDAY, ['17:00']);
    const record = await stored(FRIDAY);

    assert.equal(record.status, 'PRESENT');
    assert.equal(record.checkInAt.toISOString(), at(FRIDAY, '08:30').toISOString());
    assert.equal(record.checkOutAt.toISOString(), at(FRIDAY, '17:00').toISOString());
    assert.equal(record.punches.length, 3, 'the repeat stays on the record for audit');
    assert.equal(await models.BiometricEvent.countDocuments({ deviceUserId: '7', punchTime: at(FRIDAY, '08:31') }), 1, 'and the raw event is kept');
  });

  test('9. re-sending the same punches creates no extra record and changes nothing', async () => {
    const before = await stored(FRIDAY);
    const result = await push(FRIDAY, ['08:30', '08:31', '17:00']);

    assert.equal(result.duplicate, 3);
    assert.equal(await models.Attendance.countDocuments({ employeeId: employee._id }), 1);
    assert.deepEqual(await stored(FRIDAY), before);
  });

  test('a Saturday of 5h30 from the terminal is stored as a full day', async () => {
    await push(SATURDAY, ['08:30', '08:31', '14:00']);
    const record = await stored(SATURDAY);

    assert.equal(record.status, 'PRESENT');
    assert.equal(record.workedMinutes, 330);
    assert.equal(record.expectedMinutes, 330);
    assert.equal(record.overtimeMinutes, 0);
  });

  test('both settings can be saved from their screens, and cleared', async () => {
    const { default: app } = await import('../app.js');
    const { ensureSystemRoles } = await import('../services/admin/role.service.js');
    const { loadRoleCache } = await import('../services/auth/roleCache.service.js');
    const { signAccessToken } = await import('../helpers/token.helper.js');
    await ensureSystemRoles();
    await loadRoleCache();

    const admin = await models.User.create({ firstName: 'Super', lastName: 'Admin', email: 'super@saturday.test', password: 'x'.repeat(60), role: 'SUPER_ADMIN', status: 'ACTIVE', isEmailVerified: true });
    const token = signAccessToken({ userId: admin._id, tenantId: null, role: 'SUPER_ADMIN' });

    const server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}/api/v1`;
    const call = async (method, route, body) => {
      const response = await fetch(`${base}${route}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    };

    try {
      const created = await call('POST', '/organization/masters/shifts', { name: 'Office', code: 'OFF', startTime: '08:30', endTime: '17:00', breakMinutes: 60, weeklyOffs: [0], saturdayWorkMinutes: 330 });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      const id = created.body.data._id;

      const shift = await models.Shift.findById(id).lean();
      assert.equal(shift.saturdayWorkMinutes, 330);
      assert.deepEqual(shift.weeklyOffs, [0]);
      assert.equal(shift.startTime, '08:30');

      assert.equal((await call('PATCH', `/organization/masters/shifts/${id}`, { saturdayWorkMinutes: 0 })).status, 200);
      assert.equal((await models.Shift.findById(id).lean()).saturdayWorkMinutes, 0, 'cleared: Saturday is a weekday again');
      assert.equal((await call('PATCH', `/organization/masters/shifts/${id}`, { saturdayWorkMinutes: 2000 })).status, 422);

      const policy = await call('PUT', '/attendance/policy', { name: 'Company policy', duplicatePunchWindowMinutes: 3 });
      assert.ok(policy.status < 300, JSON.stringify(policy.body));
      assert.equal((await models.AttendancePolicy.findOne({ isActive: true }).lean()).duplicatePunchWindowMinutes, 3);
      assert.equal((await call('PUT', '/attendance/policy', { name: 'Company policy', duplicatePunchWindowMinutes: 60 })).status, 422);
    } finally {
      server.close();
      await models.AttendancePolicy.deleteMany({});
    }
  });

  test('10. weekday overtime is unchanged by either rule', async () => {
    await push('2026-11-12', ['08:30', '19:30']);
    const record = await stored('2026-11-12');

    assert.equal(record.workedMinutes, 660);
    assert.equal(record.overtimeMinutes, 150, '11h worked less the 8h30 shift');
    assert.equal(record.status, 'PRESENT');
  });
});
