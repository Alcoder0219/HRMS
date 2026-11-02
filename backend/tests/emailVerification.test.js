import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Who has to verify an email address before signing in.
 *
 * Accounts provisioned by an administrator -- from Admin > Users or by granting
 * portal access on the Employee Master -- sign in with the password they were
 * given. Self-registered accounts still have to follow the emailed link. The
 * login check itself is unchanged; these tests pin what each creation path
 * hands it.
 *
 * Runs against a THROWAWAY local database and refuses anything else.
 */

const TEST_URI = process.env.MONGODB_TEST_URI_AUTH ?? 'mongodb://127.0.0.1:27017/hrms_email_verification_test';

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
const { Employee, User } = reachable ? await import('../models/index.js') : {};
const { signAccessToken } = await import('../helpers/token.helper.js');
const { hashPassword } = await import('../helpers/password.helper.js');

const PASSWORD = 'Kilimanjaro!Teal#7429';

let server;
let base;
let adminToken;
let adminUser;

const post = async (path, body, token = null) => {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};

const login = (email, password = PASSWORD) => post('/auth/login', { email, password });

describe('email verification at sign-in', { skip: !reachable && 'MongoDB is not reachable on localhost' }, () => {
  before(async () => {
    await mongoose.connection.dropDatabase();
    await User.syncIndexes();

    const { ensureSystemRoles } = await import('../services/admin/role.service.js');
    const { loadRoleCache } = await import('../services/auth/roleCache.service.js');
    await ensureSystemRoles();
    await loadRoleCache();

    adminUser = await User.create({
      firstName: 'Super',
      lastName: 'Admin',
      email: 'super@verify.test',
      password: await hashPassword(PASSWORD),
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      isEmailVerified: true,
    });
    adminToken = signAccessToken({ userId: adminUser._id, tenantId: null, role: 'SUPER_ADMIN' });

    server = app.listen(0);
    base = `http://127.0.0.1:${server.address().port}/api/v1`;
  });

  after(async () => {
    server?.close();
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  for (const role of ['HR', 'PAYROLL', 'MANAGER', 'EMPLOYEE']) {
    test(`an ${role} account created in Admin > Users can sign in with its password`, async () => {
      const email = `${role.toLowerCase()}@verify.test`;
      const created = await post(
        '/administration/users',
        { email, password: PASSWORD, firstName: 'Test', lastName: role, role },
        adminToken,
      );
      assert.equal(created.status, 201, JSON.stringify(created.body));

      const stored = await User.findOne({ email }).lean();
      assert.equal(stored.isEmailVerified, true);
      assert.ok(stored.emailVerifiedAt instanceof Date);

      const { status, body } = await login(email);
      assert.equal(status, 200, JSON.stringify(body));
      assert.notEqual(body.code, 'AUTH_EMAIL_NOT_VERIFIED');
    });
  }

  test('an administrator can still create an account explicitly unverified, and it is still refused', async () => {
    const email = 'explicit-unverified@verify.test';
    const created = await post(
      '/administration/users',
      { email, password: PASSWORD, firstName: 'Test', lastName: 'Unverified', role: 'HR', isEmailVerified: false },
      adminToken,
    );
    assert.equal(created.status, 201);

    const { status, body } = await login(email);
    assert.equal(status, 401);
    assert.equal(body.code, 'AUTH_EMAIL_NOT_VERIFIED');
  });

  test('portal access granted from the Employee Master can sign in', async () => {
    const { applyPortalAccess } = await import('../services/employee/portalAccess.service.js');
    const employee = await Employee.create({
      employeeCode: 'EMP900',
      firstName: 'Portal',
      lastName: 'User',
      workEmail: 'portal@verify.test',
      joiningDate: new Date('2025-01-01'),
    });

    const req = { user: { id: String(adminUser._id), role: 'SUPER_ADMIN', tenantId: null, email: adminUser.email }, ip: '127.0.0.1', get: () => null };
    const result = await applyPortalAccess(employee, { portalAccess: true, portalEmail: 'portal@verify.test', portalPassword: PASSWORD }, req);
    assert.equal(result.changed, true);

    const stored = await User.findById(result.userId).lean();
    assert.equal(stored.isEmailVerified, true);

    const { status, body } = await login('portal@verify.test');
    assert.equal(status, 200, JSON.stringify(body));
  });

  test('a self-registered account is still refused until it follows the emailed link', async () => {
    const email = 'self@verify.test';
    const registered = await post('/auth/register', {
      firstName: 'Self',
      lastName: 'Registered',
      email,
      password: PASSWORD,
      confirmPassword: PASSWORD,
    });
    assert.equal(registered.status, 201, JSON.stringify(registered.body));

    const stored = await User.findOne({ email }).lean();
    assert.equal(stored.isEmailVerified, false);
    assert.equal(stored.status, 'PENDING');

    const refused = await login(email);
    assert.equal(refused.status, 401);
    assert.equal(refused.body.code, 'AUTH_EMAIL_NOT_VERIFIED');
    assert.equal(refused.body.message, 'Please verify your email address before signing in');

    // Mail is not configured in tests, so the token is echoed outside production.
    const token = registered.body.data?.verificationToken;
    assert.match(token ?? '', /^[0-9a-f]{64}$/, 'the verification token is available to the test');

    const verified = await post('/auth/verify-email', { token });
    assert.equal(verified.status, 200, JSON.stringify(verified.body));

    const accepted = await login(email);
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  });

  test('a wrong password is still refused as invalid credentials, verified or not', async () => {
    const { status, body } = await login('hr@verify.test', 'Wrong!Passw0rd#1');
    assert.equal(status, 401);
    assert.equal(body.code, 'AUTH_INVALID_CREDENTIALS');
  });
});
