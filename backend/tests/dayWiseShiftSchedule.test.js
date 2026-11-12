import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Day-wise shift schedules: each day of the week graded against its own times.
 *
 * The engine half runs on fixtures. The rest saves shifts through the real
 * Shifts API, sends terminal punches through the biometric path and reads the
 * days back through the screens' own services, in a THROWAWAY local MongoDB.
 * Refuses any other database. Pinned to the production zone.
 */

const TEST_URI = process.env.MONGODB_TEST_URI_SCHEDULE ?? 'mongodb://127.0.0.1:27017/hrms_day_schedule_test';

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

const { evaluateDay, attributeShiftDay, startOfDay, scheduledNetMinutes } = await import('../helpers/attendanceRules.helper.js');
const { resolveWeeklyOffDays } = await import('../helpers/manualAttendance.helper.js');

const mongoose = (await import('mongoose')).default;
let reachable = true;
try {
  await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 2000 });
} catch {
  reachable = false;
}

const models = reachable ? await import('../models/index.js') : {};

/* ------------------------------------------------------------------ fixtures */

const at = (date, time) => new Date(`${date}T${time}:00+05:30`);
const punch = (date, time) => ({ time: at(date, time), source: 'BIOMETRIC', direction: 'UNKNOWN' });

// The week of 2026-11-16 (Monday) to 2026-11-22 (Sunday).
const DATE = { 1: '2026-11-16', 2: '2026-11-17', 3: '2026-11-18', 4: '2026-11-19', 5: '2026-11-20', 6: '2026-11-21', 0: '2026-11-22' };

const day = (dayNumber, isWorking, startTime = null, endTime = null, breakMinutes = 0) => ({ day: dayNumber, isWorking, startTime, endTime, breakMinutes });

/** The example from the brief, with Wednesday made different to prove each day is its own. */
const WEEK = [
  day(1, true, '08:30', '17:00', 60),
  day(2, true, '08:30', '17:00', 60),
  day(3, true, '10:00', '16:00', 30),
  day(4, true, '08:30', '17:00', 60),
  day(5, true, '08:30', '17:00', 60),
  day(6, true, '08:30', '14:30', 30),
  day(0, false),
];

const SCHEDULED = { startTime: '08:30', endTime: '17:00', breakMinutes: 60, weeklyOffs: [0], schedule: WEEK };
const LEGACY = { startTime: '08:30', endTime: '17:00', breakMinutes: 60, weeklyOffs: [0] };

const grade = (dayNumber, from, to, { shift = SCHEDULED, policy = {} } = {}) => {
  const date = DATE[dayNumber];
  return evaluateDay({
    date: startOfDay(at(date, '12:00')),
    punches: from ? [punch(date, from), ...(to ? [punch(date, to)] : [])] : [],
    shift,
    policy,
    isWeeklyOff: resolveWeeklyOffDays(shift, policy).includes(dayNumber),
  });
};

/* -------------------------------------------------------------- the engine */

describe('grading by the day’s own schedule', () => {
  test('1. each of the seven days uses its own times', () => {
    assert.equal(grade(3, '10:00', '16:00').status, 'PRESENT', 'Wednesday 10:00-16:00');
    assert.equal(grade(3, '10:00', '16:00').lateMinutes, 0, 'not late against Monday’s 08:30');
    assert.equal(grade(3, '10:00', '16:00').earlyGoingMinutes, 0, 'not early against Monday’s 17:00');
    assert.equal(grade(1, '10:00', '16:00').status, 'HALF_DAY', 'the same hours on Monday are short');
    assert.equal(grade(3, '10:00', '16:00').expectedMinutes, 330);
    assert.equal(grade(1, '08:30', '17:00').expectedMinutes, 450);
  });

  test('2. Monday to Friday: completing the day’s net time is P', () => {
    for (const dayNumber of [1, 2, 4, 5]) {
      assert.equal(grade(dayNumber, '08:30', '16:00').status, 'PRESENT', `7h30 on day ${dayNumber}`);
      assert.equal(grade(dayNumber, '08:30', '17:00').status, 'PRESENT');
    }
  });

  test('3. Saturday configured for 5h30: completing it is P, more is P too', () => {
    assert.equal(scheduledNetMinutes(WEEK[5]), 330);
    assert.equal(grade(6, '08:30', '14:00').status, 'PRESENT', '5h30');
    assert.equal(grade(6, '08:30', '14:30').status, 'PRESENT', '6h');
    assert.equal(grade(6, '08:30', '15:30').status, 'PRESENT', '7h');
    assert.equal(grade(6, '08:30', '13:59').status, 'HALF_DAY', '5h29');
  });

  test('4. a different Saturday duration is graded by that duration', () => {
    const fourHours = { ...SCHEDULED, schedule: WEEK.map((entry) => (entry.day === 6 ? day(6, true, '09:00', '13:00', 0) : entry)) };
    assert.equal(grade(6, '09:00', '13:00', { shift: fourHours }).status, 'PRESENT');
    assert.equal(grade(6, '09:00', '12:00', { shift: fourHours }).status, 'HALF_DAY');
    assert.equal(grade(6, '09:00', '10:30', { shift: fourHours }).status, 'ABSENT');
  });

  test('5. a day switched off is WO; worked anyway, it still counts', () => {
    assert.equal(grade(0, null, null).status, 'WEEKLY_OFF');
    const offSaturday = { ...SCHEDULED, schedule: WEEK.map((entry) => (entry.day === 6 ? day(6, false) : entry)) };
    assert.equal(grade(6, null, null, { shift: offSaturday }).status, 'WEEKLY_OFF');
    assert.equal(grade(0, '09:00', '12:00').status, 'PRESENT');
  });

  test('6. half day is half of that day’s time, not a weekday’s', () => {
    // Saturday 5h30: half is 2h45. Monday 7h30: half is 3h45.
    assert.equal(grade(6, '08:30', '11:15').status, 'HALF_DAY');
    assert.equal(grade(6, '08:30', '11:14').status, 'ABSENT');
    assert.equal(grade(1, '08:30', '12:15').status, 'HALF_DAY');
    assert.equal(grade(1, '08:30', '11:15').status, 'ABSENT', '2h45 is a half day on Saturday but not on Monday');
  });

  test('7. the day’s break: deducted where the policy deducts it, and shown as the day’s', () => {
    const deduct = { countBreakAsWorked: false };
    assert.equal(grade(6, '08:30', '14:30', { policy: deduct }).workedMinutes, 330, 'Saturday’s 30-minute break, not Monday’s hour');
    assert.equal(grade(6, '08:30', '14:30', { policy: deduct }).status, 'PRESENT');
    assert.equal(grade(6, '08:30', '14:30').breakMinutes, 30);
    assert.equal(grade(1, '08:30', '17:00').breakMinutes, 60);
  });

  test('8. an overnight day: punches belong to the day the shift started', () => {
    const nights = { ...SCHEDULED, isNightShift: true, schedule: WEEK.map((entry) => (entry.day === 5 ? day(5, true, '22:00', '06:00', 30) : entry)) };

    assert.equal(attributeShiftDay(at('2026-11-21', '05:58'), nights).toISOString(), startOfDay(at(DATE[5], '12:00')).toISOString(), 'Saturday 05:58 is Friday night’s exit');
    assert.equal(attributeShiftDay(at('2026-11-17', '05:58'), nights).toISOString(), startOfDay(at('2026-11-17', '12:00')).toISOString(), 'Tuesday 05:58 follows a Monday day shift, so it is Tuesday');

    const friday = evaluateDay({ date: startOfDay(at(DATE[5], '12:00')), shift: nights, punches: [punch(DATE[5], '22:00'), punch('2026-11-21', '06:00')] });
    assert.equal(friday.status, 'PRESENT');
    assert.equal(friday.workedMinutes, 480);
    assert.equal(friday.isNightShift, true);
  });

  test('9. duplicate punches are still one punch on a scheduled day', () => {
    const date = DATE[6];
    const result = evaluateDay({ date: startOfDay(at(date, '12:00')), shift: SCHEDULED, punches: [punch(date, '08:30'), punch(date, '08:31'), punch(date, '14:30')] });
    assert.equal(result.duplicatePunches, 1);
    assert.equal(result.checkInAt.toISOString(), at(date, '08:30').toISOString());
    assert.equal(result.status, 'PRESENT');
  });

  test('10. a shift without a schedule is graded exactly as before, company Saturday included', () => {
    assert.equal(grade(1, '08:30', '17:00', { shift: LEGACY }).status, 'PRESENT');
    assert.equal(grade(1, '08:30', '16:00', { shift: LEGACY }).status, 'HALF_DAY', '7h30 is short of the old 8h bar');
    assert.equal(grade(6, '08:30', '14:00', { shift: LEGACY }).status, 'PRESENT', 'the company 5h30 Saturday still applies');
    assert.equal(grade(0, null, null, { shift: LEGACY }).status, 'WEEKLY_OFF');
  });

  test('overtime keeps its basis: beyond the day’s own span', () => {
    // Saturday 08:30-14:30 is 6h at the door; 08:30-16:00 is 7h30, 1h30 beyond.
    assert.equal(grade(6, '08:30', '16:00').overtimeMinutes, 90);
    // A legacy shift's Monday overtime is untouched.
    assert.equal(grade(1, '08:30', '19:30', { shift: LEGACY }).overtimeMinutes, grade(1, '08:30', '19:30', { shift: { ...LEGACY } }).overtimeMinutes);
  });
});

/* ----------------------------------------------- saved, punched and shown */

describe('through the Shifts screen, the terminal and the attendance screens', { skip: !reachable && 'MongoDB is not reachable on localhost' }, () => {
  let server;
  let base;
  let token;
  let employee;
  let device;
  let shiftId;
  let reports;
  let attendance;
  let events;
  const adminReq = { user: { id: null, tenantId: null, role: 'SUPER_ADMIN', email: 'admin@test' }, ip: null, get: () => null };

  const call = async (method, route, body) => {
    const response = await fetch(`${base}${route}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };

  before(async () => {
    await mongoose.connection.dropDatabase();
    await Promise.all([models.BiometricEvent.syncIndexes(), models.Attendance.syncIndexes()]);

    const { ensureSystemRoles } = await import('../services/admin/role.service.js');
    const { loadRoleCache } = await import('../services/auth/roleCache.service.js');
    const { signAccessToken } = await import('../helpers/token.helper.js');
    await ensureSystemRoles();
    await loadRoleCache();

    reports = await import('../services/attendance/attendanceReport.service.js');
    attendance = await import('../services/attendance/attendance.service.js');
    events = await import('../services/biometric/biometricEvent.service.js');

    const admin = await models.User.create({ firstName: 'Super', lastName: 'Admin', email: 'super@schedule.test', password: 'x'.repeat(60), role: 'SUPER_ADMIN', status: 'ACTIVE', isEmailVerified: true });
    token = signAccessToken({ userId: admin._id, tenantId: null, role: 'SUPER_ADMIN' });

    const { default: app } = await import('../app.js');
    server = app.listen(0);
    base = `http://127.0.0.1:${server.address().port}/api/v1`;
  });

  after(async () => {
    server?.close();
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  test('an existing shift saved without a schedule keeps its times and weekly offs', async () => {
    const created = await call('POST', '/organization/masters/shifts', { name: 'General', code: 'GEN', startTime: '08:30', endTime: '17:00', breakMinutes: 60, weeklyOffs: [0] });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    shiftId = created.body.data._id;

    const stored = await models.Shift.findById(shiftId).lean();
    assert.deepEqual(stored.schedule, []);
    assert.deepEqual(stored.weeklyOffs, [0]);
    assert.equal(stored.startTime, '08:30');
  });

  test('a seven-day schedule is saved whole, and weekly offs follow it', async () => {
    const saved = await call('PATCH', `/organization/masters/shifts/${shiftId}`, { schedule: WEEK });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));

    const stored = await models.Shift.findById(shiftId).lean();
    assert.equal(stored.schedule.length, 7);
    assert.deepEqual(stored.weeklyOffs, [0], 'derived from the days switched off');
    assert.equal(stored.schedule.find((entry) => entry.day === 3).startTime, '10:00');
    assert.equal(stored.schedule.find((entry) => entry.day === 0).startTime, null, 'a weekly off keeps no times');
  });

  test('incomplete or impossible schedules are refused, and the shift is unchanged', async () => {
    const before = await models.Shift.findById(shiftId).lean();

    assert.equal((await call('PATCH', `/organization/masters/shifts/${shiftId}`, { schedule: WEEK.slice(0, 6) })).status, 422, 'six days');
    assert.equal((await call('PATCH', `/organization/masters/shifts/${shiftId}`, { schedule: WEEK.map((entry) => (entry.day === 2 ? day(2, true, '08:30', null, 0) : entry)) })).status, 422, 'no end time');
    assert.equal((await call('PATCH', `/organization/masters/shifts/${shiftId}`, { schedule: WEEK.map((entry) => (entry.day === 2 ? day(2, true, '08:00', '09:00', 60) : entry)) })).status >= 400, true, 'break as long as the day');

    assert.deepEqual((await models.Shift.findById(shiftId).lean()).schedule, before.schedule);
  });

  test('11. punched on the terminal, every screen shows the day’s own result', async () => {
    employee = await models.Employee.create({ employeeCode: 'DAY001', firstName: 'Test', joiningDate: new Date('2025-01-01'), shiftId, overtimeEligible: true });

    const settings = await models.AppSettings.create({
      tenantId: null,
      biometricDevices: [{ name: 'MB360', protocol: 'ADMS_PUSH', serialNumber: 'DAYTEST1', port: 8081, userMappings: [{ deviceUserId: '5', employeeCode: 'DAY001' }] }],
    });
    device = settings.biometricDevices[0].toObject();

    const push = (date, times) =>
      events.recordAndApply({ tenantId: null, device, transport: 'ADMS_PUSH', kind: 'PUSH', logs: times.map((time) => ({ deviceUserId: '5', timestamp: at(date, time), punchType: 0 })) });

    await push(DATE[1], ['08:30', '16:00']); // Monday 7h30
    await push(DATE[3], ['10:00', '16:00']); // Wednesday, its own 10:00-16:00
    await push(DATE[6], ['08:30', '08:31', '14:00']); // Saturday 5h30, a double touch

    const register = await reports.monthlyRegister({ year: 2026, month: 11, employeeId: String(employee._id) }, adminReq);
    const code = (date) => register.employees[0].days.find((entry) => entry.day === Number(date.slice(-2))).code;

    assert.equal(code(DATE[1]), 'P');
    assert.equal(code(DATE[3]), 'P');
    assert.equal(code(DATE[6]), 'P');
    assert.equal(code(DATE[0]), 'WO', 'the scheduled Sunday off');

    const listed = await attendance.listAttendance({ employeeId: String(employee._id), from: DATE[1], to: DATE[6], page: 1, limit: 25 }, adminReq);
    assert.deepEqual(listed.items.map((row) => row.status), ['PRESENT', 'PRESENT', 'PRESENT'], 'Attendance Register');

    const calendar = await attendance.getMonthlyCalendar({ employeeId: String(employee._id), year: 2026, month: 11 }, adminReq);
    const status = (date) => calendar.days.find((entry) => startOfDay(entry.date).getTime() === startOfDay(at(date, '12:00')).getTime()).status;
    assert.equal(status(DATE[6]), 'PRESENT', 'My Attendance and Attendance History');
    assert.equal(status(DATE[0]), 'WEEKLY_OFF');

    // 12. What payroll reads: present days and payable days from the same records.
    const { rows } = await reports.monthlySummary({ year: 2026, month: 11 }, adminReq);
    const summary = rows.find((row) => row._id === String(employee._id));
    assert.equal(summary.present, 3);
    assert.equal(summary.halfDay, 0);
  });
});
