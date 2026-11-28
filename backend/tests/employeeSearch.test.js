import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';

/**
 * The employee list search that every employee picker (the asset Issue dialog
 * among them) runs: by name -- full, partial, in any order -- by Employee Code
 * and by Employee ID, over HTTP with a real token.
 *
 * Runs against a THROWAWAY local database and refuses anything else.
 */

const TEST_URI = process.env.MONGODB_TEST_URI_EMPLOYEE_SEARCH ?? 'mongodb://127.0.0.1:27017/hrms_employee_search_test';

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

let server;
let base;
let token;
let target;

/** The codes the picker would be offered for `term`, as it asks (20 at a time). */
const search = async (term) => {
  const response = await fetch(`${base}/employees?search=${encodeURIComponent(term)}&limit=20`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.json();
  return { status: response.status, total: body.meta?.total, codes: (body.data ?? []).map((row) => row.employeeCode) };
};

describe('employee search', { skip: !reachable && 'MongoDB is not reachable on localhost' }, () => {
  before(async () => {
    await mongoose.connection.dropDatabase();
    const { ensureSystemRoles } = await import('../services/admin/role.service.js');
    const { loadRoleCache } = await import('../services/auth/roleCache.service.js');
    await ensureSystemRoles();
    await loadRoleCache();

    const make = (employeeCode, employeeId, firstName, lastName, middleName = null) =>
      models.Employee.create({
        employeeCode, employeeId, firstName, middleName, lastName, joiningDate: new Date('2025-01-01'), status: 'ACTIVE',
      });

    // More people sharing a first name than one page of suggestions holds, so
    // the one asked for by full name sorts after the first page.
    for (let index = 0; index < 30; index += 1) {
      await make(`EMP${String(index + 1).padStart(5, '0')}`, `${70000 + index}A`, 'Swabri', `Aaron${index}`);
    }
    target = await make('EMP00099', '85592B', 'Swabri', 'Said', 'Swaleh');
    await make('EMP00100', '43143Z', 'Ashfak', 'Iddi', 'Majid');

    const user = await models.User.create({
      firstName: 'T', lastName: 'Admin', email: 'admin@search.test', password: 'Passw0rd!Passw0rd', role: 'SUPER_ADMIN', status: 'ACTIVE', isEmailVerified: true,
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

  test('a full name finds the employee, middle name included', async () => {
    assert.deepEqual((await search('Swabri Swaleh Said')).codes, ['EMP00099']);
    assert.deepEqual((await search('Swabri Said')).codes, ['EMP00099']);
    assert.deepEqual((await search('Ashfak Majid Iddi')).codes, ['EMP00100']);
  });

  test('a partial name, in any order and any case, finds the employee', async () => {
    assert.deepEqual((await search('swabri sa')).codes, ['EMP00099']);
    assert.deepEqual((await search('Said Swabri')).codes, ['EMP00099']);
    assert.deepEqual((await search('Ash')).codes, ['EMP00100']);
  });

  test('an employee beyond the first page of a name is found by narrowing', async () => {
    const broad = await search('Swabri');
    assert.equal(broad.total, 31);
    // Only one page of the 31 is offered; the full name is searched server-side,
    // so the employee is found wherever they would sort.
    assert.equal(broad.codes.length, 20);
    assert.deepEqual((await search('Swabri Swaleh')).codes, ['EMP00099']);
  });

  test('Employee Code and Employee ID still find the employee', async () => {
    assert.deepEqual((await search('EMP00099')).codes, ['EMP00099']);
    assert.deepEqual((await search('85592B')).codes, ['EMP00099']);
    assert.deepEqual((await search('85592')).codes, ['EMP00099']);
  });

  test('a name nobody has finds nobody', async () => {
    assert.deepEqual((await search('Swabri Nobody')).codes, []);
    assert.deepEqual((await search('Zzz')).codes, []);
  });

  test('search reads only: the employee record is unchanged', async () => {
    const before = await models.Employee.findById(target._id).lean();
    await search('Swabri Swaleh Said');
    assert.deepEqual(await models.Employee.findById(target._id).lean(), before);
  });
});
