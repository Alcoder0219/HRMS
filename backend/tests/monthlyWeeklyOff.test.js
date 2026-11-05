import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Rest days on the monthly screens.
 *
 * An unworked Sunday has no attendance record, so the register showed it blank.
 * These pin what it shows now, what still takes precedence over it, and that
 * reading a report writes nothing. Runs in the production zone against a
 * THROWAWAY local database, and refuses anything else.
 */

const TEST_URI = process.env.MONGODB_TEST_URI_WEEKLY_OFF ?? 'mongodb://127.0.0.1:27017/hrms_weekly_off_test';

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

const { Attendance, Employee, Holiday, Shift } = reachable ? await import('../models/index.js') : {};
const reports = reachable ? await import('../services/attendance/attendanceReport.service.js') : {};
const { unrecordedWeeklyOffs } = await import('../services/attendance/weeklyOff.service.js');
const { startOfDay } = await import('../helpers/attendanceRules.helper.js');

const adminReq = { user: { id: null, tenantId: null, role: 'SUPER_ADMIN', email: 'admin@test' }, ip: '127.0.0.1', get: () => null };

/** Sundays by calendar, written out so a wrong weekday cannot agree with itself. */
const SUNDAYS = {
  '2026-10': [4, 11, 18, 25],
  '2026-11': [1, 8, 15, 22, 29],
  '2026-12': [6, 13, 20, 27],
  '2027-01': [3, 10, 17, 24, 31],
};

const dayKey = (year, month, day) => startOfDay(new Date(year, month - 1, day));

const employee = (code, extra = {}) =>
  Employee.create({ employeeCode: code, firstName: `Test ${code}`, joiningDate: new Date('2025-01-01'), ...extra });

const row = async (person, year, month) => {
  const register = await reports.monthlyRegister({ year, month, employeeId: String(person._id) }, adminReq);
  return register.employees[0];
};

const rowFor = (rows, person) => rows.find((entry) => entry._id === String(person._id));

describe('weekly offs on the monthly screens', { skip: !reachable && 'MongoDB is not reachable on localhost' }, () => {
  before(async () => {
    await mongoose.connection.dropDatabase();

    const { ensureSystemRoles } = await import('../services/admin/role.service.js');
    const { loadRoleCache } = await import('../services/auth/roleCache.service.js');
    await ensureSystemRoles();
    await loadRoleCache();
  });

  after(async () => {
    process.env.TZ = 'Asia/Kolkata';
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  for (const [period, sundays] of Object.entries(SUNDAYS)) {
    test(`${period}: every Sunday is WO and no other day is`, async () => {
      const [year, month] = period.split('-').map(Number);
      const person = await employee(`SUN${period}`);
      const { days } = await row(person, year, month);

      assert.deepEqual(days.filter((day) => day.code === 'WO').map((day) => day.day), sundays);
      assert.ok(days.filter((day) => !sundays.includes(day.day)).every((day) => day.code === '-' && day.status === null));
      days.filter((day) => day.code === 'WO').forEach((day) => assert.equal(day.status, 'WEEKLY_OFF'));
    });
  }

  test('the same Sundays whichever zone the server runs in', () => {
    for (const zone of ['Asia/Kolkata', 'Africa/Dar_es_Salaam', 'UTC', 'America/New_York', 'Pacific/Auckland']) {
      process.env.TZ = zone;
      const { days } = unrecordedWeeklyOffs({ year: 2026, month: 11, employee: {}, weeklyOffDays: [0], recordedDays: new Set(), now: new Date('2026-12-15') });
      assert.deepEqual([...days], SUNDAYS['2026-11'], zone);
    }
    process.env.TZ = 'Asia/Kolkata';
  });

  test('a record on a Sunday wins: worked, leave and a correction all stay', async () => {
    const person = await employee('KEEP01');

    await Attendance.create([
      { employeeId: person._id, date: dayKey(2026, 11, 1), status: 'PRESENT', source: 'BIOMETRIC', workedMinutes: 300, overtimeMinutes: 300 },
      { employeeId: person._id, date: dayKey(2026, 11, 8), status: 'ON_LEAVE', source: 'MANUAL' },
      { employeeId: person._id, date: dayKey(2026, 11, 15), status: 'ON_DUTY', source: 'MANUAL' },
    ]);

    const { days, totals } = await row(person, 2026, 11);
    const code = (day) => days.find((entry) => entry.day === day).code;

    assert.equal(code(1), 'P');
    assert.equal(code(8), 'L');
    assert.equal(code(15), 'OD');
    assert.equal(code(22), 'WO');
    assert.equal(code(29), 'WO');
    assert.equal(totals.overtimeMinutes, 300, 'overtime is what was stored');
  });

  test('a shift’s own rest days are kept, and it gets no Sunday it did not ask for', async () => {
    const shift = await Shift.create({ name: 'Friday rest', code: 'FRI', startTime: '09:00', endTime: '18:00', weeklyOffs: [5] });
    const person = await employee('SHIFT1', { shiftId: shift._id });

    const { days } = await row(person, 2026, 11);
    assert.deepEqual(days.filter((day) => day.code === 'WO').map((day) => day.day), [6, 13, 20, 27]);
  });

  test('a holiday on a Sunday is left to the holiday rules; one for another department is not', async () => {
    const mine = new mongoose.Types.ObjectId();
    const theirs = new mongoose.Types.ObjectId();
    const holiday = (name, date, extra = {}) => Holiday.create({ tenantId: null, name, date, ...extra });

    await holiday('Everyone', dayKey(2027, 1, 3));
    await holiday('Their department', dayKey(2027, 1, 10), { departmentIds: [theirs] });
    await holiday('Optional', dayKey(2027, 1, 17), { isOptional: true });

    const person = await employee('HOLI01', { departmentId: mine });
    const { days } = await row(person, 2027, 1);
    const code = (day) => days.find((entry) => entry.day === day).code;

    assert.equal(code(3), '-', 'a company holiday is not a weekly off');
    assert.equal(code(10), 'WO');
    assert.equal(code(17), 'WO');
  });

  test('no weekly off before joining or after the last working day', () => {
    const { days } = unrecordedWeeklyOffs({
      year: 2026,
      month: 11,
      employee: { joiningDate: new Date('2026-11-05'), lifecycle: { lastWorkingDate: new Date('2026-11-20') } },
      weeklyOffDays: [0],
      recordedDays: new Set(),
      now: new Date('2026-12-15'),
    });
    assert.deepEqual([...days], [8, 15]);
  });

  test('future Sundays are shown but not counted', () => {
    const { days, elapsed } = unrecordedWeeklyOffs({
      year: 2026, month: 11, employee: {}, weeklyOffDays: [0], recordedDays: new Set(), now: new Date('2026-11-09T06:00:00Z'),
    });
    assert.deepEqual([...days], SUNDAYS['2026-11']);
    assert.equal(elapsed, 2);
  });

  test('the register, summary, export data and grouped report agree', async () => {
    const person = await employee('AGREE1');
    await Attendance.create({ employeeId: person._id, date: dayKey(2026, 10, 5), status: 'PRESENT', source: 'BIOMETRIC', workedMinutes: 480 });

    const { totals } = await row(person, 2026, 10);
    const { rows } = await reports.monthlySummary({ year: 2026, month: 10 }, adminReq);
    const summary = rowFor(rows, person);

    assert.equal(totals.weeklyOff, 4);
    assert.equal(totals.present, 1);
    assert.equal(totals.payableDays, 5);
    assert.equal(summary.weeklyOff, 4, 'the Excel and PDF exports read this row');
    assert.equal(summary.payableDays, 5);

    const grouped = await reports.groupedReport({ year: 2026, month: 10 }, adminReq);
    assert.equal(grouped.rows.reduce((sum, entry) => sum + entry.weeklyOff, 0), rows.reduce((sum, entry) => sum + entry.weeklyOff, 0));
  });

  test('reading the reports writes no attendance', async () => {
    const before = await Attendance.countDocuments();
    const person = await employee('READ01');

    await row(person, 2026, 12);
    await reports.monthlySummary({ year: 2026, month: 12 }, adminReq);
    await reports.groupedReport({ year: 2026, month: 12 }, adminReq);

    assert.equal(await Attendance.countDocuments(), before);
  });
});
