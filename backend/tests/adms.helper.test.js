import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDedupKey,
  buildHandshakeResponse,
  parseAttlogBody,
  parseDeviceCmdBody,
  parseDeviceTime,
  parseOperlogBody,
  parseReceiverAddress,
  renderCommand,
  ADMS_COMMANDS,
} from '../helpers/adms.helper.js';
import { attributeShiftDay } from '../helpers/attendanceRules.helper.js';
import { admsClientIp, ipMatches } from '../middlewares/admsGuard.js';

/**
 * The pure halves of the ADMS integration, against payloads in the shapes ZKTeco
 * terminals send. The sample bodies are synthetic and sanitised -- invented PINs
 * and times, the documented field order -- not captures from a live device.
 */

const NOW = new Date('2026-10-26T12:00:00Z');

describe('parseDeviceTime', () => {
  test('reads wall time in an explicit zone', () => {
    // 08:05 in Dar es Salaam (UTC+3, no DST) is 05:05 UTC.
    assert.equal(parseDeviceTime('2026-10-26 08:05:12', 'Africa/Dar_es_Salaam').toISOString(), '2026-10-26T05:05:12.000Z');
  });

  test('handles a zone with daylight saving on both sides of the change', () => {
    assert.equal(parseDeviceTime('2026-01-15 09:00:00', 'Europe/London').toISOString(), '2026-01-15T09:00:00.000Z');
    assert.equal(parseDeviceTime('2026-07-15 09:00:00', 'Europe/London').toISOString(), '2026-07-15T08:00:00.000Z');
  });

  test('without a zone, reads server-local time like the existing pull paths', () => {
    const parsed = parseDeviceTime('2026-10-26 08:05:12');
    assert.equal(parsed.getHours(), 8);
    assert.equal(parsed.getMinutes(), 5);
  });

  test('rejects impossible dates instead of rolling them over', () => {
    assert.equal(parseDeviceTime('2026-02-31 08:00:00', 'UTC'), null);
    assert.equal(parseDeviceTime('2026-02-31 08:00:00'), null);
    assert.equal(parseDeviceTime('2026-10-26 25:00:00', 'UTC'), null);
    assert.equal(parseDeviceTime('yesterday', 'UTC'), null);
  });
});

describe('parseDeviceTime in Asia/Kolkata', () => {
  test('reads an IST wall-clock punch as the right instant, including the half-hour offset', () => {
    // 09:00 IST (UTC+5:30, no DST) is 03:30 UTC.
    assert.equal(parseDeviceTime('2026-10-28 09:00:00', 'Asia/Kolkata').toISOString(), '2026-10-28T03:30:00.000Z');
    // Just after IST midnight is still the previous UTC day.
    assert.equal(parseDeviceTime('2026-10-28 00:10:00', 'Asia/Kolkata').toISOString(), '2026-10-27T18:40:00.000Z');
  });
});

describe('parseReceiverAddress', () => {
  test('accepts a bare host, host:port, or a URL', () => {
    assert.deepEqual(parseReceiverAddress('34.45.67.52'), { serverAddress: '34.45.67.52', serverPort: 8081, https: false });
    assert.deepEqual(parseReceiverAddress('34.45.67.52:9090'), { serverAddress: '34.45.67.52', serverPort: 9090, https: false });
    assert.deepEqual(parseReceiverAddress('http://34.45.67.52:8081'), { serverAddress: '34.45.67.52', serverPort: 8081, https: false });
    assert.deepEqual(parseReceiverAddress('https://hrms-backend-1.asia-south1.run.app'), {
      serverAddress: 'hrms-backend-1.asia-south1.run.app',
      serverPort: 443,
      https: true,
    });
  });

  test('uses the separate port and HTTPS settings as defaults for a bare host only', () => {
    assert.deepEqual(parseReceiverAddress('adms.example.com', { defaultPort: 443, defaultHttps: true }), {
      serverAddress: 'adms.example.com',
      serverPort: 443,
      https: true,
    });
    // A scheme in the value wins over the default.
    assert.equal(parseReceiverAddress('http://adms.example.com', { defaultHttps: true }).https, false);
  });

  test('refuses a path, credentials, other schemes and junk', () => {
    assert.throws(() => parseReceiverAddress('http://34.45.67.52:8081/iclock'), /only a scheme, host and port/);
    assert.throws(() => parseReceiverAddress('http://user:pass@34.45.67.52'), /only a scheme, host and port/);
    assert.throws(() => parseReceiverAddress('ftp://34.45.67.52'), /http/);
    assert.throws(() => parseReceiverAddress('not a host'), /not a host name/);
    assert.throws(() => parseReceiverAddress(''), /empty/);
  });
});

describe('parseAttlogBody', () => {
  test('reads the positional tab-separated form', () => {
    const body = '101\t2026-10-26 08:55:01\t0\t1\t0\t0\t0\n101\t2026-10-26 18:10:44\t1\t15\t0\n';
    const { records, rejected } = parseAttlogBody(body, { timeZone: 'UTC', now: NOW });

    assert.equal(rejected.length, 0);
    assert.equal(records.length, 2);
    assert.deepEqual(
      { ...records[0], timestamp: records[0].timestamp.toISOString() },
      {
        deviceUserId: '101',
        timestamp: '2026-10-26T08:55:01.000Z',
        deviceLocalTime: '2026-10-26 08:55:01',
        punchType: 0,
        verifyMode: 1,
        workCode: null,
      },
    );
    assert.equal(records[1].punchType, 1);
    assert.equal(records[1].verifyMode, 15);
  });

  test('reads the key=value form some firmware sends', () => {
    const { records } = parseAttlogBody('PIN=7\tDateTime=2026-10-26 07:00:00\tVerified=1\tStatus=0', {
      timeZone: 'UTC',
      now: NOW,
    });
    assert.equal(records.length, 1);
    assert.equal(records[0].deviceUserId, '7');
    assert.equal(records[0].punchType, 0);
  });

  test('rejects bad lines by number without echoing them, and keeps the good ones', () => {
    const body = [
      '101\t2026-10-26 08:55:01\t0\t1',
      'garbage line',
      '<script>\t2026-10-26 08:55:01\t0',
      '102\t2099-01-01 00:00:00\t0\t1', // device clock far in the future
      '103\t2000-01-01 00:00:00\t0\t1', // device clock reset by a flat battery
      '',
      '104\t2026-10-26 09:01:00\t0\t1',
    ].join('\r\n');

    const { records, rejected } = parseAttlogBody(body, { timeZone: 'UTC', now: NOW });

    assert.deepEqual(records.map((record) => record.deviceUserId), ['101', '104']);
    assert.deepEqual(rejected.map((entry) => entry.line), [2, 3, 4, 5]);
    rejected.forEach((entry) => assert.equal(Object.keys(entry).sort().join(), 'line,reason'));
  });
});

describe('parseOperlogBody', () => {
  test('keeps PIN, name and privilege, and never the passcode or card', () => {
    const body = [
      'USER PIN=101\tName=Test User\tPri=0\tPasswd=1234\tCard=[0A1B2C]\tGrp=1\tTZ=0',
      'OPLOG 4\t0\t2026-10-26 08:00:00\t101\t0\t0\t0',
      'FP PIN=101\tFID=6\tSize=1024\tValid=1\tTMP=AAAA',
    ].join('\n');

    const { users, otherRows } = parseOperlogBody(body);

    assert.deepEqual(users, [{ userId: '101', name: 'Test User', privilege: 0 }]);
    assert.equal(otherRows, 2);
    assert.ok(!JSON.stringify(users).includes('1234'));
    assert.ok(!JSON.stringify(users).includes('0A1B2C'));
  });
});

describe('parseDeviceCmdBody', () => {
  test('reads batched results', () => {
    assert.deepEqual(parseDeviceCmdBody('ID=1&Return=0&CMD=DATA\nID=2&Return=-1&CMD=DATA'), [
      { id: 1, returnCode: 0, command: 'DATA' },
      { id: 2, returnCode: -1, command: 'DATA' },
    ]);
  });

  test('reads the one-key-per-line form', () => {
    assert.deepEqual(parseDeviceCmdBody('ID=3\nReturn=0\nCMD=INFO\n'), [{ id: 3, returnCode: 0, command: 'INFO' }]);
  });
});

describe('handshake and commands', () => {
  test('handshake echoes the resume stamps and asks for no biometric data', () => {
    const reply = buildHandshakeResponse({ serialNumber: 'ABC123', attlogStamp: '9999', delaySeconds: 30 });
    const lines = reply.split('\n');

    assert.equal(lines[0], 'GET OPTION FROM: ABC123');
    assert.ok(lines.includes('ATTLOGStamp=9999'));
    assert.ok(lines.includes('OPERLOGStamp=None'));
    assert.ok(lines.includes('Delay=30'));
    const transFlag = lines.find((line) => line.startsWith('TransFlag='));
    assert.ok(!/AttPhoto|EnrollFP|ChgFP|FACE|BIOPHOTO|UserPic/i.test(transFlag));
  });

  test('renders the attendance query in device wall time', () => {
    const text = renderCommand(
      { type: ADMS_COMMANDS.QUERY_ATTLOG, from: '2026-10-01T00:00:00+03:00', to: '2026-10-02T23:59:59+03:00' },
      { timeZone: 'Africa/Dar_es_Salaam' },
    );
    assert.equal(text, 'DATA QUERY ATTLOG StartTime=2026-10-01 00:00:00\tEndTime=2026-10-02 23:59:59');
  });

  test('refuses anything outside the whitelist', () => {
    assert.throws(() => renderCommand({ type: 'Shell' }), /Unsupported/);
    assert.throws(() => renderCommand({ type: 'CLEAR LOG' }), /Unsupported/);
  });
});

describe('buildDedupKey', () => {
  const base = { tenantId: null, deviceKey: 'abc123', deviceUserId: '101', timestamp: new Date('2026-10-26T05:05:12Z') };

  test('is stable and case-insensitive on the device serial', () => {
    assert.equal(buildDedupKey(base), buildDedupKey({ ...base, deviceKey: 'ABC123' }));
  });

  test('distinguishes person, device and second', () => {
    const key = buildDedupKey(base);
    assert.notEqual(key, buildDedupKey({ ...base, deviceUserId: '102' }));
    assert.notEqual(key, buildDedupKey({ ...base, deviceKey: 'OTHER' }));
    assert.notEqual(key, buildDedupKey({ ...base, timestamp: new Date('2026-10-26T05:05:13Z') }));
  });
});

describe('attributeShiftDay', () => {
  const night = { startTime: '22:00', endTime: '06:00', isNightShift: true };
  const day = { startTime: '09:00', endTime: '18:00' };
  const local = (text) => new Date(text); // no zone suffix: server-local, as the engine reads it

  test('files a night-shift exit under the day the shift started', () => {
    assert.equal(attributeShiftDay(local('2026-10-27T05:58:00'), night).getDate(), 26);
    assert.equal(attributeShiftDay(local('2026-10-27T13:59:00'), night).getDate(), 26);
  });

  test('files a night-shift entry under its own day', () => {
    assert.equal(attributeShiftDay(local('2026-10-26T21:55:00'), night).getDate(), 26);
    assert.equal(attributeShiftDay(local('2026-10-26T14:00:00'), night).getDate(), 26);
  });

  test('crosses a month boundary', () => {
    const attributed = attributeShiftDay(local('2026-11-01T05:30:00'), night);
    assert.equal(attributed.getMonth(), 9);
    assert.equal(attributed.getDate(), 31);
  });

  test('leaves day shifts and unrostered staff on the calendar day', () => {
    assert.equal(attributeShiftDay(local('2026-10-26T00:30:00'), day).getDate(), 26);
    assert.equal(attributeShiftDay(local('2026-10-26T00:30:00'), null).getDate(), 26);
  });
});

describe('admsGuard', () => {
  test('matches exact addresses and CIDR ranges, including high addresses', () => {
    assert.ok(ipMatches('196.41.10.7', '196.41.10.7'));
    assert.ok(ipMatches('::ffff:196.41.10.7', '196.41.10.0/24'));
    assert.ok(ipMatches('203.0.113.200', '203.0.113.128/25'));
    assert.ok(!ipMatches('203.0.113.100', '203.0.113.128/25'));
    assert.ok(!ipMatches('10.0.0.1', '196.41.10.0/24'));
    assert.ok(!ipMatches('10.0.0.1', '10.0.0.0/99'));
  });

  test('reads the client from the right of X-Forwarded-For, so a forged entry is never used', () => {
    const req = (forwarded) => ({ headers: { 'x-forwarded-for': forwarded }, socket: { remoteAddress: '169.254.1.1' } });

    // One proxy (Cloud Run): the entry it appended is the client.
    assert.equal(admsClientIp(req('196.41.10.7'), 1), '196.41.10.7');
    // A client that wrote its own header only adds entries on the left.
    assert.equal(admsClientIp(req('1.2.3.4, 196.41.10.7'), 1), '196.41.10.7');
    // A shorter chain than configured falls back to an address that fails the allowlist.
    assert.equal(admsClientIp(req(''), 1), '169.254.1.1');
  });
});
