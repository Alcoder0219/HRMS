import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Saturday: 5 h 30 m of eligible work is a full day, for everyone.
 *
 * The engine cases run on fixtures. The rest store real days in a THROWAWAY
 * local MongoDB and read them back through the screens' own services, and
 * regrade old Saturdays with the recompute command. Refuses any other
 * database. Pinned to the production zone.
 */

const TEST_URI = process.env.MONGODB_TEST_URI_SATURDAY_FULL ?? 'mongodb://127.0.0.1:27017/hrms_saturday_full_day_test';

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

const { evaluateDay, startOfDay } = await import('../helpers/attendanceRules.helper.js');

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
const minutesAfter = (date, start, minutes) => ({ time: new Date(at(date, start).getTime() + minutes * 60_000), source: 'BIOMETRIC', direction: 'UNKNOWN' });

// The office shift, with NO Saturday setting of its own: the company rule decides.
const GEN = { startTime: '08:30', endTime: '17:00', breakMinutes: 60, weeklyOffs: [0] };

const MONDAY = '2026-11-09';
const SATURDAY = '2026-11-14';
const SUNDAY = '2026-11-15';

const grade = (date, workedMinutes, { shift = GEN, policy = {}, start = '08:30' } = {}) =>
  evaluateDay({
    date: startOfDay(at(date, '12:00')),
    punches: workedMinutes === null ? [] : [punch(date, start), minutesAfter(date, start, workedMinutes)],
    shift,
    policy,
    isWeeklyOff: (shift?.weeklyOffs ?? [0]).includes(at(date, '12:00').getDay()),
  });

describe('the rule', () => {
  test('1-3. 5h30, 6h and 7h on a Saturday are all P', () => {
    for (const worked of [330, 360, 420]) {
      assert.equal(grade(SATURDAY, worked).status, 'PRESENT', `${worked} minutes`);
      assert.equal(grade(SATURDAY, worked, { shift: null }).status, 'PRESENT', `${worked} minutes, no shift assigned`);
    }
  });

  test('4. 5h29 does not qualify; the usual below-threshold rules apply', () => {
    assert.equal(grade(SATURDAY, 329).status, 'HALF_DAY');
    assert.equal(grade(SATURDAY, 329, { shift: null }).status, 'HALF_DAY');
    assert.equal(grade(SATURDAY, 300).status, 'HALF_DAY', '5h is half of the Saturday day or more');
    assert.equal(grade(SATURDAY, 120).status, 'ABSENT');
  });

  test('5. the weekday half-day bar cannot override a qualifying Saturday', () => {
    // A policy whose weekday bars sit far above 5h30 still gets P on Saturday.
    const strict = { fullDayMinutes: 540, halfDayMinutes: 400 };
    assert.equal(grade(SATURDAY, 330, { policy: strict }).status, 'PRESENT');
    assert.equal(grade(SATURDAY, 330, { shift: null, policy: strict }).status, 'PRESENT');
    assert.deepEqual(
      grade(MONDAY, 330, { policy: strict }),
      grade(MONDAY, 330, { policy: { ...strict, saturdayFullDayMinutes: 0 } }),
      'the same hours on a weekday are graded exactly as before',
    );
    assert.notEqual(grade(MONDAY, 330, { policy: strict }).status, 'PRESENT');
  });

  test('6. Monday to Friday are unchanged, with or without a shift', () => {
    const off = { saturdayFullDayMinutes: 0 };
    for (const worked of [510, 480, 330, 270, 120]) {
      for (const shift of [GEN, null]) {
        assert.deepEqual(grade(MONDAY, worked, { shift }), grade(MONDAY, worked, { shift, policy: off }), `${worked} min, ${shift ? 'shift' : 'no shift'}`);
      }
    }
    assert.equal(grade(MONDAY, 510).status, 'PRESENT');
    assert.equal(grade(MONDAY, 330).status, 'HALF_DAY');
  });

  test('7. Sunday is still WO', () => {
    assert.equal(grade(SUNDAY, null).status, 'WEEKLY_OFF');
  });

  test('8. where the break is deducted, 5h30 of work AFTER the break is required', () => {
    const policy = { countBreakAsWorked: false };
    // 6h30 at the door less the 1h break is 5h30 of eligible work.
    assert.equal(grade(SATURDAY, 390, { policy }).workedMinutes, 330);
    assert.equal(grade(SATURDAY, 390, { policy }).status, 'PRESENT');
    assert.equal(grade(SATURDAY, 389, { policy }).status, 'HALF_DAY');
  });

  test('9. a night shift that starts on Saturday is graded by the same rule', () => {
    const night = { startTime: '22:00', endTime: '06:00', breakMinutes: 30, isNightShift: true, weeklyOffs: [0] };
    const result = grade(SATURDAY, 330, { shift: night, start: '22:00' });

    assert.equal(result.status, 'PRESENT');
    assert.equal(result.checkOutAt.toISOString(), at('2026-11-15', '03:30').toISOString(), 'the exit after midnight is read');
    assert.equal(grade('2026-11-13', 330, { shift: night, start: '22:00' }).status, 'HALF_DAY', 'a Friday night is still a weekday');
  });

  test('a shift with its own Saturday figure keeps it; 0 switches the company rule off', () => {
    assert.equal(grade(SATURDAY, 330, { shift: { ...GEN, saturdayWorkMinutes: 360 } }).status, 'HALF_DAY');
    assert.equal(grade(SATURDAY, 360, { shift: { ...GEN, saturdayWorkMinutes: 360 } }).status, 'PRESENT');
    assert.equal(grade(SATURDAY, 330, { policy: { saturdayFullDayMinutes: 0 } }).status, 'HALF_DAY');
  });
});

describe('stored days and the screens', { skip: !reachable && 'MongoDB is not reachable on localhost' }, () => {
  const adminReq = { user: { id: null, tenantId: null, role: 'SUPER_ADMIN', email: 'admin@test' }, ip: null, get: () => null };
  let withShift;
  let withoutShift;
  let reports;
  let recompute;
  let attendance;

  before(async () => {
    await mongoose.connection.dropDatabase();
    await models.Attendance.syncIndexes();

    const { ensureSystemRoles } = await import('../services/admin/role.service.js');
    const { loadRoleCache } = await import('../services/auth/roleCache.service.js');
    await ensureSystemRoles();
    await loadRoleCache();

    reports = await import('../services/attendance/attendanceReport.service.js');
    recompute = await import('../scripts/recomputeSaturdays.js');
    attendance = await import('../services/attendance/attendance.service.js');

    const shift = await models.Shift.create({ name: 'General', code: 'GEN', ...GEN });
    withShift = await models.Employee.create({ employeeCode: 'SAT100', firstName: 'Shift', joiningDate: new Date('2025-01-01'), shiftId: shift._id, overtimeEligible: true });
    withoutShift = await models.Employee.create({ employeeCode: 'SAT200', firstName: 'NoShift', joiningDate: new Date('2025-01-01'), overtimeEligible: true });
  });

  after(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  /** A day stored as the old rules graded it: 5h30 marked HALF_DAY. */
  const staleSaturday = (employee, date, extra = {}) =>
    models.Attendance.create({
      employeeId: employee._id,
      date: startOfDay(at(date, '12:00')),
      punches: [punch(date, '08:30'), punch(date, '14:00')],
      checkInAt: at(date, '08:30'),
      checkOutAt: at(date, '14:00'),
      status: 'HALF_DAY',
      workedMinutes: 330,
      expectedMinutes: 510,
      source: 'BIOMETRIC',
      ...extra,
    });

  const codeOn = async (employee, year, month, day) => {
    const register = await reports.monthlyRegister({ year, month, employeeId: String(employee._id) }, adminReq);
    return register.employees[0].days.find((entry) => entry.day === day).code;
  };

  test('10-11. a new Saturday is stored as P, and every screen reads P', async () => {
    for (const employee of [withShift, withoutShift]) {
      await models.Attendance.create({ employeeId: employee._id, date: startOfDay(at(SATURDAY, '12:00')), punches: [punch(SATURDAY, '08:30'), punch(SATURDAY, '14:00')], source: 'BIOMETRIC', status: 'ABSENT' });
      await attendance.recomputeDay(employee, at(SATURDAY, '12:00'), {});

      assert.equal(await codeOn(employee, 2026, 11, 14), 'P', `Monthly Attendance, ${employee.employeeCode}`);

      const { rows } = await reports.monthlySummary({ year: 2026, month: 11 }, adminReq);
      const summary = rows.find((row) => row._id === String(employee._id));
      assert.equal(summary.present, 1, 'Reports, and the Excel and PDF exports built from them');
      assert.equal(summary.halfDay, 0);

      const calendar = await attendance.getMonthlyCalendar({ employeeId: String(employee._id), year: 2026, month: 11 }, adminReq);
      const saturday = calendar.days.find((entry) => startOfDay(entry.date).getTime() === startOfDay(at(SATURDAY, '12:00')).getTime());
      assert.equal(saturday.status, 'PRESENT', 'My Attendance and Attendance History');
    }

    const register = await attendance.listAttendance({ from: SATURDAY, to: SATURDAY, page: 1, limit: 25 }, adminReq);
    assert.equal(register.items.length, 2);
    assert.ok(register.items.every((row) => row.status === 'PRESENT'), 'Attendance Register');
  });

  test('stale Saturdays: previewed, then regraded to P; protected days are left alone', async () => {
    const OCT_SATURDAY = '2026-10-31';
    await staleSaturday(withShift, OCT_SATURDAY);
    await staleSaturday(withoutShift, OCT_SATURDAY);
    await staleSaturday(withShift, '2026-10-24', { source: 'MANUAL' });
    await staleSaturday(withShift, '2026-10-17', { isRegularized: true });
    await staleSaturday(withShift, '2026-10-10', { isLocked: true });
    await staleSaturday(withShift, '2026-10-03', { overrideStatus: 'ON_DUTY' });
    // A genuinely short Saturday must not move.
    await models.Attendance.create({ employeeId: withoutShift._id, date: startOfDay(at('2026-10-24', '12:00')), punches: [punch('2026-10-24', '08:30'), punch('2026-10-24', '13:00')], status: 'HALF_DAY', workedMinutes: 270, expectedMinutes: 270, source: 'BIOMETRIC' });

    const snapshot = async () => models.Attendance.find({}).sort({ _id: 1 }).lean();
    const before = await snapshot();

    const preview = await recompute.previewSaturdays();
    assert.deepEqual(await snapshot(), before, 'the preview writes nothing');

    const moves = preview.changes.map((change) => `${change.employeeCode} ${change.day.getDate()} ${change.from.status}->${change.to.status}`).sort();
    assert.deepEqual(moves, ['SAT100 31 HALF_DAY->PRESENT', 'SAT200 31 HALF_DAY->PRESENT']);
    assert.deepEqual(preview.skipped, { 'corrected by hand': 1, regularized: 1, locked: 1, 'status set by an administrator': 1 });

    assert.equal(await recompute.applySaturdays(preview.changes), 2);
    assert.equal(await codeOn(withShift, 2026, 10, 31), 'P');
    assert.equal(await codeOn(withoutShift, 2026, 10, 31), 'P');

    // 12. Protected days are exactly as they were.
    const after = await snapshot();
    const untouched = (record) => !preview.changes.some((change) => String(change.record._id) === String(record._id));
    assert.deepEqual(after.filter(untouched), before.filter(untouched));

    assert.equal((await recompute.previewSaturdays()).changes.length, 0, 'a second run finds nothing');
  });

  test('a month with a payroll run is not regraded', async () => {
    await staleSaturday(withShift, '2026-09-26');
    await mongoose.connection.db.collection('payrollruns').insertOne({ year: 2026, month: 9, status: 'APPROVED' });

    const preview = await recompute.previewSaturdays({ from: '2026-09-01', to: '2026-09-30' });
    assert.equal(preview.changes.length, 0);
    assert.equal(preview.skipped['month already has a payroll run'], 1);

    const allowed = await recompute.previewSaturdays({ from: '2026-09-01', to: '2026-09-30', allowPayrollMonths: ['2026-9'] });
    assert.equal(allowed.changes.length, 1, 'only when that month is named on purpose');
  });
});
