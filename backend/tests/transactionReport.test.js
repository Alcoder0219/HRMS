import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';

/**
 * The Transaction Report API, over HTTP with real tokens: one unit's biometric
 * punches on one day, one row per punch, and the PDF export.
 *
 * Runs against a THROWAWAY local database and refuses anything else.
 */

const TEST_URI = process.env.MONGODB_TEST_URI_TRANSACTIONS ?? 'mongodb://127.0.0.1:27017/hrms_transaction_report_test';

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

const DAY = '2026-11-14';
const NEXT_DAY = '2026-11-15';
const EMPTY_DAY = '2026-11-20';

let server;
let base;
const tokens = {};
const units = {};
const people = {};
let device;

const request = async (role, path) => {
  const response = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${tokens[role]}` } });
  const type = response.headers.get('content-type') ?? '';
  return {
    status: response.status,
    headers: response.headers,
    body: type.includes('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer()),
  };
};
const report = (role, unit, date = DAY) => request(role, `/attendance/reports/transactions?unitId=${units[unit]._id}&date=${date}`);
const pdf = (role, unit, date = DAY) => request(role, `/attendance/reports/transactions/pdf?unitId=${units[unit]._id}&date=${date}`);

const pageCount = (buffer) => (buffer.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
const hasImage = (buffer) => /\/Subtype\s*\/Image/.test(buffer.toString('latin1'));

describe('transaction report API', { skip: !reachable && 'MongoDB is not reachable on localhost' }, () => {
  before(async () => {
    await mongoose.connection.dropDatabase();
    const { ensureSystemRoles } = await import('../services/admin/role.service.js');
    const { loadRoleCache } = await import('../services/auth/roleCache.service.js');
    await ensureSystemRoles();
    await loadRoleCache();

    units.EAW = await models.Unit.create({ name: 'East Africa Warehouse', code: 'EAW' });
    units.HQ = await models.Unit.create({ name: 'Head Office', code: 'HQ' });
    units.BULK = await models.Unit.create({ name: 'Bulk Unit', code: 'BULK' });

    const make = async (code, unit, first, last, employeeId) => {
      people[code] = await models.Employee.create({
        employeeCode: code,
        employeeId,
        firstName: first,
        lastName: last,
        joiningDate: new Date('2025-01-01'),
        unitId: units[unit]._id,
        status: 'ACTIVE',
      });
    };
    await make('E1', 'EAW', 'Asha', 'Mollel', '1001');
    await make('E2', 'EAW', 'Baraka', 'Juma', '1002');
    await make('H1', 'HQ', 'Chausiku', 'Lema', '2001');
    // Enough people on the bulk unit to run the PDF onto several pages.
    for (let index = 0; index < 40; index += 1) {
      await make(`B${index}`, 'BULK', 'Bulk', `Person ${index}`, `3${String(index).padStart(3, '0')}`);
    }

    const settings = await models.AppSettings.findOneAndUpdate(
      { tenantId: null },
      {
        $setOnInsert: { tenantId: null },
        $push: {
          biometricDevices: {
            name: 'Gate terminal',
            protocol: 'ADMS_PUSH',
            serialNumber: 'TXTEST0001',
            port: 8081,
            userMappings: [
              { deviceUserId: '11', employeeCode: 'E1' },
              { deviceUserId: '12', employeeCode: 'E2' },
              { deviceUserId: '21', employeeCode: 'H1' },
              ...Array.from({ length: 40 }, (_, index) => ({ deviceUserId: String(300 + index), employeeCode: `B${index}` })),
            ],
            adms: { enrolments: [{ userId: '99', name: 'New Starter' }] },
          },
        },
      },
      { upsert: true, new: true },
    );
    device = settings.biometricDevices.at(-1);

    let sequence = 0;
    const punch = (deviceUserId, local, { status = 'IMPORTED', employee = null, workCode = null } = {}) => {
      sequence += 1;
      return {
        tenantId: null,
        deviceId: device._id,
        deviceSerial: device.serialNumber,
        transport: 'ADMS',
        deviceUserId,
        employeeCode: employee?.employeeCode ?? null,
        employeeId: employee?._id ?? null,
        // East Africa wall clock (UTC+3), as the terminal stamps it.
        punchTime: new Date(`${local.replace(' ', 'T')}+03:00`),
        deviceLocalTime: local,
        workCode,
        status,
        dedupKey: `tx-${sequence}`,
      };
    };

    await models.BiometricEvent.insertMany([
      // EAW, out of order on purpose: the report sorts them by time.
      punch('12', `${DAY} 17:05:10`, { employee: people.E2 }),
      punch('11', `${DAY} 08:01:02`, { employee: people.E1 }),
      punch('11', `${DAY} 17:30:00`, { employee: people.E1, workCode: '5' }),
      // Still waiting for import: belongs to EAW through the device mapping.
      punch('12', `${DAY} 07:55:00`, { status: 'PENDING' }),
      // Another unit's punch on the same terminal and day.
      punch('21', `${DAY} 09:00:00`, { employee: people.H1 }),
      // Nobody mapped: never attributed, listed apart.
      punch('99', `${DAY} 10:10:10`, { status: 'UNMAPPED' }),
      // EAW on another day: never in this day's report.
      punch('11', `${NEXT_DAY} 08:00:00`, { employee: people.E1 }),
      // Just after midnight on the terminal clock, still the previous day in UTC.
      punch('12', `${NEXT_DAY} 00:30:00`, { employee: people.E2 }),
      ...Array.from({ length: 40 }, (_, index) => [
        punch(String(300 + index), `${DAY} 08:${String(index % 60).padStart(2, '0')}:00`, { employee: people[`B${index}`] }),
        punch(String(300 + index), `${DAY} 17:${String(index % 60).padStart(2, '0')}:00`, { employee: people[`B${index}`] }),
      ]).flat(),
    ]);

    const account = async (key, role, unitCodes = []) => {
      const user = await models.User.create({
        firstName: 'T',
        lastName: key,
        email: `${key}@transactions.test`,
        password: 'Passw0rd!Passw0rd',
        role,
        status: 'ACTIVE',
        isEmailVerified: true,
        unitIds: unitCodes.map((code) => units[code]._id),
      });
      tokens[key] = signAccessToken({ userId: user._id, tenantId: null, role });
    };
    await account('admin', 'SUPER_ADMIN');
    await account('hrEaw', 'HR', ['EAW']);

    server = app.listen(0);
    base = `http://127.0.0.1:${server.address().port}/api/v1`;
  });

  after(async () => {
    server?.close();
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  test('lists only the chosen unit and date, one row per punch, by time', async () => {
    const { status, body } = await report('admin', 'EAW');
    assert.equal(status, 200);
    const data = body.data;
    assert.equal(data.unit.code, 'EAW');
    assert.equal(data.dateLabel, '11/14/2026  --  11/14/2026');
    assert.deepEqual(
      data.rows.map((row) => [row.employeeId, row.date]),
      [
        ['1002', '11/14/2026 07:55'],
        ['1001', '11/14/2026 08:01'],
        ['1002', '11/14/2026 17:05'],
        ['1001', '11/14/2026 17:30'],
      ],
    );
    assert.equal(data.total, 4);
    assert.equal(data.rows[1].fullName, 'Asha Mollel');
    assert.equal(data.rows[0].recordType, 'Normal');
    assert.equal(data.rows[0].workCode, '0');
    assert.equal(data.rows[3].workCode, '5');
  });

  test('a punch just after midnight on the terminal belongs to that terminal date', async () => {
    const { body } = await report('admin', 'EAW', NEXT_DAY);
    assert.deepEqual(body.data.rows.map((row) => row.date), ['11/15/2026 00:30', '11/15/2026 08:00']);
  });

  test('another unit sees only its own people on the shared terminal', async () => {
    const { body } = await report('admin', 'HQ');
    assert.deepEqual(body.data.rows.map((row) => row.employeeId), ['2001']);
  });

  test('unmapped punches are never attributed, only listed apart', async () => {
    const { body } = await report('admin', 'EAW');
    assert.equal(body.data.rows.some((row) => row.date === '11/14/2026 10:10'), false);
    assert.equal(body.data.unmapped.length, 1);
    assert.equal(body.data.unmapped[0].deviceUserId, '99');
    assert.equal(body.data.unmapped[0].nameOnDevice, 'New Starter');
  });

  test('a unit-restricted user is refused another unit', async () => {
    assert.equal((await report('hrEaw', 'EAW')).status, 200);
    assert.equal((await report('hrEaw', 'HQ')).status, 403);
    assert.equal((await pdf('hrEaw', 'HQ')).status, 403);
  });

  test('unit and date are both required', async () => {
    assert.equal((await request('admin', `/attendance/reports/transactions?date=${DAY}`)).status, 422);
    assert.equal((await request('admin', `/attendance/reports/transactions?unitId=${units.EAW._id}`)).status, 422);
    assert.equal((await request('admin', `/attendance/reports/transactions?unitId=${units.EAW._id}&date=14-11-2026`)).status, 422);
  });

  test('the EAW PDF carries the logo and the expected filename', async () => {
    const { status, headers, body } = await pdf('admin', 'EAW');
    assert.equal(status, 200);
    assert.equal(headers.get('content-type'), 'application/pdf');
    assert.match(headers.get('content-disposition'), /filename="Transaction_Report_EAW_2026-11-14\.pdf"/);
    assert.equal(headers.get('x-total-count'), '4');
    assert.equal(body.subarray(0, 5).toString(), '%PDF-');
    assert.equal(hasImage(body), true);
  });

  test('another unit\'s PDF has no logo', async () => {
    const { status, body } = await pdf('admin', 'HQ');
    assert.equal(status, 200);
    assert.equal(hasImage(body), false);
  });

  test('a long report runs onto several pages', async () => {
    const { status, headers, body } = await pdf('admin', 'BULK');
    assert.equal(status, 200);
    assert.equal(headers.get('x-total-count'), '80');
    assert.ok(pageCount(body) >= 2, `expected several pages, got ${pageCount(body)}`);
  });

  test('pages read back as the whole report; the PDF is never paged', async () => {
    const path = `/attendance/reports/transactions?unitId=${units.BULK._id}&date=${DAY}`;
    const whole = (await request('admin', path)).body.data;
    assert.equal(whole.pagination, undefined);
    assert.equal(whole.rows.length, 80);

    for (const limit of [25, 50, 100]) {
      const rows = [];
      let pagination;
      for (let page = 1; !pagination || page <= pagination.totalPages; page += 1) {
        const data = (await request('admin', `${path}&page=${page}&limit=${limit}`)).body.data;
        pagination = data.pagination;
        assert.equal(data.total, 80);
        rows.push(...data.rows);
      }
      assert.equal(pagination.totalPages, Math.ceil(80 / limit));
      assert.deepEqual(rows, whole.rows, `pages at ${limit}`);
    }

    const exported = await request('admin', `/attendance/reports/transactions/pdf?unitId=${units.BULK._id}&date=${DAY}&page=2&limit=25`);
    assert.equal(exported.status, 200);
    assert.equal(exported.headers.get('x-total-count'), '80');
  });

  test('no records: an empty table, and no empty PDF', async () => {
    const { body } = await report('admin', 'EAW', EMPTY_DAY);
    assert.equal(body.data.total, 0);
    const exported = await pdf('admin', 'EAW', EMPTY_DAY);
    assert.equal(exported.status, 404);
    assert.equal(exported.body.message, 'No transaction records found for the selected unit and date.');
  });

  test('nothing is written to the punch store', async () => {
    const before = await models.BiometricEvent.find({}).sort({ dedupKey: 1 }).lean();
    await report('admin', 'EAW');
    await pdf('admin', 'EAW');
    const afterwards = await models.BiometricEvent.find({}).sort({ dedupKey: 1 }).lean();
    assert.deepEqual(afterwards, before);
  });
});
