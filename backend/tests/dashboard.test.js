import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';

/**
 * The dashboard API, over HTTP with real tokens. Every section is checked
 * against the module it summarises -- the employee records, the monthly
 * attendance summary, the leave requests, the salary register -- so the
 * dashboard can never show a figure the module would not. Filters, unit
 * isolation and permissions are checked on every section.
 *
 * Runs against a THROWAWAY local database and refuses anything else.
 */

const TEST_URI = process.env.MONGODB_TEST_URI_DASHBOARD ?? 'mongodb://127.0.0.1:27017/hrms_dashboard_test';

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

const { default: app } = reachable ? await import('../app.js') : { default: null };
const models = reachable ? await import('../models/index.js') : {};
const { signAccessToken } = await import('../helpers/token.helper.js');
const { startOfDay } = await import('../helpers/attendanceRules.helper.js');

const { ObjectId } = mongoose.Types;
const NOW = new Date();
const YEAR = NOW.getFullYear();
const MONTH = NOW.getMonth() + 1;
const TODAY = startOfDay(NOW);

let server;
let base;
const tokens = {};
const units = {};
const departments = {};
const people = {};
let runId;

const get = async (role, path) => {
  const response = await fetch(`${base}${path}`, { headers: tokens[role] ? { Authorization: `Bearer ${tokens[role]}` } : {} });
  return { status: response.status, body: await response.json() };
};
const section = async (role, name, query = '') => get(role, `/dashboard/${name}?year=${YEAR}&month=${MONTH}${query}`);

describe('dashboard API', { skip: !reachable && 'MongoDB is not reachable on localhost' }, () => {
  before(async () => {
    await mongoose.connection.dropDatabase();
    const { ensureSystemRoles } = await import('../services/admin/role.service.js');
    const { loadRoleCache } = await import('../services/auth/roleCache.service.js');
    await ensureSystemRoles();
    await loadRoleCache();

    units.A = await models.Unit.create({ name: 'Unit A', code: 'A' });
    units.B = await models.Unit.create({ name: 'Unit B', code: 'B' });
    departments.ops = await models.Department.create({ name: 'Operations', code: 'OPS' });
    departments.fin = await models.Department.create({ name: 'Finance', code: 'FIN' });
    // Today is everybody's rest day on this shift, so unrecorded people count as weekly off.
    const restToday = await models.Shift.create({ name: 'Rest today', code: 'RST', startTime: '08:00', endTime: '17:00', breakMinutes: 60, weeklyOffs: [NOW.getDay()] });
    const workToday = await models.Shift.create({ name: 'Work today', code: 'WRK', startTime: '08:00', endTime: '17:00', breakMinutes: 60, weeklyOffs: [(NOW.getDay() + 3) % 7] });

    const make = (key, unit, department, status, shift, extra = {}) =>
      models.Employee.create({
        employeeCode: key.toUpperCase(),
        firstName: key,
        lastName: 'Person',
        joiningDate: new Date('2025-01-01'),
        unitId: units[unit]._id,
        departmentId: departments[department]._id,
        status,
        shiftId: shift._id,
        gender: key.endsWith('f') ? 'FEMALE' : 'MALE',
        ...extra,
      }).then((employee) => {
        people[key] = employee;
      });

    await make('a1', 'A', 'ops', 'ACTIVE', workToday);
    await make('a2f', 'A', 'ops', 'PROBATION', workToday);
    await make('a3', 'A', 'fin', 'PROBATION', restToday);
    await make('a4', 'A', 'fin', 'RESIGNED', workToday);
    await make('b1', 'B', 'ops', 'ACTIVE', workToday);
    await make('b2f', 'B', 'fin', 'NOTICE_PERIOD', restToday);

    const db = mongoose.connection.db;
    const dayRecord = (key, date, status, extra = {}) => ({ _id: new ObjectId(), tenantId: null, employeeId: people[key]._id, date, status, punches: [], anomalies: [], ...extra });
    const monthDay = (number) => startOfDay(new Date(YEAR, MONTH - 1, number, 12));
    await db.collection('attendances').insertMany([
      dayRecord('a1', TODAY, 'PRESENT', { overtimeMinutes: 90 }),
      dayRecord('a2f', TODAY, 'ON_LEAVE'),
      dayRecord('b1', TODAY, 'ABSENT'),
      ...(TODAY.getDate() > 1
        ? [
            dayRecord('a1', monthDay(1), 'PRESENT', { lateMinutes: 12 }),
            dayRecord('a2f', monthDay(1), 'MISSING_PUNCH', { checkInAt: new Date(), checkOutAt: null }),
            dayRecord('b1', monthDay(1), 'HALF_DAY'),
          ]
        : []),
    ]);

    await db.collection('regularizations').insertOne({ tenantId: null, employeeId: people.a1._id, status: 'PENDING', date: TODAY });

    const leaveType = await db.collection('leavetypes').insertOne({ tenantId: null, name: 'Annual', code: 'AL' });
    const leave = (key, status, from, to) => ({
      tenantId: null,
      employeeId: people[key]._id,
      leaveTypeId: leaveType.insertedId,
      requestNumber: `LR-${key}-${status}`,
      status,
      from,
      to,
      days: 1,
      year: YEAR,
      breakdown: [],
      createdAt: new Date(),
    });
    const inFuture = startOfDay(new Date(NOW.getTime() + 40 * 86_400_000));
    await db.collection('leaverequests').insertMany([
      leave('a2f', 'APPROVED', TODAY, TODAY),
      leave('a1', 'PENDING', TODAY, TODAY),
      leave('b1', 'PENDING', TODAY, TODAY),
      leave('a3', 'APPROVED', inFuture, inFuture),
    ]);

    runId = new ObjectId();
    await db.collection('payrollruns').insertOne({ _id: runId, tenantId: null, year: YEAR, month: MONTH, period: `${MONTH}/${YEAR}`, totalDaysInMonth: 30, status: 'PENDING_APPROVAL', totalGross: 0, totalNet: 0 });
    const slip = (key, basic, overtime, deductions, department) => ({
      tenantId: null,
      payrollRunId: runId,
      employeeId: people[key]._id,
      year: YEAR,
      month: MONTH,
      period: `${MONTH}/${YEAR}`,
      earnings: [
        { code: 'BASIC', name: 'Basic', amount: basic },
        { code: 'OVERTIME', name: 'Overtime', amount: overtime },
      ],
      deductions: [{ code: 'PAYE', name: 'PAYE', amount: deductions }],
      employerContributions: [],
      grossEarnings: basic + overtime,
      totalDeductions: deductions,
      employerContributionTotal: 0,
      netPayable: basic + overtime - deductions,
      status: 'DRAFT',
      employeeSnapshot: { employeeCode: people[key].employeeCode, fullName: key, department },
    });
    await db.collection('payslips').insertMany([
      slip('a1', 800_000, 50_000, 100_000, 'Operations'),
      slip('a2f', 600_000, 0, 60_000, 'Operations'),
      slip('b1', 3_000_000, 0, 500_000, 'Operations'),
    ]);

    const account = async (key, role, unitIds = [], employee = null) => {
      const user = await models.User.create({
        firstName: 'T', lastName: key, email: `${key}@dash.test`, password: 'Passw0rd!Passw0rd', role, status: 'ACTIVE', isEmailVerified: true,
        unitIds: unitIds.map((code) => units[code]._id), employeeId: employee?._id ?? null,
      });
      tokens[key] = signAccessToken({ userId: user._id, tenantId: null, role });
    };
    await account('admin', 'SUPER_ADMIN');
    await account('hrA', 'HR', ['A']);
    await account('employee', 'EMPLOYEE', [], people.a1);

    server = app.listen(0);
    base = `http://127.0.0.1:${server.address().port}/api/v1`;
  });

  after(async () => {
    server?.close();
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  test('employees: headcount and distributions match the records, and the filters narrow them', async () => {
    const all = (await section('admin', 'employees')).body.data;
    assert.equal(all.total, 6);
    assert.equal(all.active, 5, 'probation, active and notice period are employed');
    assert.equal(all.inactive, 1);
    assert.equal(all.probation, 2);
    assert.equal(all.noticePeriod, 1);
    assert.deepEqual(all.byUnit, [{ label: 'Unit A', value: 3 }, { label: 'Unit B', value: 2 }], 'employed people per unit');
    assert.deepEqual(all.byGender.map((row) => [row.label, row.value]), [['MALE', 3], ['FEMALE', 2]]);
    assert.equal(all.recentJoiners.length, 6);

    const unitA = (await section('admin', 'employees', `&unitId=${units.A._id}`)).body.data;
    assert.equal(unitA.total, 4);
    const finA = (await section('admin', 'employees', `&unitId=${units.A._id}&departmentId=${departments.fin._id}`)).body.data;
    assert.equal(finA.total, 2);
    assert.equal(finA.active, 1);
  });

  test('today: stored records by status, plus rest days and holidays nobody recorded', async () => {
    const day = (await section('admin', 'today')).body.data;
    assert.equal(day.present, 1);
    assert.equal(day.onLeave, 1);
    assert.equal(day.absent, 1);
    assert.equal(day.recorded, 3);
    assert.equal(day.employed, 5);
    // a3 and b2f rest today and have no record; a4 has left.
    assert.equal(day.weeklyOffOrHoliday, 2);

    const unitB = (await section('admin', 'today', `&unitId=${units.B._id}`)).body.data;
    assert.deepEqual([unitB.absent, unitB.present, unitB.weeklyOffOrHoliday], [1, 0, 1]);
  });

  test('attendance: the month is the attendance summary itself, narrowed by unit', async () => {
    const reports = await import('../services/attendance/attendanceReport.service.js');
    const adminReq = { user: { role: 'SUPER_ADMIN', tenantId: null, unitAccess: { all: true, unitIds: [], employeeIds: [] } } };
    const reference = await reports.monthlySummary({ year: YEAR, month: MONTH }, adminReq);
    const sum = (rows, key) => rows.reduce((total, row) => total + (row[key] ?? 0), 0);

    const all = (await section('admin', 'attendance')).body.data;
    for (const key of ['present', 'halfDay', 'absent', 'onLeave', 'weeklyOff', 'missingPunch', 'lateCount']) {
      assert.equal(all.totals[key], sum(reference.rows, key), key);
    }
    assert.equal(all.exceptions.pendingRegularizations, 1);
    assert.equal(all.totals.overtimeMinutes, sum(reference.rows, 'overtimeMinutes'));
    assert.deepEqual(all.overtimeTrend, [{ month: MONTH, overtimeMinutes: 90 }], 'the year by month, from the stored day records');
    assert.equal(all.trend.reduce((total, day) => total + day.present + day.absent + day.onLeave + day.halfDay, 0), TODAY.getDate() > 1 ? 5 : 3);

    const unitIds = new Set([people.b1, people.b2f].map((employee) => String(employee._id)));
    const unitB = (await section('admin', 'attendance', `&unitId=${units.B._id}`)).body.data;
    assert.equal(unitB.totals.employees, 2);
    assert.equal(unitB.totals.absent, sum(reference.rows.filter((row) => unitIds.has(row._id)), 'absent'));
    assert.equal(unitB.exceptions.pendingRegularizations, 0);
  });

  test('leave: requests by status, who is away today, and the queue', async () => {
    const all = (await section('admin', 'leave')).body.data;
    assert.equal(all.pending, 2);
    assert.equal(all.pendingTotal, 2);
    assert.equal(all.onLeaveToday, 1);
    assert.equal(all.upcomingApproved.length, 1);
    assert.equal(all.upcomingApproved[0].employee.employeeCode, 'A3');
    assert.equal(all.pendingRequests[0].leaveType, 'Annual');

    const unitB = (await section('admin', 'leave', `&unitId=${units.B._id}`)).body.data;
    assert.equal(unitB.pendingTotal, 1);
    assert.equal(unitB.onLeaveToday, 0);
  });

  test('payroll: the salary register, narrowed by unit -- never a figure of its own', async () => {
    const payrollReports = await import('../services/payroll/payrollReport.service.js');
    const adminReq = { user: { role: 'SUPER_ADMIN', tenantId: null, unitAccess: { all: true, unitIds: [], employeeIds: [] } } };
    const { rows } = await payrollReports.salaryRegister(runId, adminReq);
    const gross = rows.reduce((total, row) => total + row.gross, 0);
    const deductions = rows.reduce((total, row) => total + row.employeeDeductions, 0);

    const all = (await section('admin', 'payroll')).body.data;
    assert.equal(all.run.gross, gross);
    assert.equal(all.run.net, gross - deductions);
    assert.equal(all.run.overtime, 50_000);
    // The statutory split is the register's own columns, and adds back up to gross.
    assert.equal(all.run.breakdown.paye, rows.reduce((total, row) => total + row.paye, 0));
    assert.equal(all.run.net + all.run.breakdown.nssf + all.run.breakdown.nhif + all.run.breakdown.paye + all.run.breakdown.other, all.run.gross);
    assert.equal(all.run.employees, 3);
    assert.equal(all.awaitingApproval, 1);
    // Gross 850K and 600K fall in 500K–1M, 3M in 2.5M–5M.
    assert.deepEqual(all.bands.map((band) => band.employees), [0, 2, 0, 1, 0]);

    const unitA = (await section('admin', 'payroll', `&unitId=${units.A._id}`)).body.data;
    assert.equal(unitA.run.employees, 2);
    assert.equal(unitA.run.gross, rows.filter((row) => ['A1', 'A2F'].includes(row.employeeCode)).reduce((total, row) => total + row.gross, 0));
  });

  test('unit isolation: a unit-restricted HR sees only their unit, and asking for another is refused', async () => {
    const employees = (await section('hrA', 'employees')).body.data;
    assert.equal(employees.total, 4);
    assert.deepEqual(employees.byUnit.map((row) => row.label), ['Unit A']);
    assert.equal((await section('hrA', 'today')).body.data.employed, 3);
    assert.equal((await section('hrA', 'leave')).body.data.pendingTotal, 1);
    assert.equal((await section('hrA', 'payroll')).body.data.run.employees, 2, 'their unit’s payslips only');

    for (const name of ['employees', 'today', 'attendance', 'leave', 'payroll']) {
      const refused = await section('hrA', name, `&unitId=${units.B._id}`);
      assert.equal(refused.status, 403, name);
    }
  });

  test('permissions: each section asks for what its module asks for', async () => {
    assert.equal((await section('employee', 'employees')).status, 403, 'no employee:dashboard');
    assert.equal((await section('employee', 'payroll')).status, 403, 'no organisation-wide payroll');
    const own = await section('employee', 'leave');
    assert.equal(own.status, 200);
    assert.equal(own.body.data.pendingTotal, 1, 'their own request only');
    assert.equal((await section(null, 'employees')).status, 401);
    assert.equal((await get('admin', '/dashboard/employees?unitId=not-an-id')).status, 422);
  });
});
