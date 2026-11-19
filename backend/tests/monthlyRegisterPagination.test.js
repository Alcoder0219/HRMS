import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Monthly Attendance pagination, over HTTP with real tokens.
 *
 * The register without `page`/`limit` is the reference: every page must hold
 * exactly the rows it holds, in its order, with identical days and totals, and
 * the filters must select exactly what the screen's own filter selected.
 *
 * Runs against a THROWAWAY local database and refuses anything else.
 */

const TEST_URI = process.env.MONGODB_TEST_URI_PAGING ?? 'mongodb://127.0.0.1:27017/hrms_register_paging_test';

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
const ExcelJS = (await import('exceljs')).default;

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

const YEAR = 2026;
const MONTH = 10;
const PEOPLE_A = 162;

let server;
let base;
const tokens = {};
const units = {};
const shifts = {};
const departments = {};

const get = async (role, path) => {
  const response = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${tokens[role]}` } });
  const type = response.headers.get('content-type') ?? '';
  return { status: response.status, body: type.includes('json') ? await response.json() : Buffer.from(await response.arrayBuffer()) };
};

const register = async (role, query = '') => (await get(role, `/attendance/reports/monthly?year=${YEAR}&month=${MONTH}${query}`)).body.data;

/** Every page, stitched back together. */
const allPages = async (role, query, limit) => {
  const first = await register(role, `${query}&page=1&limit=${limit}`);
  const rows = [...first.employees];
  for (let page = 2; page <= first.pagination.totalPages; page += 1) {
    rows.push(...(await register(role, `${query}&page=${page}&limit=${limit}`)).employees);
  }
  return { first, rows };
};

/** The screen's own filter rule, as it ran on the full register before paging. */
const screenFilter = (rows, { overtime = '', minimum = 0, shiftId = '' } = {}) =>
  rows.filter((row) => {
    const minutes = row.totals?.overtimeMinutes ?? 0;
    if (overtime === 'with' && minutes <= 0) return false;
    if (overtime === 'without' && minutes > 0) return false;
    if (minimum > 0 && minutes < minimum) return false;
    if (shiftId && row.employee?.shiftId !== shiftId) return false;
    return true;
  });

describe('Monthly Attendance pagination', { skip: !reachable && 'MongoDB is not reachable on localhost' }, () => {
  before(async () => {
    await mongoose.connection.dropDatabase();
    const { ensureSystemRoles } = await import('../services/admin/role.service.js');
    const { loadRoleCache } = await import('../services/auth/roleCache.service.js');
    await ensureSystemRoles();
    await loadRoleCache();

    units.A = await models.Unit.create({ name: 'Unit A', code: 'A' });
    units.B = await models.Unit.create({ name: 'Unit B', code: 'B' });
    shifts.day = await models.Shift.create({ name: 'Day', code: 'DAY', startTime: '08:00', endTime: '17:00', breakMinutes: 60 });
    shifts.night = await models.Shift.create({ name: 'Night', code: 'NGT', startTime: '20:00', endTime: '05:00', breakMinutes: 60, isNightShift: true });
    departments.ops = await models.Department.create({ name: 'Operations', code: 'OPS' });
    departments.fin = await models.Department.create({ name: 'Finance', code: 'FIN' });

    // 162 people in unit A (as on site), 7 in unit B. Codes are inserted out of
    // order so the register's ordering, not insertion order, is what is tested.
    const people = [];
    for (let index = PEOPLE_A; index >= 1; index -= 1) {
      people.push({
        employeeCode: `EMP${String(index).padStart(5, '0')}`,
        firstName: `A${index}`,
        lastName: 'Person',
        joiningDate: new Date('2025-01-01'),
        unitId: units.A._id,
        shiftId: index % 3 === 0 ? shifts.night._id : shifts.day._id,
        departmentId: index % 2 === 0 ? departments.ops._id : departments.fin._id,
        overtimeEligible: true,
      });
    }
    for (let index = 1; index <= 7; index += 1) {
      people.push({ employeeCode: `EMPB${index}`, firstName: `B${index}`, lastName: 'Person', joiningDate: new Date('2025-01-01'), unitId: units.B._id, shiftId: shifts.day._id });
    }
    const employees = await models.Employee.insertMany(people);

    // Daily records with a spread of statuses and overtime.
    const statuses = ['PRESENT', 'ABSENT', 'HALF_DAY', 'ON_LEAVE', 'MISSING_PUNCH', 'PRESENT', 'PRESENT'];
    const days = [];
    employees.forEach((employee, index) => {
      for (let day = 1; day <= 12; day += 1) {
        days.push({
          tenantId: null,
          employeeId: employee._id,
          date: startOfDay(new Date(YEAR, MONTH - 1, day, 12)),
          status: statuses[(index + day) % statuses.length],
          workedMinutes: 480,
          // Every fifth person works no overtime; the rest 0-75 minutes a day.
          overtimeMinutes: index % 5 === 0 ? 0 : ((index + day) % 6) * 15,
          lateMinutes: day % 4 === 0 ? 10 : 0,
          punches: [],
          anomalies: [],
        });
      }
    });
    await mongoose.connection.db.collection('attendances').insertMany(days);

    for (const [key, role, unitIds] of [['admin', 'SUPER_ADMIN', []], ['hrA', 'HR', [units.A._id]], ['hrB', 'HR', [units.B._id]]]) {
      const user = await models.User.create({ firstName: 'T', lastName: key, email: `${key}@paging.test`, password: 'Passw0rd!Passw0rd', role, status: 'ACTIVE', isEmailVerified: true, unitIds });
      tokens[key] = signAccessToken({ userId: user._id, tenantId: null, role });
    }

    server = app.listen(0);
    base = `http://127.0.0.1:${server.address().port}/api/v1`;
  });

  after(async () => {
    server?.close();
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  test('1 and 4. the first page holds 25 employees, with the right totals and page count', async () => {
    const page = await register('hrA', '&page=1&limit=25');
    assert.equal(page.employees.length, 25);
    assert.deepEqual(
      { page: page.pagination.page, limit: page.pagination.limit, total: page.pagination.total, totalPages: page.pagination.totalPages },
      { page: 1, limit: 25, total: PEOPLE_A, totalPages: 7 },
    );
    assert.equal(page.employees[0].employee.employeeCode, 'EMP00001');
    assert.equal(page.daysInMonth, 31);
    assert.ok(page.legend && Array.isArray(page.holidays));
  });

  test('2, 3, 9 and 12. every page size reproduces the full register exactly: same rows, order, days and totals, none repeated or skipped', async () => {
    const reference = (await register('hrA')).employees;
    assert.equal(reference.length, PEOPLE_A);
    assert.equal(reference.pagination, undefined, 'unpaged callers are unchanged');

    for (const limit of [25, 50, 100]) {
      const { first, rows } = await allPages('hrA', '', limit);
      assert.equal(first.pagination.totalPages, Math.ceil(PEOPLE_A / limit), `limit ${limit}`);
      assert.deepEqual(rows, reference, `limit ${limit}: identical to the unpaged register`);
      assert.equal(new Set(rows.map((row) => row.employee.id)).size, PEOPLE_A, `limit ${limit}: no duplicates`);
    }

    const last = await register('hrA', '&page=7&limit=25');
    assert.equal(last.employees.length, PEOPLE_A - 6 * 25);
    const beyond = await register('hrA', '&page=99&limit=25');
    assert.equal(beyond.pagination.page, 7, 'a page past the end shows the last page');
  });

  test('5. month and year still decide the data', async () => {
    const september = await get('hrA', `/attendance/reports/monthly?year=${YEAR}&month=9&page=1&limit=25`);
    assert.equal(september.body.data.daysInMonth, 30);
    assert.ok(september.body.data.employees.every((row) => row.totals.overtimeMinutes === 0), 'no records in September');
    assert.equal(september.body.data.pagination.total, PEOPLE_A);
  });

  test('6 and 7. department, shift, overtime and minimum OT select exactly what the screen selected before', async () => {
    const reference = (await register('hrA')).employees;
    const night = String(shifts.night._id);
    const cases = [
      { query: `&departmentId=${departments.ops._id}`, expected: (await register('hrA', `&departmentId=${departments.ops._id}`)).employees },
      { query: `&shiftId=${night}`, expected: screenFilter(reference, { shiftId: night }) },
      { query: '&hasOvertime=true', expected: screenFilter(reference, { overtime: 'with' }) },
      { query: '&hasOvertime=false', expected: screenFilter(reference, { overtime: 'without' }) },
      { query: '&minOvertimeMinutes=300', expected: screenFilter(reference, { minimum: 300 }) },
      { query: `&shiftId=${night}&hasOvertime=true&minOvertimeMinutes=200`, expected: screenFilter(reference, { shiftId: night, overtime: 'with', minimum: 200 }) },
    ];

    for (const { query, expected } of cases) {
      const { first, rows } = await allPages('hrA', query, 25);
      assert.ok(expected.length > 0 && expected.length < PEOPLE_A, `${query}: a real subset (${expected.length})`);
      assert.deepEqual(rows, expected, query);
      assert.equal(first.pagination.total, expected.length, `${query}: count`);
      assert.equal(
        first.pagination.overtimeTotal,
        expected.reduce((sum, row) => sum + row.totals.overtimeMinutes, 0),
        `${query}: overtime chip`,
      );
    }
  });

  test('8. a filtered page 1 starts at the first matching employee', async () => {
    const reference = screenFilter((await register('hrA')).employees, { overtime: 'without' });
    const page = await register('hrA', '&hasOvertime=false&page=1&limit=25');
    assert.equal(page.employees[0].employee.id, reference[0].employee.id);
    assert.equal(page.pagination.page, 1);
  });

  test('empty results keep the legend and holidays', async () => {
    const none = await register('hrA', '&minOvertimeMinutes=99999&page=1&limit=25');
    assert.equal(none.employees.length, 0);
    assert.equal(none.pagination.total, 0);
    assert.equal(none.pagination.totalPages, 1);
    assert.ok(none.legend);
  });

  test('11. unit restriction comes first: counts and pages cover only the caller’s unit', async () => {
    const unitB = await register('hrB', '&page=1&limit=25');
    assert.equal(unitB.pagination.total, 7);
    assert.ok(unitB.employees.every((row) => row.employee.employeeCode.startsWith('EMPB')));

    const everyone = await register('admin', '&page=1&limit=100');
    assert.equal(everyone.pagination.total, PEOPLE_A + 7);

    const allOfA = (await allPages('hrA', '', 100)).rows;
    assert.ok(allOfA.every((row) => !row.employee.employeeCode.startsWith('EMPB')), 'no unit B employee on any unit A page');
  });

  test('only the page sizes 25, 50 and 100 are accepted', async () => {
    assert.equal((await get('hrA', `/attendance/reports/monthly?year=${YEAR}&month=${MONTH}&page=1&limit=30`)).status, 422);
    assert.equal((await get('hrA', `/attendance/reports/monthly?year=${YEAR}&month=${MONTH}&page=0&limit=25`)).status, 422);
  });

  test('Unit filter: each unit shows exactly its own employees, with unchanged rows and totals', async () => {
    units.C = units.C ?? (await models.Unit.create({ name: 'Unit C (empty)', code: 'C' }));
    const everyone = (await register('admin')).employees;

    for (const [code, size] of [['A', PEOPLE_A], ['B', 7], ['C', 0]]) {
      const unitId = String(units[code]._id);
      const expected = (await register('admin', `&unitId=${unitId}`)).employees;
      assert.equal(expected.length, size, `unit ${code} (unpaged)`);
      // The same rows as the all-units register shows for those employees.
      assert.deepEqual(expected, everyone.filter((row) => expected.some((own) => own.employee.id === row.employee.id)));

      const { first, rows } = await allPages('admin', `&unitId=${unitId}`, 25);
      assert.equal(first.pagination.total, size, `unit ${code}: count`);
      assert.equal(first.pagination.totalPages, Math.max(1, Math.ceil(size / 25)));
      assert.deepEqual(rows, expected, `unit ${code}: pages reproduce the unit's register`);
      assert.equal(first.pagination.overtimeTotal, expected.reduce((sum, row) => sum + row.totals.overtimeMinutes, 0));
    }

    const all = await register('admin', '&page=1&limit=25');
    assert.equal(all.pagination.total, PEOPLE_A + 7, 'All Units is everything the user may see');
  });

  test('Unit filter combines with department, shift, overtime and minimum OT', async () => {
    const unitA = String(units.A._id);
    const night = String(shifts.night._id);
    const reference = (await register('admin', `&unitId=${unitA}&departmentId=${departments.ops._id}`)).employees;
    const expected = screenFilter(reference, { shiftId: night, overtime: 'with', minimum: 200 });
    assert.ok(expected.length > 0 && expected.length < reference.length);

    const { first, rows } = await allPages('admin', `&unitId=${unitA}&departmentId=${departments.ops._id}&shiftId=${night}&hasOvertime=true&minOvertimeMinutes=200`, 25);
    assert.deepEqual(rows, expected);
    assert.equal(first.pagination.total, expected.length);
  });

  test("Unit filter cannot reach another unit: a restricted user's request for it is refused (403)", async () => {
    const asked = await get('hrA', `/attendance/reports/monthly?year=${YEAR}&month=${MONTH}&unitId=${units.B._id}&page=1&limit=25`);
    assert.equal(asked.status, 403);
    assert.ok(JSON.stringify(asked.body).includes('RBAC_UNIT_DENIED'));
    assert.equal((await get('hrA', `/attendance/reports/monthly?year=${YEAR}&month=${MONTH}&unitId=${units.B._id}`)).status, 403, 'unpaged too');

    const own = await register('hrA', `&unitId=${units.A._id}&page=1&limit=25`);
    assert.equal(own.pagination.total, PEOPLE_A, 'its own unit works');
    assert.equal((await get('hrA', `/attendance/reports/monthly?year=${YEAR}&month=${MONTH}&unitId=not-an-id`)).status, 422);
  });

  test('the unit dropdown lists the active units from the Units master, limited to the user', async () => {
    const inactive = await models.Unit.create({ name: 'Closed site', code: 'X', isActive: false });
    const forAdmin = (await get('admin', '/organization/masters')).body.data.units.map((unit) => unit.code).sort();
    assert.ok(forAdmin.includes('A') && forAdmin.includes('B') && !forAdmin.includes('X'), 'active units only');
    assert.deepEqual((await get('hrA', '/organization/masters')).body.data.units.map((unit) => unit.code), ['A']);
    await models.Unit.deleteOne({ _id: inactive._id });
  });

  test('10. export still covers the complete filtered month, whatever page is on screen', async () => {
    const response = await get('hrA', `/attendance/reports/export?year=${YEAR}&month=${MONTH}`);
    assert.equal(response.status, 200);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(response.body);
    const codes = new Set();
    book.worksheets[0].eachRow((row) => row.values.forEach((value) => typeof value === 'string' && /^EMP\d{5}$/.test(value) && codes.add(value)));
    assert.equal(codes.size, PEOPLE_A, 'every unit A employee, not one page');
  });
});
