import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Server-side pagination of the Attendance Reports tabs, over HTTP with real
 * tokens. Every paged report is checked against the same report unpaged: the
 * pages, read in order, must be exactly the whole report -- same rows, same
 * figures, same order -- and every export must still carry every record.
 *
 * Runs against a THROWAWAY local database and refuses anything else.
 */

const TEST_URI = process.env.MONGODB_TEST_URI_REPORT_PAGES ?? 'mongodb://127.0.0.1:27017/hrms_report_pagination_test';

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
const YEAR = 2026;
const MONTH = 10;
const FROM = '2026-10-01';
const TO = '2026-10-31';
const PEOPLE = 60;

let server;
let base;
let token;
const units = {};
const departments = {};

const get = async (path) => {
  const response = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const type = response.headers.get('content-type') ?? '';
  return {
    status: response.status,
    headers: response.headers,
    body: type.includes('application/json') ? await response.json() : null,
  };
};

/** Every page of a report, in order, at `limit` per page. */
const allPages = async (path, limit, pick) => {
  const first = (await get(`${path}&page=1&limit=${limit}`)).body.data;
  const pages = [first];
  for (let page = 2; page <= first.pagination.totalPages; page += 1) {
    pages.push((await get(`${path}&page=${page}&limit=${limit}`)).body.data);
  }
  return { pages, rows: pages.flatMap(pick), pagination: first.pagination };
};

const checkPaging = async (path, pick, { expectTotal } = {}) => {
  const whole = (await get(path)).body.data;
  const all = pick(whole);
  assert.equal(whole.pagination, undefined, 'unpaged responses are unchanged');
  if (expectTotal !== undefined) assert.equal(all.length, expectTotal);

  for (const limit of [25, 50, 100]) {
    const { pages, rows, pagination } = await allPages(path, limit, pick);
    assert.equal(pagination.total, all.length, `total at ${limit}`);
    assert.equal(pagination.limit, limit);
    assert.equal(pagination.totalPages, Math.max(1, Math.ceil(all.length / limit)));
    pages.forEach((page, index) => {
      assert.equal(page.pagination.page, index + 1);
      // Full pages, then whatever remains on the last one.
      const expected = index < pages.length - 1 ? limit : all.length - limit * (pages.length - 1);
      assert.equal(pick(page).length, expected, `page ${index + 1} at ${limit}`);
    });
    assert.deepEqual(rows, all, `pages at ${limit} read back as the whole report`);
  }
  return all;
};

describe('attendance report pagination', { skip: !reachable && 'MongoDB is not reachable on localhost' }, () => {
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
    const shift = await models.Shift.create({ name: 'Day', code: 'DAY', startTime: '08:00', endTime: '17:00', breakMinutes: 60, weeklyOffs: [0] });

    const people = [];
    for (let index = 0; index < PEOPLE; index += 1) {
      people.push(
        await models.Employee.create({
          employeeCode: `P${String(index).padStart(3, '0')}`,
          employeeId: `${1000 + index}X`,
          firstName: 'Person',
          lastName: String(index),
          joiningDate: new Date('2025-01-01'),
          unitId: index % 3 === 0 ? units.B._id : units.A._id,
          departmentId: index % 2 === 0 ? departments.ops._id : departments.fin._id,
          status: 'ACTIVE',
          shiftId: shift._id,
        }),
      );
    }

    // A varied month: every status the reports count, and late, early and
    // overtime minutes, spread so each report has a few pages of rows.
    const records = [];
    people.forEach((employee, index) => {
      for (let day = 1; day <= 20; day += 1) {
        const date = startOfDay(new Date(YEAR, MONTH - 1, day, 12));
        if (date.getDay() === 0) continue;
        const pick = (index + day) % 9;
        const status = ['PRESENT', 'PRESENT', 'PRESENT', 'ABSENT', 'HALF_DAY', 'PRESENT', 'MISSING_PUNCH', 'ON_LEAVE', 'PRESENT'][pick];
        records.push({
          _id: new ObjectId(),
          tenantId: null,
          employeeId: employee._id,
          date,
          status,
          punches: [],
          anomalies: pick === 8 ? ['LATE_ARRIVAL'] : [],
          isRegularized: false,
          workedMinutes: status === 'PRESENT' ? 480 : status === 'HALF_DAY' ? 240 : 0,
          lateMinutes: pick === 1 || pick === 8 ? 5 + index : 0,
          earlyGoingMinutes: pick === 2 ? 10 + day : 0,
          overtimeMinutes: pick === 5 ? 30 + index : 0,
        });
      }
    });
    await mongoose.connection.db.collection('attendances').insertMany(records);

    const user = await models.User.create({
      firstName: 'T', lastName: 'Admin', email: 'admin@pages.test', password: 'Passw0rd!Passw0rd', role: 'SUPER_ADMIN', status: 'ACTIVE', isEmailVerified: true,
    });
    token = signAccessToken({ userId: user._id, tenantId: null, role: 'SUPER_ADMIN' });

    server = app.listen(0);
    base = `http://127.0.0.1:${server.address().port}/api/v1`;
  });

  after(async () => {
    server?.close();
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  test('monthly summary: pages read back as the whole report', async () => {
    await checkPaging(`/attendance/reports/summary?year=${YEAR}&month=${MONTH}`, (data) => data.rows, { expectTotal: PEOPLE });
  });

  test('monthly summary: the department filter is paged too', async () => {
    const all = await checkPaging(
      `/attendance/reports/summary?year=${YEAR}&month=${MONTH}&departmentId=${departments.ops._id}`,
      (data) => data.rows,
    );
    assert.equal(all.length, PEOPLE / 2);
  });

  test('by department / unit: pages read back as the whole report', async () => {
    await checkPaging(`/attendance/reports/grouped?year=${YEAR}&month=${MONTH}&groupBy=department`, (data) => data.rows);
    await checkPaging(`/attendance/reports/grouped?year=${YEAR}&month=${MONTH}&groupBy=unit`, (data) => data.rows);
  });

  for (const type of ['LATE', 'EARLY', 'HALF_DAY', 'OVERTIME', 'ABSENT']) {
    test(`${type} day report: pages, the roll-up and the filters`, async () => {
      const path = `/attendance/reports/days?type=${type}&from=${FROM}&to=${TO}`;
      const all = await checkPaging(path, (data) => data.rows);
      assert.ok(all.length > 25, `${type} has several pages to test (${all.length})`);

      // The by-employee roll-up covers the whole range on every page.
      const whole = (await get(path)).body.data;
      const paged = (await get(`${path}&page=2&limit=25`)).body.data;
      assert.deepEqual(paged.summary, whole.summary);
      assert.equal(paged.total, whole.total);

      // Department filter, paged.
      await checkPaging(`${path}&departmentId=${departments.fin._id}`, (data) => data.rows);
    });
  }

  test('exceptions: pages read back as the whole queue', async () => {
    const all = await checkPaging(`/attendance/reports/exceptions?from=${FROM}&to=${TO}`, (data) => data.items);
    assert.ok(all.length > 100);
    const paged = (await get(`/attendance/reports/exceptions?from=${FROM}&to=${TO}&page=1&limit=25`)).body.data;
    assert.equal(paged.total, all.length);
  });

  test('a page past the end answers with the last page', async () => {
    const { body } = await get(`/attendance/reports/summary?year=${YEAR}&month=${MONTH}&page=99&limit=25`);
    assert.equal(body.data.pagination.page, 3);
    assert.equal(body.data.rows.length, PEOPLE - 50);
  });

  test('only 25, 50 and 100 rows per page are accepted', async () => {
    assert.equal((await get(`/attendance/reports/summary?year=${YEAR}&month=${MONTH}&page=1&limit=10`)).status, 422);
    assert.equal((await get(`/attendance/reports/days?type=LATE&from=${FROM}&to=${TO}&limit=500`)).status, 422);
    assert.equal((await get(`/attendance/reports/exceptions?from=${FROM}&to=${TO}&page=0`)).status, 422);
  });

  test('exports carry every record even when asked with a page', async () => {
    const summary = await get(`/attendance/reports/export?year=${YEAR}&month=${MONTH}&page=1&limit=25`);
    assert.equal(summary.status, 200);
    assert.equal(summary.headers.get('x-total-count'), String(PEOPLE));

    const pdf = await get(`/attendance/reports/summary/pdf?year=${YEAR}&month=${MONTH}&page=2&limit=25`);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get('x-total-count'), String(PEOPLE));

    const late = (await get(`/attendance/reports/days?type=LATE&from=${FROM}&to=${TO}`)).body.data.total;
    const lateExport = await get(`/attendance/reports/days/export?type=LATE&from=${FROM}&to=${TO}&page=1&limit=25`);
    assert.equal(lateExport.status, 200);
    assert.equal(lateExport.headers.get('x-total-count'), String(late));
  });
});
