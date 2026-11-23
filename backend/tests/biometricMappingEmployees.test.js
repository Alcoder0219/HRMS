import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Map Users: every employee must be reachable from the Employee picker, not
 * just the first 200 by code.
 *
 * The picker pages and searches the existing employee list API; this checks,
 * over HTTP with a real token, that paging covers every employee once, that a
 * code, employee ID or name finds someone far past the old cut-off, that the
 * device users endpoint names a saved mapping's employee wherever it sits, and
 * that saving keeps its existing rules.
 *
 * Runs against a THROWAWAY local database and refuses anything else.
 */

const TEST_URI = process.env.MONGODB_TEST_URI_MAPPING ?? 'mongodb://127.0.0.1:27017/hrms_mapping_employees_test';

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

const TOTAL = 260;
const code = (number) => `EMP${String(number).padStart(5, '0')}`;

let server;
let base;
let token;
let deviceId;

const call = async (path, { method = 'GET', body } = {}) => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
};

/** Exactly what the picker asks for. */
const pickerPage = (page, search = '') =>
  call(`/employees?page=${page}&limit=50&sortBy=employeeCode&sortOrder=asc${search ? `&search=${encodeURIComponent(search)}` : ''}`);

describe('Map Users employee picker', { skip: !reachable && 'MongoDB is not reachable on localhost' }, () => {
  before(async () => {
    await mongoose.connection.dropDatabase();
    const { ensureSystemRoles } = await import('../services/admin/role.service.js');
    const { loadRoleCache } = await import('../services/auth/roleCache.service.js');
    await ensureSystemRoles();
    await loadRoleCache();

    // Codes with gaps, as on site, so the 200th employee is past EMP00200.
    const people = [];
    for (let number = 1, made = 0; made < TOTAL; number += 1) {
      if (number % 13 === 0) continue;
      made += 1;
      people.push({
        employeeCode: code(number),
        employeeId: `${String(10000 + number)}X`,
        firstName: number === 270 ? 'Zuhura' : `First${number}`,
        lastName: number === 270 ? 'Mwinyi' : 'Person',
        joiningDate: new Date('2025-01-01'),
      });
    }
    await models.Employee.insertMany(people);
    // A deleted employee is never offered.
    await models.Employee.create({ employeeCode: 'EMP09999', firstName: 'Gone', joiningDate: new Date('2025-01-01'), deletedAt: new Date() });

    const admin = await models.User.create({ firstName: 'A', lastName: 'Admin', email: 'admin@mapping.test', password: 'Passw0rd!Passw0rd', role: 'SUPER_ADMIN', status: 'ACTIVE', isEmailVerified: true });
    token = signAccessToken({ userId: admin._id, tenantId: null, role: 'SUPER_ADMIN' });

    const settings = await models.AppSettings.create({
      tenantId: null,
      biometricDevices: [
        {
          name: 'K40PRO',
          protocol: 'ADMS_PUSH',
          serialNumber: 'GED7253100014',
          port: 8081,
          autoSync: false,
          userMappings: [
            { deviceUserId: '1', employeeCode: code(5), deviceUserName: 'Early' },
            { deviceUserId: '2', employeeCode: code(270), deviceUserName: 'Zuhura' },
          ],
          adms: {
            enrolments: [
              { userId: '1', name: 'Early', privilege: 0 },
              { userId: '2', name: 'Zuhura', privilege: 0 },
              { userId: '3', name: 'New starter', privilege: 0 },
            ],
          },
        },
      ],
    });
    deviceId = String(settings.biometricDevices[0]._id);

    server = app.listen(0);
    base = `http://127.0.0.1:${server.address().port}/api/v1`;
  });

  after(async () => {
    server?.close();
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  test('the old single request stopped at the 200th employee, past EMP00200', async () => {
    const old = await call('/employees?limit=200&sortBy=employeeCode&sortOrder=asc');
    assert.equal(old.body.data.length, 200);
    assert.equal(old.body.meta.total, TOTAL, 'more exist than it returned');
    assert.ok(old.body.data.at(-1).employeeCode > code(200), `last offered ${old.body.data.at(-1).employeeCode}`);
  });

  test('1, 2 and 6. paging the picker reaches every employee once, in code order', async () => {
    const seen = [];
    let page = 1;
    for (;;) {
      const response = await pickerPage(page);
      seen.push(...response.body.data.map((employee) => employee.employeeCode));
      if (page * 50 >= response.body.meta.total) break;
      page += 1;
    }
    assert.equal(seen.length, TOTAL);
    assert.equal(new Set(seen).size, TOTAL, 'no duplicates');
    assert.deepEqual(seen, [...seen].sort(), 'stable order');
    assert.equal(seen[0], code(1));
    assert.ok(seen.includes(code(270)) && seen.includes(code(281)), 'employees after EMP00215 are offered');
    assert.ok(!seen.includes('EMP09999'), 'a deleted employee is not offered');
  });

  test('3, 4 and 5. a late employee is found by code, by employee ID and by name', async () => {
    assert.deepEqual((await pickerPage(1, code(270))).body.data.map((employee) => employee.employeeCode), [code(270)]);
    assert.deepEqual((await pickerPage(1, '10270X')).body.data.map((employee) => employee.employeeCode), [code(270)]);
    assert.deepEqual((await pickerPage(1, 'Zuhura')).body.data.map((employee) => employee.employeeCode), [code(270)]);
    assert.deepEqual((await pickerPage(1, 'Mwinyi')).body.data.map((employee) => employee.employeeCode), [code(270)]);
    const partial = await pickerPage(1, 'EMP0028');
    assert.ok(partial.body.data.length > 0 && partial.body.data.every((employee) => employee.employeeCode.startsWith('EMP0028')));
  });

  test('7 and 8. the device users list names each saved mapping, on any page, and leaves unmapped rows unmapped', async () => {
    const response = await call(`/administration/biometric/devices/${deviceId}/users`);
    assert.equal(response.status, 200);
    const byId = Object.fromEntries(response.body.data.users.map((user) => [user.userId, user]));

    assert.equal(byId['1'].employeeCode, code(5));
    assert.equal(byId['1'].employee.firstName, 'First5');
    assert.equal(byId['2'].employeeCode, code(270), 'a mapping past the old cut-off is kept');
    assert.equal(byId['2'].employee.firstName, 'Zuhura', '...and named');
    assert.equal(byId['3'].employeeCode, null);
    assert.equal(byId['3'].employee, null);
    assert.equal(response.body.data.mappedCount, 2);
    assert.equal(response.body.data.unmappedCount, 1);
  });

  test('9 and 11. saving maps a late employee; the existing rules still refuse duplicates and unknown codes', async () => {
    const mappings = [
      { deviceUserId: '1', employeeCode: code(5), deviceUserName: 'Early' },
      { deviceUserId: '2', employeeCode: code(270), deviceUserName: 'Zuhura' },
      { deviceUserId: '3', employeeCode: code(281), deviceUserName: 'New starter' },
    ];
    const saved = await call(`/administration/biometric/devices/${deviceId}/map`, { method: 'POST', body: { mappings } });
    assert.equal(saved.status, 200);

    const device = (await models.AppSettings.findOne({ tenantId: null }).lean()).biometricDevices[0];
    assert.deepEqual(
      device.userMappings.map(({ deviceUserId, employeeCode }) => ({ deviceUserId, employeeCode })),
      mappings.map(({ deviceUserId, employeeCode }) => ({ deviceUserId, employeeCode })),
    );

    const twice = await call(`/administration/biometric/devices/${deviceId}/map`, {
      method: 'POST',
      body: { mappings: [...mappings, { deviceUserId: '3', employeeCode: code(290) }] },
    });
    assert.equal(twice.status, 400, 'a device user mapped twice');

    const unknown = await call(`/administration/biometric/devices/${deviceId}/map`, {
      method: 'POST',
      body: { mappings: [{ deviceUserId: '3', employeeCode: 'EMP09999' }] },
    });
    assert.equal(unknown.status, 422, 'a deleted employee cannot be mapped');
  });
});
