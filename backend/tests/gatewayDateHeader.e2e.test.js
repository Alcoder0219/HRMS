import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Both terminals through the real gateway into the real ADMS receiver:
 *
 *   MB360  ──▶ gateway with production settings (the 8081 role) ──▶ HRMS
 *   K40PRO ──▶ gateway with NO_DATE_HEADER_SERIALS=GED7253100014 (the 8082 role) ──▶ HRMS
 *
 * Proves the K40PRO's replies lose only their Date header while handshake,
 * heartbeat, upload, duplicate handling and day building all still work, and
 * the MB360 is unaffected. Runs against a THROWAWAY local MongoDB and refuses
 * any other; skipped if none is reachable. Nothing leaves this machine.
 */

const TEST_URI = process.env.MONGODB_TEST_URI_GATEWAY ?? 'mongodb://127.0.0.1:27017/hrms_gateway_date_test';
const OFFICE_ZONE = 'Africa/Dar_es_Salaam';
const TOKEN = 'test-gateway-token-0123456789abcdef';
const K40PRO = 'GED7253100014';
const MB360 = 'UEED245000038';

if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(TEST_URI)) {
  throw new Error(`Refusing to run destructive tests against a non-local database: ${TEST_URI}`);
}

Object.assign(process.env, {
  TZ: OFFICE_ZONE,
  NODE_ENV: 'test',
  MONGODB_URI: TEST_URI,
  JWT_ACCESS_SECRET: 'test-access-secret',
  JWT_REFRESH_SECRET: 'test-refresh-secret',
  LOG_TO_FILE: 'false',
  LOG_LEVEL: 'error',
  ADMS_ENABLED: 'true',
  ADMS_GATEWAY_TOKEN: TOKEN,
  ADMS_ALLOWED_IPS: '',
  BIOMETRIC_DEVICE_TIMEZONE: OFFICE_ZONE,
  ADMS_RATE_LIMIT_PER_MINUTE: '10000',
});

const here = path.dirname(fileURLToPath(import.meta.url));
const gatewayScript = path.join(here, '..', '..', 'biometric-gateway', 'gateway.js');

const mongoose = (await import('mongoose')).default;
let reachable = true;
try {
  await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 2000 });
} catch {
  reachable = false;
}
const { default: app } = reachable ? await import('../app.js') : { default: null };
const models = reachable ? await import('../models/index.js') : {};

const startGateway = (upstream, omit) =>
  new Promise((resolve, reject) => {
    const probe = http.createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => {
        const env = {
          ...process.env,
          LISTEN_HOST: '127.0.0.1',
          LISTEN_PORT: String(port),
          UPSTREAM_URL: upstream,
          ALLOW_INSECURE_UPSTREAM: 'true',
          GATEWAY_TOKEN: TOKEN,
          ALLOWED_DEVICE_IPS: '127.0.0.1',
          NO_DATE_HEADER_SERIALS: omit,
        };
        const child = spawn(process.execPath, [gatewayScript], { env, stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '';
        const timer = setTimeout(() => reject(new Error(`gateway did not start: ${output}`)), 10_000);
        const onData = (data) => {
          output += data;
          if (output.includes('Biometric gateway listening')) {
            clearTimeout(timer);
            resolve({ child, url: `http://127.0.0.1:${port}` });
          }
        };
        child.stdout.on('data', onData);
        child.stderr.on('data', onData);
      });
    });
  });

/** A raw request as a terminal makes it: no token, form content type. */
const call = (base, pathAndQuery, { method = 'GET', body } = {}) =>
  new Promise((resolve, reject) => {
    const req = http.request(`${base}${pathAndQuery}`, { method, agent: false, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end(body);
  });

describe('K40PRO through the test gateway, MB360 through the production one', { skip: !reachable && 'MongoDB is not reachable on localhost' }, () => {
  let server;
  let productionGateway;
  let testGateway;
  const employees = {};

  before(async () => {
    await mongoose.connection.dropDatabase();
    await Promise.all([models.BiometricEvent.syncIndexes(), models.Attendance.syncIndexes()]);
    const { ensureSystemRoles } = await import('../services/admin/role.service.js');
    const { loadRoleCache } = await import('../services/auth/roleCache.service.js');
    await ensureSystemRoles();
    await loadRoleCache();

    const shift = await models.Shift.create({ name: 'General', code: 'GEN', startTime: '08:30', endTime: '17:00', breakMinutes: 60 });
    for (const code of ['EMP001', 'EMP002']) {
      employees[code] = await models.Employee.create({ employeeCode: code, firstName: code, joiningDate: new Date('2025-01-01'), shiftId: shift._id, overtimeEligible: false });
    }
    await models.AppSettings.create({
      tenantId: null,
      biometricDevices: [
        { name: 'Main gate MB360', protocol: 'ADMS_PUSH', serialNumber: MB360, port: 8081, autoSync: false, acceptPunchesFrom: new Date('2026-10-01T00:00:00+03:00'), userMappings: [{ deviceUserId: '101', employeeCode: 'EMP001' }] },
        { name: 'K40PRO', protocol: 'ADMS_PUSH', serialNumber: K40PRO, port: 8081, autoSync: false, acceptPunchesFrom: new Date('2026-10-01T00:00:00+03:00'), userMappings: [{ deviceUserId: '1', employeeCode: 'EMP002' }] },
      ],
    });

    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    const hrms = `http://127.0.0.1:${server.address().port}`;
    productionGateway = await startGateway(hrms, '');
    testGateway = await startGateway(hrms, K40PRO);
  });

  after(async () => {
    for (const gateway of [productionGateway, testGateway]) gateway?.child.kill();
    await new Promise((resolve) => server?.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  const device = async (serial) => (await models.AppSettings.findOne({ tenantId: null }).lean()).biometricDevices.find((entry) => entry.serialNumber === serial);

  test('handshake: the K40PRO gets the HRMS options without a Date header; the MB360 gets them with one', async () => {
    const k40 = await call(testGateway.url, `/iclock/cdata?SN=${K40PRO}&options=all&pushver=2.4.1`);
    const mb360 = await call(productionGateway.url, `/iclock/cdata?SN=${MB360}&options=all&pushver=2.4.1`);

    assert.equal(k40.status, 200);
    assert.equal(k40.headers.date, undefined);
    assert.match(k40.text, new RegExp(`^GET OPTION FROM: ${K40PRO}\\n`));
    assert.ok(!/TimeZone|DateTime|SetTime/i.test(k40.text), 'HRMS sends no time setting of any kind');

    assert.equal(mb360.status, 200);
    assert.ok(mb360.headers.date);
    assert.equal(mb360.text, k40.text.replace(K40PRO, MB360), 'the same options for both terminals');
    assert.ok((await device(K40PRO)).adms.lastHandshakeAt, 'HRMS registered the K40PRO handshake');
  });

  test('upload: K40PRO punches are stored at the time on its clock, read as Tanzania time', async () => {
    const lines = ['1\t2026-11-10 08:30:00\t0\t1\t0', '1\t2026-11-10 17:05:00\t1\t1\t0'].join('\n');
    const response = await call(testGateway.url, `/iclock/cdata?SN=${K40PRO}&table=ATTLOG&Stamp=1`, { method: 'POST', body: lines });
    assert.equal(response.status, 200);
    assert.equal(response.text, 'OK: 2');
    assert.equal(response.headers.date, undefined);

    const events = await models.BiometricEvent.find({ deviceSerial: K40PRO }).sort({ punchTime: 1 }).lean();
    assert.deepEqual(events.map((event) => event.punchTime.toISOString()), ['2026-11-10T05:30:00.000Z', '2026-11-10T14:05:00.000Z']);
    assert.deepEqual(events.map((event) => event.deviceLocalTime), ['2026-11-10 08:30:00', '2026-11-10 17:05:00'], 'the terminal text is kept as sent');
    assert.ok(events.every((event) => event.status === 'IMPORTED'));

    const day = await models.Attendance.findOne({ employeeId: employees.EMP002._id }).lean();
    assert.equal(day.punches.length, 2);
    assert.equal(day.checkInAt.toISOString(), '2026-11-10T05:30:00.000Z');
    assert.equal(day.status, 'PRESENT');
  });

  test('a resent K40PRO batch is recognised as duplicate and adds nothing', async () => {
    const lines = ['1\t2026-11-10 08:30:00\t0\t1\t0', '1\t2026-11-10 17:05:00\t1\t1\t0'].join('\n');
    const response = await call(testGateway.url, `/iclock/cdata?SN=${K40PRO}&table=ATTLOG&Stamp=1`, { method: 'POST', body: lines });
    assert.equal(response.text, 'OK: 2');
    assert.equal(await models.BiometricEvent.countDocuments({ deviceSerial: K40PRO }), 2);
    assert.equal((await models.Attendance.findOne({ employeeId: employees.EMP002._id }).lean()).punches.length, 2);
  });

  test('the MB360 on the production gateway is unaffected: same upload, same storage, Date kept', async () => {
    const lines = ['101\t2026-11-10 08:45:00\t0\t1\t0', '101\t2026-11-10 17:10:00\t1\t1\t0'].join('\n');
    const response = await call(productionGateway.url, `/iclock/cdata?SN=${MB360}&table=ATTLOG&Stamp=1`, { method: 'POST', body: lines });
    assert.equal(response.text, 'OK: 2');
    assert.ok(response.headers.date);

    const events = await models.BiometricEvent.find({ deviceSerial: MB360 }).sort({ punchTime: 1 }).lean();
    assert.deepEqual(events.map((event) => event.punchTime.toISOString()), ['2026-11-10T05:45:00.000Z', '2026-11-10T14:10:00.000Z']);
    assert.equal((await models.Attendance.findOne({ employeeId: employees.EMP001._id }).lean()).status, 'PRESENT');
  });

  test('heartbeat and polling still mark the K40PRO online, and no command is ever sent to it', async () => {
    // "Last seen" is written at most every 20 s; start from a minute ago so the poll is due to write it.
    const before = new Date(Date.now() - 60_000);
    await models.AppSettings.updateOne({ tenantId: null, 'biometricDevices.serialNumber': K40PRO }, { $set: { 'biometricDevices.$.adms.lastSeenAt': before } });
    const poll = await call(testGateway.url, `/iclock/getrequest?SN=${K40PRO}`);
    assert.equal(poll.status, 200);
    assert.equal(poll.text, 'OK', 'nothing queued, so nothing to run');
    assert.equal(poll.headers.date, undefined);
    assert.ok((await device(K40PRO)).adms.lastSeenAt > before);
    assert.equal((await device(K40PRO)).adms.lastSeenIp, '127.0.0.1', 'the terminal address still reaches HRMS');

    const ping = await call(testGateway.url, `/iclock/ping?SN=${K40PRO}`);
    assert.equal(ping.status, 200);
    assert.equal(ping.headers.date, undefined);

    const mb360Poll = await call(productionGateway.url, `/iclock/getrequest?SN=${MB360}`);
    assert.equal(mb360Poll.text, 'OK');
    assert.ok(mb360Poll.headers.date);
  });
});
