import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';

/**
 * The reported Saturday: a General shift scheduled 08:30-13:00 with a
 * 60-minute break (3h30), the Night shift switch on, and a stored day from
 * before the schedule existed. Engine cases run on fixtures; the regrade runs
 * against a THROWAWAY local MongoDB and refuses any other. Production zone.
 */

const TEST_URI = process.env.MONGODB_TEST_URI_REGRADE ?? 'mongodb://127.0.0.1:27017/hrms_schedule_regrade_test';

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

const { evaluateDay, attributeShiftDay, startOfDay } = await import('../helpers/attendanceRules.helper.js');
const { deriveManualDay } = await import('../helpers/manualAttendance.helper.js');

const mongoose = (await import('mongoose')).default;
let reachable = true;
try {
  await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 2000 });
} catch {
  reachable = false;
}
const models = reachable ? await import('../models/index.js') : {};

const at = (date, time) => new Date(`${date}T${time}:00+05:30`);
const punch = (date, time) => ({ time: at(date, time), source: 'BIOMETRIC', direction: 'UNKNOWN' });

const SATURDAY = '2026-11-07';
const MONDAY = '2026-11-09';
const SUNDAY = '2026-11-08';

const working = (day, startTime, endTime, breakMinutes) => ({ day, isWorking: true, startTime, endTime, breakMinutes });

/** The shift exactly as configured in production, Night shift switch included. */
const GENERAL = {
  code: 'GEN',
  startTime: '08:30',
  endTime: '17:00',
  breakMinutes: 60,
  isNightShift: true,
  weeklyOffs: [0],
  schedule: [1, 2, 3, 4, 5].map((day) => working(day, '08:30', '17:00', 60)).concat([working(6, '08:30', '13:00', 60), { day: 0, isWorking: false }]),
};

const grade = (date, times, { policy = {}, extra = {} } = {}) =>
  evaluateDay({
    date: startOfDay(at(date, '12:00')),
    punches: times.map((time) => punch(date, time)),
    shift: GENERAL,
    policy,
    isWeeklyOff: new Date(at(date, '12:00')).getDay() === 0,
    ...extra,
  });

describe('the reported Saturday', () => {
  test('1. 08:45-13:50 against a 3h30 Saturday is P, whichever way the break is treated', () => {
    const counted = grade(SATURDAY, ['08:45', '13:50']);
    assert.equal(counted.status, 'PRESENT');
    assert.equal(counted.expectedMinutes, 210);
    assert.equal(counted.workedMinutes, 305);

    const deducted = grade(SATURDAY, ['08:45', '13:50'], { policy: { countBreakAsWorked: false } });
    assert.equal(deducted.workedMinutes, 245, '5h05 less the 60-minute break, once');
    assert.equal(deducted.status, 'PRESENT');
  });

  test('2-4. exactly 3h30 is P; between half and full is H; below half is the usual absence', () => {
    assert.equal(grade(SATURDAY, ['08:30', '12:00']).status, 'PRESENT', '3h30');
    assert.equal(grade(SATURDAY, ['08:30', '11:59']).status, 'HALF_DAY', '3h29');
    assert.equal(grade(SATURDAY, ['08:30', '10:15']).status, 'HALF_DAY', '1h45 is half of 3h30');
    assert.equal(grade(SATURDAY, ['08:30', '10:14']).status, 'ABSENT');
    assert.equal(grade(SATURDAY, ['08:30']).status, 'MISSING_PUNCH');
  });

  test('5-6. Monday keeps its own schedule and Sunday is WO', () => {
    assert.equal(grade(MONDAY, ['08:30', '16:00']).status, 'PRESENT', '7h30 net on Monday');
    assert.equal(grade(MONDAY, ['08:30', '13:50']).status, 'HALF_DAY', 'Saturday’s hours on a Monday are short');
    assert.equal(grade(SUNDAY, []).status, 'WEEKLY_OFF');
  });

  test('7. holiday and approved leave still come first', () => {
    assert.equal(grade(SATURDAY, [], { extra: { holiday: { name: 'Holiday' } } }).status, 'HOLIDAY');
    assert.equal(grade(SATURDAY, [], { extra: { onLeave: true } }).status, 'ON_LEAVE');
  });

  test('8. the Night shift switch does not move these punches or change the grade', () => {
    assert.equal(attributeShiftDay(at(SATURDAY, '13:50'), GENERAL).toISOString(), startOfDay(at(SATURDAY, '12:00')).toISOString());
    assert.equal(attributeShiftDay(at(SUNDAY, '05:00'), GENERAL).toISOString(), startOfDay(at(SUNDAY, '12:00')).toISOString(), 'Saturday ends at 13:00, so nothing spills into Sunday');

    const withoutFlag = evaluateDay({ date: startOfDay(at(SATURDAY, '12:00')), punches: [punch(SATURDAY, '08:45'), punch(SATURDAY, '13:50')], shift: { ...GENERAL, isNightShift: false } });
    const withFlag = grade(SATURDAY, ['08:45', '13:50']);
    assert.equal(withFlag.status, withoutFlag.status);
    assert.equal(withFlag.workedMinutes, withoutFlag.workedMinutes);
    assert.equal(withFlag.isNightShift, true, 'it only labels the day');
  });

  test('9. a double touch adds no working time', () => {
    const result = grade(SATURDAY, ['08:45', '08:46', '13:50']);
    assert.equal(result.workedMinutes, 305);
    assert.equal(result.status, 'PRESENT');
  });

  test('10. the same times entered by hand are also Present', () => {
    const manual = deriveManualDay({ checkIn: at(SATURDAY, '08:45'), checkOut: at(SATURDAY, '13:50'), status: null, employee: { overtimeEligible: false }, date: at(SATURDAY, '12:00'), weeklyOffDays: [0] });
    assert.equal(manual.status, 'PRESENT');
    assert.equal(manual.workedMinutes, 305);
  });
});

describe('a day stored before the schedule existed', { skip: !reachable && 'MongoDB is not reachable on localhost' }, () => {
  const adminReq = { user: { id: null, tenantId: null, role: 'SUPER_ADMIN', email: 'admin@test' }, ip: null, get: () => null };

  before(async () => {
    await mongoose.connection.dropDatabase();
    await models.Attendance.syncIndexes();
    const { ensureSystemRoles } = await import('../services/admin/role.service.js');
    const { loadRoleCache } = await import('../services/auth/roleCache.service.js');
    await ensureSystemRoles();
    await loadRoleCache();
  });

  after(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  test('is listed with its shift, regraded to P on request, and every screen then agrees', async () => {
    const { default: Shift } = await import('../models/organization/shift.model.js');
    const shift = await Shift.create({ name: 'General / Operations', ...GENERAL });
    const employee = await models.Employee.create({ employeeCode: 'EMP00005', firstName: 'Abdalla', joiningDate: new Date('2018-08-30'), shiftId: shift._id, overtimeEligible: false });

    const stale = await models.Attendance.create({
      employeeId: employee._id,
      date: startOfDay(at(SATURDAY, '12:00')),
      punches: [punch(SATURDAY, '08:45'), punch(SATURDAY, '13:50')],
      checkInAt: at(SATURDAY, '08:45'),
      checkOutAt: at(SATURDAY, '13:50'),
      status: 'HALF_DAY',
      workedMinutes: 305,
      expectedMinutes: 509,
      source: 'BIOMETRIC',
    });
    // A weekday already right is not touched.
    await models.Attendance.create({ employeeId: employee._id, date: startOfDay(at(MONDAY, '12:00')), punches: [punch(MONDAY, '08:30'), punch(MONDAY, '17:00')], status: 'PRESENT', workedMinutes: 510, source: 'BIOMETRIC' });

    const recompute = await import('../scripts/recomputeSaturdays.js');
    const before = await models.Attendance.find({}).sort({ _id: 1 }).lean();

    const preview = await recompute.previewSaturdays({ everyDay: true });
    assert.deepEqual(await models.Attendance.find({}).sort({ _id: 1 }).lean(), before, 'the preview writes nothing');
    assert.equal(preview.changes.length, 1);

    const [change] = preview.changes;
    assert.equal(change.employeeCode, 'EMP00005');
    assert.equal(change.shiftCode, 'GEN');
    assert.equal(change.from.status, 'HALF_DAY');
    assert.equal(change.to.status, 'PRESENT');
    assert.equal(change.to.workedMinutes, 305);
    assert.equal(change.to.expectedMinutes, 210);

    await recompute.applySaturdays(preview.changes);

    const after = await models.Attendance.findById(stale._id).lean();
    assert.equal(after.status, 'PRESENT');
    assert.equal(after.overtimeMinutes, 0, 'not eligible for overtime');

    const reports = await import('../services/attendance/attendanceReport.service.js');
    const register = await reports.monthlyRegister({ year: 2026, month: 11, employeeId: String(employee._id) }, adminReq);
    assert.equal(register.employees[0].days.find((entry) => entry.day === 7).code, 'P', 'Monthly Attendance');

    const { rows } = await reports.monthlySummary({ year: 2026, month: 11 }, adminReq);
    assert.equal(rows.find((row) => row._id === String(employee._id)).halfDay, 0, 'Reports and what payroll reads');

    assert.equal((await recompute.previewSaturdays({ everyDay: true })).changes.length, 0, 'a second run finds nothing');
  });
});
