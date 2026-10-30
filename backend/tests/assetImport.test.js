import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Employee Assets Excel import, end to end: the template download, the
 * validate-then-import flow over a real HTTP server, and the register the
 * existing create/list endpoints see afterwards.
 *
 * Runs against a THROWAWAY local database and refuses anything else.
 */

const TEST_URI = process.env.MONGODB_TEST_URI_ASSETS ?? 'mongodb://127.0.0.1:27017/hrms_asset_import_test';

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
const { Asset, Employee, User } = reachable ? await import('../models/index.js') : {};
const { IMPORT_COLUMNS } = await import('../services/employee/assetImport.service.js');
const { signAccessToken } = await import('../helpers/token.helper.js');

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

let server;
let base;
const tokens = {};

/** A workbook whose first sheet has the template headers and these rows. */
const workbook = async (rows) => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Assets');
  sheet.columns = IMPORT_COLUMNS.map(({ header, key }) => ({ header, key }));
  rows.forEach((row) => sheet.addRow(row));
  return Buffer.from(await book.xlsx.writeBuffer());
};

const upload = async (buffer, { dryRun = false, type = XLSX, name = 'assets.xlsx', role = 'admin' } = {}) => {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type }), name);
  form.append('dryRun', String(dryRun));

  const response = await fetch(`${base}/payroll/assets/import`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokens[role]}` },
    body: form,
  });
  return { status: response.status, body: await response.json() };
};

const errorsFor = (body, row) => body.data.errors.find((entry) => entry.row === row)?.errors ?? [];

describe('asset Excel import', { skip: !reachable && 'MongoDB is not reachable on localhost' }, () => {
  before(async () => {
    await mongoose.connection.dropDatabase();
    await Asset.syncIndexes();

    const { ensureSystemRoles } = await import('../services/admin/role.service.js');
    const { loadRoleCache } = await import('../services/auth/roleCache.service.js');
    await ensureSystemRoles();
    await loadRoleCache();

    for (const [key, role] of [['admin', 'SUPER_ADMIN'], ['employee', 'EMPLOYEE']]) {
      const user = await User.create({
        firstName: 'Test',
        lastName: key,
        email: `${key}@assets.test`,
        password: 'Passw0rd!Passw0rd',
        role,
        status: 'ACTIVE',
      });
      tokens[key] = signAccessToken({ userId: user._id, tenantId: null, role });
    }

    await Employee.create({ employeeCode: 'EMP001', employeeId: 'AMS-100', firstName: 'Asha', joiningDate: new Date('2025-01-01') });
    await Employee.create({ employeeCode: 'EMP002', firstName: 'Ben', joiningDate: new Date('2025-01-01') });

    // Already in the register: its code and serial must not be imported again.
    await Asset.create({ assetCode: 'AST00001', name: 'Existing laptop', category: 'LAPTOP', serialNumber: 'SN-EXIST' });

    server = app.listen(0);
    base = `http://127.0.0.1:${server.address().port}/api/v1`;
  });

  after(async () => {
    server?.close();
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  test('the template downloads with the import headers, dropdowns and a separate example', async () => {
    const response = await fetch(`${base}/payroll/assets/import/template`, {
      headers: { Authorization: `Bearer ${tokens.admin}` },
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /spreadsheetml/);

    const book = new ExcelJS.Workbook();
    await book.xlsx.load(Buffer.from(await response.arrayBuffer()));

    const [assets, instructions] = book.worksheets;
    assert.equal(assets.name, 'Assets');
    assert.deepEqual(assets.getRow(1).values.slice(1), IMPORT_COLUMNS.map((column) => column.header));
    assert.equal(assets.actualRowCount, 1, 'the imported sheet carries no example row');

    // In-cell dropdowns for the enum columns, read back per cell.
    const columnOf = (key) => IMPORT_COLUMNS.findIndex((column) => column.key === key) + 1;
    const category = assets.getCell(2, columnOf('category')).dataValidation;
    assert.equal(category?.type, 'list');
    assert.match(category.formulae[0], /LAPTOP,DESKTOP/);
    assert.match(assets.getCell(500, columnOf('condition')).dataValidation?.formulae?.[0] ?? '', /NEW,GOOD/);

    assert.equal(instructions.name, 'Instructions');
    assert.ok(instructions.getColumn(4).values.includes('SAMPLE-001'));
  });

  test('importing the downloaded template untouched is rejected as empty', async () => {
    const response = await fetch(`${base}/payroll/assets/import/template`, { headers: { Authorization: `Bearer ${tokens.admin}` } });
    const { status, body } = await upload(Buffer.from(await response.arrayBuffer()), { dryRun: true });
    assert.equal(status, 400);
    assert.match(body.message, /no data rows/);
  });

  test('a valid file: validate writes nothing, import creates every row and issues the assigned one', async () => {
    const file = await workbook([
      { assetCode: 'lap-100', name: 'ThinkPad T14', category: 'LAPTOP', serialNumber: 'SN-100', make: 'Lenovo', model: 'T14', purchaseDate: new Date('2026-01-10'), purchaseCost: 2000, recoveryValue: 1500, condition: 'NEW' },
      { name: 'Office chair', category: 'furniture', purchaseCost: '350' },
      { name: 'iPhone 15', category: 'MOBILE', serialNumber: 'SN-200', condition: 'GOOD', issueTo: 'ams-100', issuedOn: new Date('2026-02-01') },
    ]);

    const before = await Asset.countDocuments();
    const dry = await upload(file, { dryRun: true });
    assert.equal(dry.status, 200);
    assert.equal(dry.body.data.valid, 3);
    assert.equal(dry.body.data.failed, 0);
    assert.equal(await Asset.countDocuments(), before, 'a dry run writes nothing');

    const run = await upload(file);
    assert.equal(run.status, 200);
    assert.equal(run.body.data.imported, 3);
    assert.equal(run.body.data.issued, 1);
    assert.equal(run.body.data.failed, 0);

    const laptop = await Asset.findOne({ assetCode: 'LAP-100' }).lean();
    assert.equal(laptop.status, 'AVAILABLE');
    assert.equal(laptop.recoveryValue, 1500);

    const chair = await Asset.findOne({ name: 'Office chair' }).lean();
    assert.equal(chair.assetCode, 'AST00002', 'a blank code is generated by the existing rule');
    assert.equal(chair.category, 'FURNITURE');
    assert.equal(chair.recoveryValue, 350, 'recovery defaults to the purchase cost, as in the form');

    const phone = await Asset.findOne({ serialNumber: 'SN-200' }).lean();
    const asha = await Employee.findOne({ employeeCode: 'EMP001' }).lean();
    assert.equal(phone.status, 'ASSIGNED');
    assert.equal(String(phone.currentHolderId), String(asha._id));
    assert.equal(phone.assignments.length, 1);
    assert.equal(phone.assignments[0].assignedOn.toISOString().slice(0, 10), '2026-02-01');
  });

  test('re-importing the same file is refused row by row, not duplicated', async () => {
    const file = await workbook([{ assetCode: 'LAP-100', name: 'ThinkPad T14', serialNumber: 'SN-100' }]);
    const { body } = await upload(file);
    assert.equal(body.data.imported, 0);
    assert.deepEqual(errorsFor(body, 2), [
      'Asset Code LAP-100 already exists',
      'Serial Number SN-100 is already registered as LAP-100',
    ]);
  });

  test('invalid rows are reported by row number and skipped; valid rows still import', async () => {
    const file = await workbook([
      /* row 2 */ { name: 'Good monitor', category: 'OTHER', serialNumber: 'SN-300' },
      /* row 3 */ { category: 'LAPTOP' },
      /* row 4 */ { name: 'Bad category', category: 'SPACESHIP' },
      /* row 5 */ { name: 'Ghost holder', issueTo: 'EMP999' },
      /* row 6 */ { assetCode: 'AST00001', name: 'Clashing code' },
      /* row 7 */ { name: 'Same serial A', serialNumber: 'SN-DUP' },
      /* row 8 */ { name: 'Same serial B', serialNumber: 'SN-DUP' },
      /* row 9 */ { assetCode: 'SAMPLE-001', name: 'Dell Latitude 5440 (sample)' },
      /* row 10 */ { name: 'Bad numbers', purchaseCost: 'lots', purchaseDate: 'not a date', condition: 'SHINY' },
      /* row 11 */ { name: 'Date without holder', issuedOn: new Date('2026-03-01') },
      /* row 12 */ { name: 'Known serial', serialNumber: 'SN-EXIST' },
    ]);

    const { status, body } = await upload(file);
    assert.equal(status, 200);
    assert.equal(body.data.totalRows, 11);
    assert.equal(body.data.imported, 2, 'rows 2 and 7 import');
    assert.equal(body.data.failed, 9);

    assert.deepEqual(errorsFor(body, 3), ['Name is required']);
    assert.match(errorsFor(body, 4)[0], /^Category must be one of: LAPTOP/);
    assert.deepEqual(errorsFor(body, 5), ['No employee found with code or ID EMP999']);
    assert.deepEqual(errorsFor(body, 6), ['Asset Code AST00001 already exists']);
    assert.deepEqual(errorsFor(body, 7), []);
    assert.deepEqual(errorsFor(body, 8), ['Serial Number SN-DUP is duplicated within this file']);
    assert.deepEqual(errorsFor(body, 9), ['This is the template example row; remove it']);
    assert.deepEqual(errorsFor(body, 10).sort(), [
      'Condition must be one of: NEW, GOOD, FAIR, DAMAGED, UNUSABLE',
      'Purchase Cost must be a number',
      'Purchase Date is not a valid date',
    ]);
    assert.deepEqual(errorsFor(body, 11), ['Issued On is set but Issue To is blank']);
    assert.deepEqual(errorsFor(body, 12), ['Serial Number SN-EXIST is already registered as AST00001']);

    assert.equal(await Asset.countDocuments({ name: { $in: ['Bad category', 'Ghost holder', 'Clashing code'] } }), 0);
  });

  test('a file of the wrong type, or one that is not a real workbook, is refused with a reason', async () => {
    const text = await upload(Buffer.from('name\nchair'), { type: 'text/csv', name: 'assets.csv', dryRun: true });
    assert.equal(text.status, 400);
    assert.match(text.body.message, /Unsupported file type/);

    const fake = await upload(Buffer.from('definitely not a zip'), { dryRun: true });
    assert.equal(fake.status, 400);
    assert.match(fake.body.message, /could not be read/);

    const noHeaders = new ExcelJS.Workbook();
    noHeaders.addWorksheet('Sheet1').addRow(['Foo', 'Bar']).commit();
    const wrong = await upload(Buffer.from(await noHeaders.xlsx.writeBuffer()), { dryRun: true });
    assert.equal(wrong.status, 400);
    assert.match(wrong.body.message, /No recognised column headers/);
  });

  test('the import respects the existing create permission', async () => {
    const file = await workbook([{ name: 'Sneaky laptop' }]);
    const { status } = await upload(file, { role: 'employee' });
    assert.equal(status, 403);

    const template = await fetch(`${base}/payroll/assets/import/template`, { headers: { Authorization: `Bearer ${tokens.employee}` } });
    assert.equal(template.status, 403);
    assert.equal(await Asset.countDocuments({ name: 'Sneaky laptop' }), 0);
  });

  test('the existing single create and list endpoints are unchanged', async () => {
    const created = await fetch(`${base}/payroll/assets`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokens.admin}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Hand-added desk', category: 'FURNITURE' }),
    });
    assert.equal(created.status, 201);

    const list = await fetch(`${base}/payroll/assets?limit=200`, { headers: { Authorization: `Bearer ${tokens.admin}` } });
    const body = await list.json();
    assert.equal(list.status, 200);
    assert.equal(body.meta.total, await Asset.countDocuments({ isActive: true }));

    const statuses = body.data.reduce((counts, asset) => ({ ...counts, [asset.status]: (counts[asset.status] ?? 0) + 1 }), {});
    assert.equal(statuses.ASSIGNED, 1, 'only the asset issued by the import is out');
    assert.equal(statuses.AVAILABLE, body.meta.total - 1);
  });
});
