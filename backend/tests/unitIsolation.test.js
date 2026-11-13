import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Unit data isolation, end to end over HTTP: real tokens, the real
 * `authenticate` (which resolves each account's units from the database), the
 * real routes and services.
 *
 *   Super Admin, Company Admin  -> every unit
 *   HOD                         -> its assigned unit(s) only
 *   HR, Payroll and below       -> their one unit only
 *   Employee                    -> their own records only
 *   No unit assigned            -> no unit data at all
 *
 * Runs against a THROWAWAY local database and refuses anything else.
 */

const TEST_URI = process.env.MONGODB_TEST_URI_UNITS ?? 'mongodb://127.0.0.1:27017/hrms_unit_isolation_test';

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

const { ObjectId } = mongoose.Types;

let server;
let base;
const units = {};
const employees = {};
const users = {};
const tokens = {};
const records = {};

const call = async (role, path, { method = 'GET', body } = {}) => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${tokens[role]}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const type = response.headers.get('content-type') ?? '';
  const payload = type.includes('json') ? await response.json() : Buffer.from(await response.arrayBuffer());
  return { status: response.status, body: payload };
};

const codesOf = (response) => (response.body.data ?? []).map((item) => item.employeeCode).sort();
const unitDenied = (response) => response.status === 403 && JSON.stringify(response.body).includes('RBAC_UNIT_DENIED');

describe('unit data isolation', { skip: !reachable && 'MongoDB is not reachable on localhost' }, () => {
  before(async () => {
    await mongoose.connection.dropDatabase();
    const { ensureSystemRoles } = await import('../services/admin/role.service.js');
    const { loadRoleCache } = await import('../services/auth/roleCache.service.js');
    await ensureSystemRoles();
    await loadRoleCache();

    for (const code of ['A', 'B', 'C']) {
      units[code] = await models.Unit.create({ name: `Unit ${code}`, code });
    }

    const person = (employeeCode, unit, extra = {}) =>
      models.Employee.create({ employeeCode, firstName: employeeCode, joiningDate: new Date('2025-01-01'), unitId: unit ? units[unit]._id : null, ...extra });

    employees.a1 = await person('EMPA1', 'A');
    employees.a2 = await person('EMPA2', 'A');
    employees.b1 = await person('EMPB1', 'B');
    employees.c1 = await person('EMPC1', 'C');

    const account = async (key, role, { unitIds = [], employee = null } = {}) => {
      users[key] = await models.User.create({
        firstName: 'Test',
        lastName: key,
        email: `${key}@units.test`,
        password: 'Passw0rd!Passw0rd',
        role,
        status: 'ACTIVE',
        isEmailVerified: true,
        unitIds: unitIds.map((code) => units[code]._id),
        employeeId: employee?._id ?? null,
      });
      tokens[key] = signAccessToken({ userId: users[key]._id, tenantId: null, role });
    };

    await account('super', 'SUPER_ADMIN');
    await account('companyAdmin', 'COMPANY_ADMIN');
    await account('hrA', 'HR', { unitIds: ['A'] });
    await account('hrB', 'HR', { unitIds: ['B'] });
    await account('hodA', 'HOD', { unitIds: ['A'] });
    await account('hodAB', 'HOD', { unitIds: ['A', 'B'] });
    await account('payrollA', 'PAYROLL', { unitIds: ['A'] });
    // The unit comes from the linked employee record when the account has none.
    await account('employeeA', 'EMPLOYEE', { employee: employees.a1 });
    await account('hrNoUnit', 'HR');

    const db = mongoose.connection.db;
    // Days are keyed at local midnight, exactly as the attendance engine writes them.
    const { startOfDay } = await import('../helpers/attendanceRules.helper.js');
    const day = (employee) => ({ _id: new ObjectId(), tenantId: null, employeeId: employee._id, date: startOfDay(new Date(2026, 9, 5, 12)), status: 'PRESENT', punches: [], anomalies: [] });
    records.attA1 = day(employees.a1);
    records.attA2 = day(employees.a2);
    records.attB1 = day(employees.b1);
    await db.collection('attendances').insertMany([records.attA1, records.attA2, records.attB1]);

    records.runId = new ObjectId();
    await db.collection('payrollruns').insertOne({
      _id: records.runId, tenantId: null, year: 2026, month: 10, period: 'October 2026', totalDaysInMonth: 31, status: 'DRAFT',
      employeeCount: 2, totalGross: 3000, totalNet: 2500, totalPaye: 400, exclusions: [],
    });
    const slip = (employee, net) => ({
      _id: new ObjectId(), tenantId: null, payrollRunId: records.runId, employeeId: employee._id, year: 2026, month: 10, period: 'October 2026',
      grossEarnings: net + 250, totalDeductions: 250, netPayable: net, employerContributionTotal: 0, status: 'DRAFT',
      earnings: [], deductions: [], employerContributions: [], employeeSnapshot: { employeeCode: employee.employeeCode, fullName: employee.employeeCode },
    });
    records.slipA1 = slip(employees.a1, 1000);
    records.slipB1 = slip(employees.b1, 1500);
    await db.collection('payslips').insertMany([records.slipA1, records.slipB1]);

    records.leaveB1 = {
      _id: new ObjectId(), tenantId: null, employeeId: employees.b1._id, leaveTypeId: new ObjectId(), requestNumber: 'LR-B1',
      status: 'PENDING', from: new Date('2026-11-20'), to: new Date('2026-11-20'), days: 1, year: 2026, breakdown: [],
    };
    await db.collection('leaverequests').insertOne(records.leaveB1);

    server = app.listen(0);
    base = `http://127.0.0.1:${server.address().port}/api/v1`;
  });

  after(async () => {
    server?.close();
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  test('1. Super Admin and Company Admin see every unit', async () => {
    for (const role of ['super', 'companyAdmin']) {
      assert.deepEqual(codesOf(await call(role, '/employees?limit=100')), ['EMPA1', 'EMPA2', 'EMPB1', 'EMPC1'], role);
      assert.equal((await call(role, `/employees/${employees.c1._id}`)).status, 200, role);
    }
    const unitsList = await call('super', '/organization/units');
    assert.equal(unitsList.body.data.length, 3);
  });

  test('2. HR in unit A reads unit A employees', async () => {
    assert.deepEqual(codesOf(await call('hrA', '/employees?limit=100')), ['EMPA1', 'EMPA2']);
    assert.equal((await call('hrA', `/employees/${employees.a1._id}`)).status, 200);
  });

  test('3. HR in unit A cannot read a unit B employee by id (403)', async () => {
    assert.ok(unitDenied(await call('hrA', `/employees/${employees.b1._id}`)));
    assert.ok(unitDenied(await call('hrA', `/employees/${employees.b1._id}/movements`)));
  });

  test('4. A HOD reaches only its assigned unit -- the whole unit, not just a department', async () => {
    assert.deepEqual(codesOf(await call('hodA', '/employees?limit=100')), ['EMPA1', 'EMPA2']);
    assert.ok(unitDenied(await call('hodA', `/employees/${employees.b1._id}`)));
  });

  test('5. An account with several units reaches exactly those units', async () => {
    assert.deepEqual(codesOf(await call('hodAB', '/employees?limit=100')), ['EMPA1', 'EMPA2', 'EMPB1']);
    assert.equal((await call('hodAB', `/employees/${employees.b1._id}`)).status, 200);
    assert.ok(unitDenied(await call('hodAB', `/employees/${employees.c1._id}`)));
  });

  test('6. An employee sees only their own profile, even within their unit', async () => {
    assert.equal((await call('employeeA', `/employees/${employees.a1._id}`)).status, 200);
    assert.equal((await call('employeeA', `/employees/${employees.a2._id}`)).status, 403, 'same unit, another person');
    assert.deepEqual(codesOf(await call('employeeA', '/employees?limit=100')), ['EMPA1']);
  });

  test("7. An employee cannot view another employee's attendance", async () => {
    const asked = await call('employeeA', `/attendance?employeeId=${employees.a2._id}`);
    assert.equal(asked.status, 200);
    assert.equal(asked.body.data.length, 0, 'the filter cannot replace the scope');
    assert.equal((await call('employeeA', `/attendance/${records.attA2._id}`)).status, 403);
    assert.equal((await call('employeeA', `/attendance/${records.attA1._id}`)).status, 200, 'own record');
    const mine = await call('employeeA', '/attendance');
    assert.deepEqual(mine.body.data.map((row) => String(row.employeeId?._id ?? row.employeeId)), [String(employees.a1._id)]);
  });

  test("8. An employee cannot open another employee's payslip", async () => {
    assert.equal((await call('employeeA', `/payroll/payslips/${records.slipB1._id}`)).status, 403);
    assert.equal((await call('employeeA', `/payroll/payslips/${records.slipA1._id}`)).status, 200);
  });

  test("9. Unit-restricted payroll cannot reach another unit's payroll by direct calls", async () => {
    assert.ok(unitDenied(await call('payrollA', `/payroll/payslips/${records.slipB1._id}`)));
    assert.equal((await call('payrollA', `/payroll/payslips/${records.slipA1._id}`)).status, 200, 'own unit still works');

    const list = await call('payrollA', '/payroll/payslips');
    assert.deepEqual(list.body.data.map((slip) => String(slip._id)), [String(records.slipA1._id)]);

    const run = await call('payrollA', `/payroll/runs/${records.runId}`);
    assert.equal(run.status, 200);
    assert.equal(run.body.data.totalNet, 1000, 'unit A payslips only');
    assert.equal(run.body.data.employeeCount, 1);
    assert.equal(run.body.data.totalPaye, null, 'organisation-wide statutory total withheld');

    assert.equal((await call('super', `/payroll/runs/${records.runId}`)).body.data.totalNet, 2500, 'stored run unchanged for all units');
    // Processing a pay run writes every unit; a unit-restricted caller is refused.
    assert.ok(unitDenied(await call('payrollA', '/payroll/runs/process', { method: 'POST', body: { year: 2026, month: 11 } })));
  });

  test('10. Naming another unit in parameters or payloads cannot widen access', async () => {
    const report = await call('hrA', `/reports/employees?unitId=${units.B._id}`);
    assert.equal(report.status, 200);
    assert.equal(report.body.data.rows.length, 0);

    const attendance = await call('hrA', `/attendance?employeeId=${employees.b1._id}`);
    assert.equal(attendance.body.data.length, 0);

    const createdElsewhere = await call('hrA', '/employees', { method: 'POST', body: { firstName: 'Cross', joiningDate: '2026-01-01', unitId: String(units.B._id) } });
    assert.ok(unitDenied(createdElsewhere), 'cannot create into another unit');

    const accountElsewhere = await call('hrA', '/administration/users', {
      method: 'POST',
      body: { email: 'x@units.test', password: 'Passw0rd!Passw0rd', firstName: 'X', lastName: 'Y', role: 'EMPLOYEE', unitIds: [String(units.B._id)] },
    });
    assert.ok(unitDenied(accountElsewhere), 'cannot give an account another unit');

    // With no unit named, the backend assigns the creator's own unit.
    const created = await call('hrA', '/employees', { method: 'POST', body: { firstName: 'Fresh', joiningDate: '2026-01-01' } });
    assert.equal(created.status, 201);
    assert.equal(String(created.body.data.unitId?._id ?? created.body.data.unitId), String(units.A._id));
    await models.Employee.deleteOne({ _id: created.body.data._id });
  });

  test('11. Cross-unit update, move and delete attempts return 403', async () => {
    assert.ok(unitDenied(await call('hrA', `/employees/${employees.b1._id}`, { method: 'PATCH', body: { middleName: 'X' } })));
    assert.ok(unitDenied(await call('hrA', `/employees/${employees.b1._id}`, { method: 'DELETE', body: { reason: 'test' } })));
    assert.ok(unitDenied(await call('hrA', `/employees/${employees.a1._id}`, { method: 'PATCH', body: { unitId: String(units.B._id) } })), 'cannot move out of own unit');
    assert.ok(unitDenied(await call('hrA', `/attendance/${records.attB1._id}`)));
    assert.equal(String((await models.Employee.findById(employees.b1._id).lean()).unitId), String(units.B._id), 'nothing changed');
  });

  test('12. Cross-unit approval attempts return 403', async () => {
    const response = await call('hrA', `/leaves/requests/${records.leaveB1._id}/decision`, { method: 'PATCH', body: { decision: 'APPROVED' } });
    assert.ok(unitDenied(response));
    assert.equal((await mongoose.connection.db.collection('leaverequests').findOne({ _id: records.leaveB1._id })).status, 'PENDING');
    assert.equal((await call('hrA', `/leaves/requests/${records.leaveB1._id}`)).status, 403, 'not even readable');
    const inbox = await call('hrA', '/leaves/requests');
    assert.equal(inbox.body.data.length, 0);
    assert.equal((await call('hrB', '/leaves/requests')).body.data.length, 1, 'unit B HR sees it');
  });

  test('13. Dashboard counts and reports stay unit-specific', async () => {
    assert.equal((await call('hrA', '/employees/summary')).body.data.total, 2);
    assert.equal((await call('super', '/employees/summary')).body.data.total, 4);
    assert.equal((await call('hrA', '/attendance/summary?date=2026-10-05')).body.data.total, 2);
    const report = await call('hrA', '/reports/employees');
    assert.deepEqual(report.body.data.rows.map((row) => row.employeeCode).sort(), ['EMPA1', 'EMPA2']);
    // Unit A's accounts: hrA, hodA, hodAB and payrollA by assignment, employeeA
    // through its linked employee. Not hrB, the admins or the unassigned HR.
    const users = await call('hrA', '/administration/users/summary');
    assert.equal(users.body.data.total, 5);
    const listed = await call('hrA', '/administration/users?limit=100');
    assert.deepEqual(listed.body.data.map((user) => user.lastName).sort(), ['employeeA', 'hodA', 'hodAB', 'hrA', 'payrollA']);
  });

  test('14. Exports contain no other unit', async () => {
    const response = await call('hrA', '/employees/export');
    assert.equal(response.status, 200);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(response.body);
    const text = [];
    book.worksheets[0].eachRow((row) => text.push(row.values.join('|')));
    const all = text.join('\n');
    assert.ok(all.includes('EMPA1') && all.includes('EMPA2'));
    assert.ok(!all.includes('EMPB1') && !all.includes('EMPC1'));
  });

  test('15. Search and pagination never expose another unit', async () => {
    const search = await call('hrA', '/employees?search=EMP&limit=1');
    assert.equal(search.body.meta.total, 2);
    const second = await call('hrA', '/employees?search=EMP&limit=1&page=2');
    assert.deepEqual(codesOf(second).filter((code) => !code.startsWith('EMPA')), []);
    assert.deepEqual(codesOf(await call('hrA', '/employees?search=EMPB1')), []);
  });

  test('16. An account with no unit assigned sees no unit data', async () => {
    assert.deepEqual(codesOf(await call('hrNoUnit', '/employees?limit=100')), []);
    assert.equal((await call('hrNoUnit', `/employees/${employees.a1._id}`)).status, 403);
    assert.equal((await call('hrNoUnit', '/employees/summary')).body.data.total, 0);
    const me = await call('hrNoUnit', '/auth/me');
    assert.deepEqual(me.body.data.unitAccess, { all: false, unitIds: [], units: [], source: null });
  });

  test('17. Documents and notifications respect unit and ownership', async () => {
    assert.ok(unitDenied(await call('hrA', `/employees/${employees.b1._id}/attachments`)));
    assert.ok(unitDenied(await call('hrA', `/employees/${employees.b1._id}/attachments/${new ObjectId()}/file`)));
    assert.equal((await call('employeeA', `/employees/${employees.a2._id}/attachments`)).status, 403, "a colleague's documents");
    assert.equal((await call('hrA', `/employees/${employees.a1._id}/attachments`)).status, 200);
    // Notifications are always the caller's own (RBAC pins them to SELF); the
    // module has no endpoints yet, so there is nothing further to reach.
    const { scopeFor } = await import('../helpers/permission.helper.js');
    assert.equal(scopeFor('SUPER_ADMIN', 'notification'), 'SELF');
  });

  test('the session reports each account\'s unit reach, and unit pickers list only those units', async () => {
    const me = await call('hrA', '/auth/me');
    assert.equal(me.body.data.unitAccess.all, false);
    assert.deepEqual(me.body.data.unitAccess.units.map((unit) => unit.code), ['A']);
    assert.equal((await call('super', '/auth/me')).body.data.unitAccess.all, true);
    assert.deepEqual((await call('hrA', '/organization/units')).body.data.map((unit) => unit.code), ['A']);
    assert.deepEqual((await call('hodAB', '/organization/units')).body.data.map((unit) => unit.code).sort(), ['A', 'B']);
  });

  test('audit trail and backups are unit-restricted too', async () => {
    assert.equal((await call('companyAdmin', '/administration/backup/preview')).status, 200);
    const auditor = await models.User.create({ firstName: 'Aud', lastName: 'A', email: 'aud@units.test', password: 'Passw0rd!Passw0rd', role: 'AUDITOR', status: 'ACTIVE', isEmailVerified: true, unitIds: [units.A._id] });
    tokens.auditorA = signAccessToken({ userId: auditor._id, tenantId: null, role: 'AUDITOR' });
    assert.ok(unitDenied(await call('auditorA', '/administration/backup')), 'a full backup is every unit');
    assert.ok(unitDenied(await call('auditorA', '/administration/biometric/devices')));
  });
});
