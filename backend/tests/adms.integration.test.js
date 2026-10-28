import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';

/**
 * The ADMS receiver end to end: a real HTTP server, a real MongoDB, and the
 * requests a ZKTeco terminal makes, in the order it makes them.
 *
 * Runs against a THROWAWAY local database and refuses anything else -- it
 * drops the database before and after. Set MONGODB_TEST_URI to point it
 * elsewhere on localhost; the suite is skipped if MongoDB is not reachable.
 *
 * The office zone is pinned for the process, as TZ would be on the server, so
 * shift times and the device clock are read in the same zone the way they are
 * in a correctly configured deployment.
 */

const TEST_URI = process.env.MONGODB_TEST_URI ?? 'mongodb://127.0.0.1:27017/hrms_adms_integration_test';
const OFFICE_ZONE = 'Africa/Dar_es_Salaam';
const TOKEN = 'test-gateway-token-0123456789';
const SERIAL = 'TESTMB360001';

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

const mongoose = (await import('mongoose')).default;

let reachable = true;
try {
  await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 2000 });
} catch {
  reachable = false;
}

const { default: app } = reachable ? await import('../app.js') : { default: null };
const models = reachable ? await import('../models/index.js') : {};
const { Attendance, AppSettings, BiometricEvent, BiometricSyncLog, Employee, Shift } = models;
const { evaluateDay } = await import('../helpers/attendanceRules.helper.js');
const deviceService = reachable ? (await import('../services/admin/biometricDevice.service.js')).default : null;

let server;
let base;
let deviceId;
const employees = {};

/* ----------------------------------------------------------------- helpers */

const call = async (path, { method = 'GET', body, token = TOKEN, headers = {} } = {}) => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      // What a terminal sends: it labels tab-separated text as a form.
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(token ? { 'X-ADMS-Gateway-Token': token } : {}),
      ...headers,
    },
    body,
  });
  return { status: response.status, text: await response.text() };
};

const attlog = (lines, stamp = '1') =>
  call(`/iclock/cdata?SN=${SERIAL}&table=ATTLOG&Stamp=${stamp}`, { method: 'POST', body: lines.join('\n') });

const dayOf = (code, isoDate) =>
  Attendance.findOne({ employeeId: employees[code]._id, date: new Date(`${isoDate}T00:00:00+03:00`) }).lean();

const loadDevice = async () => {
  const settings = await AppSettings.findOne({ tenantId: null }).lean();
  return settings.biometricDevices.find((device) => String(device._id) === String(deviceId));
};

/** An administrator, as the device service sees one. */
const adminReq = { user: { id: null, tenantId: null, role: 'SUPER_ADMIN', email: 'admin@test' }, ip: '127.0.0.1', get: () => null };

/* ------------------------------------------------------------------- setup */

describe('ADMS receiver', { skip: !reachable && 'MongoDB is not reachable on localhost' }, () => {
  before(async () => {
    await mongoose.connection.dropDatabase();
    await Promise.all([BiometricEvent.syncIndexes(), Attendance.syncIndexes()]);

    // Permission checks read the role cache, exactly as they do after boot.
    const { ensureSystemRoles } = await import('../services/admin/role.service.js');
    const { loadRoleCache } = await import('../services/auth/roleCache.service.js');
    await ensureSystemRoles();
    await loadRoleCache();

    const dayShift = await Shift.create({ name: 'General', code: 'GEN', startTime: '09:00', endTime: '18:00', breakMinutes: 60 });
    const nightShift = await Shift.create({ name: 'Night', code: 'NGT', startTime: '22:00', endTime: '06:00', breakMinutes: 30, isNightShift: true });

    for (const [code, shift] of [['EMP001', dayShift], ['EMP002', nightShift], ['EMP003', dayShift]]) {
      employees[code] = await Employee.create({
        employeeCode: code,
        firstName: `Test ${code}`,
        joiningDate: new Date('2025-01-01'),
        shiftId: shift._id,
        overtimeEligible: true,
      });
    }

    const settings = await AppSettings.create({
      tenantId: null,
      biometricDevices: [
        {
          name: 'Main gate MB360',
          protocol: 'ADMS_PUSH',
          serialNumber: SERIAL,
          port: 8081,
          autoSync: false,
          acceptPunchesFrom: new Date('2026-10-01T00:00:00+03:00'),
          userMappings: [
            { deviceUserId: '101', employeeCode: 'EMP001' },
            { deviceUserId: '102', employeeCode: 'EMP002' },
          ],
        },
      ],
    });
    deviceId = settings.biometricDevices[0]._id;

    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => server?.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  /* ---------------------------------------------------------------- guards */

  test('rejects a request without the gateway token', async () => {
    const response = await call(`/iclock/cdata?SN=${SERIAL}&options=all`, { token: null });
    assert.equal(response.status, 401);
  });

  test('rejects a malformed serial', async () => {
    const response = await call('/iclock/cdata?SN=../etc&options=all');
    assert.equal(response.status, 400);
  });

  test('refuses an unregistered serial and lists it for the administrator', async () => {
    const response = await call('/iclock/cdata?SN=UNKNOWN0001&options=all&pushver=2.4.1');
    assert.equal(response.status, 403);

    const status = await deviceService.integrationStatus(adminReq);
    assert.ok(status.unregisteredDevices.some((entry) => entry.serialNumber === 'UNKNOWN0001'));
    assert.equal(status.receiver.securityMode, 'GATEWAY_TOKEN');
  });

  /* ------------------------------------------------------------- handshake */

  test('answers the handshake with options and records the session', async () => {
    const response = await call(`/iclock/cdata?SN=${SERIAL}&options=all&pushver=2.4.1&language=69`);

    assert.equal(response.status, 200);
    assert.match(response.text, new RegExp(`^GET OPTION FROM: ${SERIAL}\n`));
    assert.match(response.text, /\nATTLOGStamp=None\n/);

    const device = await loadDevice();
    assert.equal(device.adms.pushVersion, '2.4.1');
    assert.ok(device.adms.lastSeenAt);
  });

  /* ---------------------------------------------------------------- ATTLOG */

  test('imports valid punches, keeps unmapped ones, rejects malformed lines', async () => {
    const response = await attlog(
      [
        '101\t2026-10-20 08:55:00\t0\t1\t0\t0\t0',
        '101\t2026-10-20 18:20:00\t1\t1\t0\t0\t0',
        '999\t2026-10-20 09:10:00\t0\t15\t0\t0\t0', // nobody mapped yet
        'this is not a punch',
      ],
      '100',
    );

    assert.equal(response.status, 200);
    assert.equal(response.text, 'OK: 4');

    const day = await dayOf('EMP001', '2026-10-20');
    assert.equal(day.punches.length, 2);
    assert.equal(day.status, 'PRESENT');
    assert.equal(day.checkInAt.toISOString(), '2026-10-20T05:55:00.000Z'); // 08:55 EAT
    assert.equal(day.punches[0].source, 'BIOMETRIC');
    assert.equal(day.punches[0].deviceId, SERIAL);

    const events = await BiometricEvent.find({ deviceId }).lean();
    assert.equal(events.filter((event) => event.status === 'IMPORTED').length, 2);
    assert.equal(events.filter((event) => event.status === 'UNMAPPED').length, 1);
    assert.equal(events.find((event) => event.deviceUserId === '101').deviceLocalTime, '2026-10-20 08:55:00');

    const log = await BiometricSyncLog.findOne({ deviceId, kind: 'PUSH' }).sort({ createdAt: -1 }).lean();
    assert.equal(log.imported, 2);
    assert.equal(log.unmapped, 1);
    assert.equal(log.rejected, 1);
    assert.match(log.errorMessages[0], /^Line 4: /);
    assert.ok(!JSON.stringify(log).includes('this is not a punch'), 'raw lines are never logged');

    const device = await loadDevice();
    assert.equal(device.adms.attlogStamp, '100');
  });

  test('uses the engine unchanged: the stored day equals evaluateDay on the same punches', async () => {
    const day = await dayOf('EMP001', '2026-10-20');
    const shift = await Shift.findOne({ code: 'GEN' }).lean();

    const expected = evaluateDay({ date: day.date, punches: day.punches, shift, policy: {} });

    for (const field of ['status', 'workedMinutes', 'lateMinutes', 'earlyGoingMinutes', 'overtimeMinutes', 'expectedMinutes']) {
      assert.equal(day[field], expected[field], field);
    }
  });

  test('a retried upload imports nothing twice', async () => {
    const before = await BiometricEvent.countDocuments({ deviceId });

    const response = await attlog(
      ['101\t2026-10-20 08:55:00\t0\t1\t0', '101\t2026-10-20 18:20:00\t1\t1\t0', '999\t2026-10-20 09:10:00\t0\t15\t0'],
      '100',
    );
    assert.equal(response.text, 'OK: 3');

    assert.equal(await BiometricEvent.countDocuments({ deviceId }), before);
    assert.equal((await dayOf('EMP001', '2026-10-20')).punches.length, 2);

    const log = await BiometricSyncLog.findOne({ deviceId, kind: 'PUSH' }).sort({ createdAt: -1 }).lean();
    assert.equal(log.duplicate, 3);
    assert.equal(log.imported, 0);
  });

  test('concurrent deliveries of the same punch store it once', async () => {
    const line = ['101\t2026-10-21 08:59:00\t0\t1\t0'];
    await Promise.all([attlog(line), attlog(line), attlog(line)]);

    assert.equal(await BiometricEvent.countDocuments({ deviceId, punchTime: new Date('2026-10-21T05:59:00Z') }), 1);
    assert.equal((await dayOf('EMP001', '2026-10-21')).punches.length, 1);
  });

  test('files a night shift that crosses midnight under one day', async () => {
    await attlog(['102\t2026-10-22 21:58:00\t0\t1\t0', '102\t2026-10-23 06:04:00\t1\t1\t0']);

    const shiftDay = await dayOf('EMP002', '2026-10-22');
    assert.equal(shiftDay.punches.length, 2);
    assert.equal(shiftDay.isNightShift, true);
    assert.equal(shiftDay.workedMinutes, 486);
    assert.equal(shiftDay.status, 'PRESENT');
    assert.equal(await dayOf('EMP002', '2026-10-23'), null, 'no half-record on the next calendar day');
  });

  test('a missed exit is a missing punch, not a full day', async () => {
    await attlog(['101\t2026-10-24 09:20:00\t0\t1\t0']);
    const day = await dayOf('EMP001', '2026-10-24');
    assert.equal(day.status, 'MISSING_PUNCH');
    assert.ok(day.anomalies.includes('NO_CHECKOUT'));
  });

  /* ------------------------------------------------------------ protection */

  test('holds a punch for a manually corrected day instead of overwriting it', async () => {
    const date = new Date('2026-10-25T00:00:00+03:00');
    await Attendance.create({
      employeeId: employees.EMP001._id,
      date,
      source: 'MANUAL',
      status: 'ON_DUTY',
      overrideStatus: 'ON_DUTY',
      workedMinutes: 480,
      punches: [],
    });

    await attlog(['101\t2026-10-25 10:00:00\t0\t1\t0']);

    const day = await dayOf('EMP001', '2026-10-25');
    assert.equal(day.status, 'ON_DUTY');
    assert.equal(day.punches.length, 0);

    const event = await BiometricEvent.findOne({ deviceId, punchTime: new Date('2026-10-25T07:00:00Z') }).lean();
    assert.equal(event.status, 'HELD');
    assert.match(event.statusReason, /corrected manually/);
  });

  test('holds a punch for a day locked by payroll', async () => {
    await Attendance.create({
      employeeId: employees.EMP001._id,
      date: new Date('2026-10-19T00:00:00+03:00'),
      status: 'ABSENT',
      isLocked: true,
      punches: [],
    });

    await attlog(['101\t2026-10-19 09:00:00\t0\t1\t0']);

    const event = await BiometricEvent.findOne({ deviceId, punchTime: new Date('2026-10-19T06:00:00Z') }).lean();
    assert.equal(event.status, 'HELD');
    assert.equal((await dayOf('EMP001', '2026-10-19')).status, 'ABSENT');
  });

  test('stores but does not apply punches older than accept-from', async () => {
    await attlog(['101\t2026-09-15 09:00:00\t0\t1\t0']);

    const event = await BiometricEvent.findOne({ deviceId, punchTime: new Date('2026-09-15T06:00:00Z') }).lean();
    assert.equal(event.status, 'IGNORED');
    assert.equal(await dayOf('EMP001', '2026-09-15'), null);
  });

  /* ---------------------------------------------------- mapping, reprocess */

  test('imports an unmapped user’s stored punches once mapped and reprocessed', async () => {
    const status = await deviceService.deviceStatus(String(deviceId), adminReq);
    assert.deepEqual(status.unmappedUsers.map((entry) => entry.deviceUserId), ['999']);

    await deviceService.mapUsers(
      String(deviceId),
      [
        { deviceUserId: '101', employeeCode: 'EMP001' },
        { deviceUserId: '102', employeeCode: 'EMP002' },
        { deviceUserId: '999', employeeCode: 'EMP003' },
      ],
      adminReq,
    );

    const result = await deviceService.reprocessDevice(String(deviceId), {}, adminReq);
    assert.equal(result.imported, 1);

    const day = await dayOf('EMP003', '2026-10-20');
    assert.equal(day.punches.length, 1);
    assert.equal((await BiometricEvent.findOne({ deviceId, deviceUserId: '999' }).lean()).status, 'IMPORTED');

    // Held and ignored events stay where they were unless asked for.
    assert.equal(await BiometricEvent.countDocuments({ deviceId, status: 'HELD' }), 2);
    assert.equal(await BiometricEvent.countDocuments({ deviceId, status: 'IGNORED' }), 1);
  });

  test('applies a held punch only when an approver explicitly includes held events', async () => {
    const forbidden = { ...adminReq, user: { ...adminReq.user, role: 'NO_SUCH_ROLE' } };
    await assert.rejects(() => deviceService.reprocessDevice(String(deviceId), { includeHeld: true }, forbidden), /approval/);

    const result = await deviceService.reprocessDevice(String(deviceId), { includeHeld: true }, adminReq);
    assert.equal(result.imported, 1, 'the manual day accepts it');
    assert.equal(result.held, 1, 'the locked day still refuses it');
    assert.equal((await dayOf('EMP001', '2026-10-25')).punches.length, 1);
  });

  test('reports device counters for the status panel', async () => {
    const { stats, device } = await deviceService.deviceStatus(String(deviceId), adminReq);

    assert.equal(stats.held, 1);
    assert.equal(stats.ignored, 1);
    assert.equal(stats.unmapped, 0);
    assert.ok(stats.imported >= 7);
    assert.ok(stats.duplicateLast90Days >= 3);
    assert.ok(stats.rejectedLast90Days >= 1);
    assert.ok(stats.lastSuccessfulSyncAt);
    assert.equal(device.adms.online, true);
  });

  /* ----------------------------------------------- roster, commands, info */

  test('records enrolments from OPERLOG without the passcode or card', async () => {
    const response = await call(`/iclock/cdata?SN=${SERIAL}&table=OPERLOG&Stamp=5`, {
      method: 'POST',
      body: 'USER PIN=104\tName=New Starter\tPri=0\tPasswd=9876\tCard=[11223344]\tGrp=1',
    });
    assert.equal(response.text, 'OK');

    const device = await loadDevice();
    assert.deepEqual(
      device.adms.enrolments.map(({ userId, name }) => ({ userId, name })),
      [{ userId: '104', name: 'New Starter' }],
    );
    assert.ok(!JSON.stringify(device).includes('9876'));
    assert.ok(!JSON.stringify(device).includes('11223344'));

    const users = await deviceService.deviceUsers(String(deviceId), adminReq);
    assert.ok(users.users.some((user) => user.userId === '104'));
    // Every existing mapping is listed, so saving the dialog cannot drop one.
    ['101', '102', '999'].forEach((id) => assert.ok(users.users.some((user) => user.userId === id), id));
    assert.equal(users.orphanedMappings.length, 0);
  });

  test('delivers a queued upload request on the next poll and records the result', async () => {
    await deviceService.queueCommand(
      String(deviceId),
      { type: 'QUERY_ATTLOG', from: '2026-10-01T00:00:00+03:00', to: '2026-10-02T23:59:59+03:00' },
      adminReq,
    );

    const poll = await call(`/iclock/getrequest?SN=${SERIAL}&INFO=Ver 8.0.4.2-20230101,5,0,12,192.168.1.50`);
    assert.equal(poll.text, 'C:1:DATA QUERY ATTLOG StartTime=2026-10-01 00:00:00\tEndTime=2026-10-02 23:59:59');

    assert.equal((await call(`/iclock/getrequest?SN=${SERIAL}`)).text, 'OK', 'sent only once');

    const reply = await call(`/iclock/devicecmd?SN=${SERIAL}`, { method: 'POST', body: 'ID=1&Return=0&CMD=DATA' });
    assert.equal(reply.text, 'OK');

    const device = await loadDevice();
    assert.equal(device.adms.commands[0].status, 'DONE');
    assert.equal(device.adms.firmware, 'Ver 8.0.4.2-20230101');
  });

  test('refuses commands outside the whitelist', async () => {
    await assert.rejects(() => deviceService.queueCommand(String(deviceId), { type: 'Shell' }, adminReq), /Unsupported/);
  });

  test('acknowledges and discards photo and template uploads', async () => {
    const response = await call(`/iclock/cdata?SN=${SERIAL}&table=ATTPHOTO`, { method: 'POST', body: 'PIN=101\tSN=x\tsize=10\tCMD=uploadphoto' });
    assert.equal(response.status, 200);
    assert.equal(response.text, 'OK');
  });

  /* --------------------------------------- the existing transports, too */

  test('a pull device goes through the same store: re-syncing a back-dated window duplicates nothing', async () => {
    const http = await import('node:http');
    const { syncAttendanceLogs } = await import('../services/biometric/biometricSync.service.js');

    // Stands in for a ZKTeco terminal's web API -- the ZK_WEB transport.
    const terminal = http.createServer((req, res) => {
      if (req.url.startsWith('/iclock/getdata?type=attlog')) {
        res.end('USER_ID\tTIMESTAMP\tSTATUS\tVERIFY\n101\t2026-10-26 08:50:00\t0\t1\n101\t2026-10-26 17:40:00\t1\t1\n');
      } else {
        res.statusCode = 404;
        res.end();
      }
    });
    await new Promise((resolve) => terminal.listen(0, '127.0.0.1', resolve));

    const settings = await AppSettings.findOne({ tenantId: null });
    settings.biometricDevices.push({
      name: 'Back door (web API)',
      protocol: 'ZK_WEB',
      ipAddress: '127.0.0.1',
      port: terminal.address().port,
      serialNumber: 'PULLDEV0001',
      autoSync: false,
      lastSyncAt: new Date('2026-10-25T00:00:00+03:00'),
      userMappings: [{ deviceUserId: '101', employeeCode: 'EMP001' }],
    });
    await settings.save();
    const pullDevice = settings.biometricDevices.at(-1);

    try {
      const first = await syncAttendanceLogs(pullDevice.toObject(), null);
      assert.equal(first.success, true);
      assert.equal(first.punchesSynced, 2);

      // What an administrator used to do to pick up missed punches -- and what
      // used to push every punch onto the day a second time.
      const again = await syncAttendanceLogs({ ...pullDevice.toObject(), lastSyncAt: new Date('2026-10-25T00:00:00+03:00') }, null);
      assert.equal(again.punchesSynced, 0);
      assert.equal(again.duplicates, 2);

      const day = await dayOf('EMP001', '2026-10-26');
      assert.equal(day.punches.length, 2);
      assert.equal(day.status, 'PRESENT');
    } finally {
      await new Promise((resolve) => terminal.close(resolve));
    }
  });

  test('the direct /attendance/biometric ingest skips punches already on the day', async () => {
    const { ingestBiometric } = await import('../services/attendance/attendanceIngest.service.js');
    const req = { user: { id: null, tenantId: null, role: 'SYSTEM' }, ip: null, get: () => null };
    const punches = [{ employeeCode: 'EMP003', timestamp: '2026-10-27T06:00:00Z', direction: 'IN' }];

    const first = await ingestBiometric({ deviceId: 'TURNSTILE-1', punches, auditEntityId: deviceId }, req);
    const second = await ingestBiometric({ deviceId: 'TURNSTILE-1', punches, auditEntityId: deviceId }, req);

    assert.equal(first.imported, 1);
    assert.equal(second.imported, 0);
    assert.equal(second.duplicates, 1);
    assert.equal(second.daysUpdated, 0);
    assert.equal((await dayOf('EMP003', '2026-10-27')).punches.length, 1);
  });

  test('WDMS: falls back to JWT for a non-superuser, reports refusals readably, and keeps pagination on the configured host', async () => {
    const http = await import('node:http');
    let acceptLogin = false;

    // Stands in for an easy WDMS server behind a proxy. As observed on the
    // real one, the DRF token endpoint refuses a non-superuser outright, and
    // the JWT endpoint is the one a company account can use. Its `next` links
    // name a host and port that are not the address the HRMS was given.
    const wdms = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api-token-auth/') {
        res.statusCode = 400;
        return res.end(JSON.stringify({ non_field_errors: ['superuser required'] }));
      }
      if (req.url === '/jwt-api-token-auth/') {
        if (!acceptLogin) {
          res.statusCode = 400;
          return res.end(JSON.stringify({ non_field_errors: ['Unable to log in with provided credentials.'] }));
        }
        return res.end(JSON.stringify({ token: 'abc' }));
      }
      if (req.headers.authorization !== 'JWT abc') {
        res.statusCode = 401;
        return res.end(JSON.stringify({ detail: 'Authentication credentials were not provided.' }));
      }
      if (req.url.startsWith('/personnel/api/employees/')) {
        const second = req.url.includes('page=2');
        return res.end(
          JSON.stringify({
            count: 2,
            next: second ? null : 'http://internal-wdms:8000/personnel/api/employees/?page=2&page_size=100',
            results: [second ? { emp_code: '502', first_name: 'Page', last_name: 'Two' } : { emp_code: '501', first_name: 'Page', last_name: 'One' }],
          }),
        );
      }
      res.statusCode = 404;
      return res.end('{}');
    });
    await new Promise((resolve) => wdms.listen(0, '127.0.0.1', resolve));

    const settings = await AppSettings.findOne({ tenantId: null });
    settings.biometricDevices.push({
      name: 'Cloud WDMS',
      protocol: 'WDMS_API',
      ipAddress: '127.0.0.1',
      port: wdms.address().port,
      username: 'api',
      password: 'secret-password',
      autoSync: false,
    });
    await settings.save();
    const wdmsId = String(settings.biometricDevices.at(-1)._id);

    try {
      await assert.rejects(
        () => deviceService.deviceUsers(wdmsId, adminReq),
        (error) => {
          assert.equal(error.statusCode, 502);
          assert.equal(error.isOperational, true);
          // Both servers' answers, so the screen says which login was refused and why.
          assert.match(error.message, /superuser required/);
          assert.match(error.message, /Unable to log in with provided credentials/);
          assert.ok(!error.message.includes('secret-password'));
          return true;
        },
      );

      acceptLogin = true;
      const result = await deviceService.deviceUsers(wdmsId, adminReq);
      assert.deepEqual(result.users.map((user) => user.userId), ['501', '502']);
    } finally {
      await new Promise((resolve) => wdms.close(resolve));
    }
  });

  /* ------------------------------------ the requests the MB360 was seen making */

  test('answers ping and the options post, and records the terminal’s own address from the gateway', async () => {
    await AppSettings.updateOne({ 'biometricDevices._id': deviceId }, { $set: { 'biometricDevices.$.adms.lastSeenAt': null } });

    const ping = await call(`/iclock/ping?SN=${SERIAL}`, { headers: { 'X-ADMS-Device-IP': '203.0.113.9' } });
    assert.equal(ping.status, 200);
    assert.equal(ping.text, 'OK');

    const options = await call(`/iclock/cdata?SN=${SERIAL}&table=options`, {
      method: 'POST',
      body: '~DeviceName=MB360,FirmVer=Ver 6.60,IPAddress=192.168.1.122',
    });
    assert.equal(options.text, 'OK');

    const device = await loadDevice();
    assert.ok(device.adms.lastSeenAt, 'a ping counts as contact');
    assert.equal(device.adms.lastSeenIp, '203.0.113.9');
  });

  test('ignores a device-address header that arrives without the gateway token', async () => {
    const forged = await call(`/iclock/ping?SN=${SERIAL}`, { token: null, headers: { 'X-ADMS-Device-IP': '6.6.6.6' } });
    assert.equal(forged.status, 401);
  });

  test('reads the long ATTLOG lines newer firmware sends, several per upload, with an unset punch state', async () => {
    // PIN, time, state, verify, workcode, then reserved / mask / temperature
    // columns. 255 is what a terminal records when no punch-state key was pressed.
    const body = [
      '101\t2026-10-27 08:58:31\t255\t15\t0\t0\t0\t0\t0\t0',
      '101\t2026-10-27 13:02:10\t255\t15\t0\t0\t0\t0\t0\t0',
      '101\t2026-10-27 17:45:02\t255\t1\t0\t0\t0\t0\t0\t0',
      '',
    ].join('\n');

    const response = await call(`/iclock/cdata?SN=${SERIAL}&table=ATTLOG&Stamp=9999`, { method: 'POST', body });
    assert.equal(response.text, 'OK: 3');

    const day = await dayOf('EMP001', '2026-10-27');
    assert.equal(day.punches.length, 3);
    assert.ok(day.punches.every((punch) => punch.direction === 'UNKNOWN'));
    assert.equal(day.checkInAt.toISOString(), '2026-10-27T05:58:31.000Z');
    assert.equal(day.checkOutAt.toISOString(), '2026-10-27T14:45:02.000Z');
    assert.equal(day.status, 'PRESENT');
  });

  test('a database failure is reported to the terminal, and its retry imports once', async () => {
    const original = BiometricEvent.bulkWrite;
    BiometricEvent.bulkWrite = async () => {
      throw new Error('connection reset by peer');
    };

    const line = ['101\t2026-10-28 09:00:00\t0\t1\t0'];
    try {
      const failed = await attlog(line);
      // Not OK: the terminal keeps the batch and sends it again after ErrorDelay.
      assert.equal(failed.status, 500);
      assert.equal(failed.text, 'ERROR');
    } finally {
      BiometricEvent.bulkWrite = original;
    }

    const retried = await attlog(line);
    assert.equal(retried.text, 'OK: 1');
    const again = await attlog(line);
    assert.equal(again.text, 'OK: 1');

    assert.equal(await BiometricEvent.countDocuments({ deviceId, punchTime: new Date('2026-10-28T06:00:00Z') }), 1);
    assert.equal((await dayOf('EMP001', '2026-10-28')).punches.length, 1);
  });

  test('stores location and notes, and lists per-device punch counters', async () => {
    await deviceService.updateDevice(String(deviceId), { location: 'Camel Oil – main gate', notes: 'Pushes via VM gateway' }, adminReq);

    const list = await deviceService.listDevices(adminReq);
    const row = list.find((device) => String(device._id) === String(deviceId));

    assert.equal(row.location, 'Camel Oil – main gate');
    assert.equal(row.notes, 'Pushes via VM gateway');
    assert.ok(row.punches.received >= row.punches.imported);
    assert.ok(row.punches.imported > 0);
    assert.equal(row.punches.held, 1);
  });

  /* ------------------------------------------------ receiver address, form */

  test('stores the receiver address an administrator enters, and reports it for the terminal', async () => {
    const before = await deviceService.integrationStatus(adminReq);
    assert.equal(before.receiver.deviceSettings.serverAddress, null, 'never guessed when nothing is configured');
    assert.equal(before.receiver.deviceSettings.editable, true);

    const saved = await deviceService.updateReceiverSettings({ url: 'http://34.45.67.52:8081' }, adminReq);
    assert.deepEqual(
      {
        serverAddress: saved.serverAddress,
        serverPort: saved.serverPort,
        https: saved.https,
        url: saved.url,
        source: saved.source,
        enableDomainName: saved.enableDomainName,
      },
      { serverAddress: '34.45.67.52', serverPort: 8081, https: false, url: 'http://34.45.67.52:8081', source: 'SETTINGS', enableDomainName: false },
    );

    const after = await deviceService.integrationStatus(adminReq);
    assert.equal(after.receiver.deviceSettings.url, 'http://34.45.67.52:8081');

    const named = await deviceService.updateReceiverSettings({ url: 'https://adms.example.com' }, adminReq);
    assert.equal(named.serverPort, 443);
    assert.equal(named.https, true);
    assert.equal(named.enableDomainName, true);

    await assert.rejects(() => deviceService.updateReceiverSettings({ url: 'http://34.45.67.52:8081/iclock' }, adminReq), /only the scheme/);

    const cleared = await deviceService.updateReceiverSettings({ url: null }, adminReq);
    assert.equal(cleared.serverAddress, null);

    await deviceService.updateReceiverSettings({ url: 'http://34.45.67.52:8081' }, adminReq);
  });

  test('the receiver URL validator accepts http(s) only', async () => {
    const { receiverSettingsSchema } = await import('../validators/admin/admin.validator.js');
    assert.equal(receiverSettingsSchema.validate({ url: 'http://34.45.67.52:8081' }).error, undefined);
    assert.equal(receiverSettingsSchema.validate({ url: null }).error, undefined);
    assert.ok(receiverSettingsSchema.validate({ url: 'ftp://34.45.67.52' }).error);
    assert.ok(receiverSettingsSchema.validate({ url: 'not a url' }).error);
  });

  test('registers an ADMS device by serial alone, upper-cased, and refuses the same serial twice', async () => {
    const { createBiometricDeviceSchema } = await import('../validators/admin/admin.validator.js');

    // The form's payload: no LAN address, no SDK port.
    const payload = {
      name: 'Second MB360',
      protocol: 'ADMS_PUSH',
      port: 8081,
      serialNumber: 'ueed999000001',
      location: 'Warehouse',
      notes: null,
      isActive: true,
      acceptPunchesFrom: '2026-10-20T00:00:00.000Z',
    };
    const { value, error } = createBiometricDeviceSchema.validate(payload, { stripUnknown: true, convert: true });
    assert.equal(error, undefined);

    const added = await deviceService.addDevice(value, adminReq);
    assert.equal(added.serialNumber, 'UEED999000001');
    assert.equal(added.ipAddress, null);
    assert.equal(added.autoSync, false);
    assert.equal(added.location, 'Warehouse');

    await assert.rejects(
      () => deviceService.addDevice({ ...value, name: 'Duplicate', serialNumber: 'UEED999000001' }, adminReq),
      /already registered/,
    );

    const missingSerial = createBiometricDeviceSchema.validate({ name: 'No serial', protocol: 'ADMS_PUSH', port: 8081 });
    assert.ok(missingSerial.error, 'an ADMS device cannot be saved without its serial');

    // The SDK protocols still require the address they connect to.
    const sdkWithoutIp = createBiometricDeviceSchema.validate({ name: 'LAN', protocol: 'ZK_UDP', port: 4370 });
    assert.ok(sdkWithoutIp.error);

    await deviceService.removeDevice(String(added._id), adminReq);
  });

  test('a getrequest poll is a heartbeat, never a punch', async () => {
    const events = await BiometricEvent.countDocuments({});
    const days = await Attendance.countDocuments({});

    for (let i = 0; i < 3; i += 1) {
      const poll = await call(`/iclock/getrequest?SN=${SERIAL}&INFO=Ver 6.60,242,237,15000,192.168.1.122`);
      assert.equal(poll.status, 200);
    }

    assert.equal(await BiometricEvent.countDocuments({}), events);
    assert.equal(await Attendance.countDocuments({}), days);
  });

  /* --------------------------- the exact requests captured from UEED245000038 */

  test('answers the MB360’s captured handshake, including PushOptionsFlag, with options rather than a bare OK', async () => {
    const response = await call(`/iclock/cdata?SN=${SERIAL}&options=all&language=69&pushver=2.4.1&PushOptionsFlag=1`);

    assert.equal(response.status, 200);
    const lines = response.text.split('\n');
    assert.equal(lines[0], `GET OPTION FROM: ${SERIAL}`);
    for (const option of ['ATTLOGStamp=', 'OPERLOGStamp=', 'ErrorDelay=', 'Delay=', 'TransFlag=', 'Realtime=1']) {
      assert.ok(lines.some((line) => line.startsWith(option)), option);
    }
    assert.notEqual(response.text, 'OK');
  });

  test('takes the captured OPERLOG upload with Stamp=9999', async () => {
    const response = await call(`/iclock/cdata?SN=${SERIAL}&table=OPERLOG&Stamp=9999`, {
      method: 'POST',
      body: 'OPLOG 4\t0\t2026-10-28 08:00:00\t0\t0\t0\t0',
    });
    assert.equal(response.status, 200);
    assert.equal(response.text, 'OK');
    // An operation log is not attendance.
    assert.equal(await BiometricEvent.countDocuments({ punchTime: new Date('2026-10-28T05:00:00Z') }), 0);
  });

  test('reports the receiver on /health without exposing any device', async () => {
    const response = await fetch(`${base}/health`);
    const body = await response.json();
    assert.equal(body.biometricReceiver, 'enabled');
    assert.ok(!JSON.stringify(body).includes(SERIAL));
  });

  test('refuses an inactive device', async () => {
    await AppSettings.updateOne({ 'biometricDevices._id': deviceId }, { $set: { 'biometricDevices.$.isActive': false } });
    const response = await call(`/iclock/getrequest?SN=${SERIAL}`);
    assert.equal(response.status, 403);
    await AppSettings.updateOne({ 'biometricDevices._id': deviceId }, { $set: { 'biometricDevices.$.isActive': true } });
  });
});
