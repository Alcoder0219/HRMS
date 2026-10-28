import crypto from 'node:crypto';

/**
 * The ZKTeco ADMS ("iClock PUSH") wire format, as pure functions.
 *
 * ADMS reverses the direction of every other transport this product speaks:
 * the TERMINAL is the HTTP client and this server is the endpoint it calls. A
 * device configured with a server address and port makes plain-text requests
 * under a fixed `/iclock/` path:
 *
 *   GET  /iclock/cdata?SN=..&options=all&pushver=..   handshake; the reply
 *                                                      carries the options
 *   POST /iclock/cdata?SN=..&table=ATTLOG&Stamp=..    attendance records
 *   POST /iclock/cdata?SN=..&table=OPERLOG&Stamp=..   operation log + USER rows
 *   GET  /iclock/getrequest?SN=..                     heartbeat / command poll
 *   POST /iclock/devicecmd?SN=..                      result of a command
 *
 * ZKTeco does not publish this protocol openly. What is implemented here is
 * the common subset described by the vendor's "Attendance PUSH Communication
 * Protocol" document and confirmed by independent implementations observed
 * against real terminals. Firmware differs in the edges -- field counts, the
 * key=value variant of ATTLOG, which commands are honoured -- so every parser
 * below is tolerant of the variants and strict about the values it keeps.
 *
 * Nothing in this file touches the database, the request, or the clock, which
 * is what lets the protocol be tested against captured payloads.
 */

/* -------------------------------------------------------------------------- */
/*                                  Limits                                    */
/* -------------------------------------------------------------------------- */

/** A device PIN as it appears on the wire. Matches the mapping schema's limit. */
const PIN_PATTERN = /^[A-Za-z0-9_-]{1,30}$/;

/** `YYYY-MM-DD HH:MM:SS`, with `T` accepted for the firmware that sends ISO. */
const DEVICE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/;

/** A serial number is used as a lookup key, so it is held to a narrow alphabet. */
const SERIAL_PATTERN = /^[A-Za-z0-9_-]{4,60}$/;

/**
 * Punches older than this are not attendance, they are a terminal whose clock
 * was never set -- ZKTeco devices boot to 2000-01-01 after a battery failure.
 */
const EARLIEST_PLAUSIBLE_YEAR = 2010;

/**
 * Tolerated clock drift into the future. A punch further ahead than this is a
 * misconfigured device clock, and importing it would create attendance for a
 * day that has not happened.
 */
const FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000;

export const isValidSerial = (value) => SERIAL_PATTERN.test(String(value ?? ''));

/**
 * The address a terminal is told to call, from either form people write it in.
 *
 *   34.45.67.52            host only -- port and scheme from the defaults
 *   34.45.67.52:8081       host and port
 *   http://34.45.67.52:8081, https://hrms-backend-xxxx.run.app
 *
 * A terminal is configured with a host, a port and an HTTPS switch, and calls
 * a fixed /iclock path itself -- so a path, query or credentials here could
 * only mislead whoever copies the values onto the device, and are refused.
 *
 * @returns {{ serverAddress: string, serverPort: number, https: boolean }}
 * @throws  {Error} with a message naming what is wrong
 */
export const parseReceiverAddress = (text, { defaultPort = 8081, defaultHttps = false } = {}) => {
  const raw = String(text ?? '').trim();
  if (!raw) throw new Error('is empty');

  const hasScheme = /^[a-z]+:\/\//i.test(raw);
  let url;
  try {
    url = new URL(hasScheme ? raw : `${defaultHttps ? 'https' : 'http'}://${raw}`);
  } catch {
    throw new Error(`"${raw}" is not a host name, IP address or URL`);
  }

  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('must use http:// or https://');
  if ((url.pathname && url.pathname !== '/') || url.search || url.hash || url.username || url.password) {
    throw new Error('must be only a scheme, host and port -- the terminal adds /iclock itself');
  }

  const https = hasScheme ? url.protocol === 'https:' : defaultHttps;
  const serverPort = url.port ? Number(url.port) : hasScheme ? (https ? 443 : 80) : defaultPort;

  return { serverAddress: url.hostname, serverPort, https };
};

/* -------------------------------------------------------------------------- */
/*                               Device clock                                 */
/* -------------------------------------------------------------------------- */

/**
 * The offset of `timeZone` from UTC at `instant`, in milliseconds.
 *
 * Read from Intl rather than from a table so a zone with daylight saving is
 * handled correctly without this file knowing which zones those are.
 */
const zoneOffsetMs = (instant, timeZone) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const field = (type) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(field('year'), field('month') - 1, field('day'), field('hour'), field('minute'), field('second'));

  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
};

/** The UTC offset of a zone, in minutes, at a given instant. */
export const timeZoneOffsetMinutes = (timeZone, at = new Date()) => Math.round(zoneOffsetMs(at, timeZone) / 60_000);

/** Throws on a zone name Intl does not know, so a typo fails at boot. */
export const assertTimeZone = (timeZone) => {
  new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
  return timeZone;
};

/**
 * A device timestamp, which carries no zone, as an instant.
 *
 * A terminal stamps punches with its own wall clock and says nothing about
 * where that clock is. With `timeZone` set, the wall time is read in that zone.
 * Without it, it is read in the SERVER's local zone -- which is exactly how the
 * existing SDK, web and WDMS pulls interpret the same strings, so a pushed punch
 * and a pulled punch land on the same instant either way.
 *
 * @returns {Date|null} null when the text is not a device timestamp at all
 */
export const parseDeviceTime = (text, timeZone = null) => {
  const match = DEVICE_TIME_PATTERN.exec(String(text ?? '').trim());
  if (!match) return null;

  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);

  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    return null;
  }

  if (!timeZone) {
    const local = new Date(year, month - 1, day, hour, minute, second);
    // Rejects 31 February rather than letting Date roll it into March.
    return local.getDate() === day ? local : null;
  }

  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  if (new Date(wall).getUTCDate() !== day) return null;

  // Two passes: the first offset is a guess taken at the wrong instant, which
  // is only wrong within an hour of a daylight-saving change.
  let instant = wall - zoneOffsetMs(new Date(wall), timeZone);
  instant = wall - zoneOffsetMs(new Date(instant), timeZone);

  return new Date(instant);
};

/** Whether a punch time is one a working terminal could have produced. */
export const isPlausiblePunchTime = (date, now = new Date()) =>
  date instanceof Date &&
  !Number.isNaN(date.getTime()) &&
  date.getFullYear() >= EARLIEST_PLAUSIBLE_YEAR &&
  date.getTime() <= now.getTime() + FUTURE_TOLERANCE_MS;

/* -------------------------------------------------------------------------- */
/*                                  Parsing                                   */
/* -------------------------------------------------------------------------- */

/** Tab-separated `KEY=value` pairs, as USER rows and the key=value ATTLOG use. */
const parsePairs = (text) => {
  const pairs = {};

  for (const segment of String(text).split('\t')) {
    const at = segment.indexOf('=');
    if (at <= 0) continue;
    pairs[segment.slice(0, at).trim().toUpperCase()] = segment.slice(at + 1).trim();
  }

  return pairs;
};

const toIntOrNull = (value) => {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : null;
};

/**
 * One ATTLOG upload.
 *
 * The positional form is what attendance terminals send:
 *
 *   PIN <tab> YYYY-MM-DD HH:MM:SS <tab> STATUS <tab> VERIFY <tab> WORKCODE <tab> ...
 *
 * Some firmware sends the same fields as `PIN=..<tab>DateTime=..<tab>Status=..`
 * instead, so both are read. Trailing reserved columns are ignored.
 *
 * Rejected lines are reported by NUMBER and reason only. The line itself is not
 * echoed into the result, because the result is what gets logged and a log is
 * not the place for a payload nobody has validated.
 *
 * @returns {{ records: object[], rejected: { line: number, reason: string }[] }}
 */
export const parseAttlogBody = (body, { timeZone = null, now = new Date() } = {}) => {
  const records = [];
  const rejected = [];

  String(body ?? '')
    .split(/\r?\n/)
    .forEach((raw, index) => {
      const line = raw.trim();
      if (!line) return;

      const lineNumber = index + 1;

      let pin;
      let timeText;
      let status;
      let verify;
      let workCode;

      if (/^(PIN|USERID)=/i.test(line)) {
        const pairs = parsePairs(line);
        pin = pairs.PIN ?? pairs.USERID;
        timeText = pairs.DATETIME ?? pairs.TIME ?? pairs.CHECKTIME;
        status = pairs.STATUS;
        verify = pairs.VERIFIED ?? pairs.VERIFY;
        workCode = pairs.WORKCODE;
      } else {
        [pin, timeText, status, verify, workCode] = line.split('\t').map((part) => part.trim());
      }

      if (!pin || !PIN_PATTERN.test(pin)) {
        rejected.push({ line: lineNumber, reason: 'Missing or malformed user ID' });
        return;
      }

      const timestamp = parseDeviceTime(timeText, timeZone);
      if (!timestamp) {
        rejected.push({ line: lineNumber, reason: 'Missing or malformed timestamp' });
        return;
      }

      if (!isPlausiblePunchTime(timestamp, now)) {
        rejected.push({ line: lineNumber, reason: 'Timestamp outside the plausible range — check the device clock' });
        return;
      }

      records.push({
        deviceUserId: pin,
        timestamp,
        deviceLocalTime: String(timeText).trim().replace('T', ' '),
        punchType: toIntOrNull(status),
        verifyMode: toIntOrNull(verify),
        workCode: workCode && workCode !== '0' ? String(workCode).slice(0, 20) : null,
      });
    });

  return { records, rejected };
};

/**
 * One OPERLOG upload, reduced to the enrolments it announces.
 *
 * An operation log mixes several row types -- `OPLOG` audit rows, `USER`
 * enrolments, `FP` and `FACE` templates. Only USER rows are kept, and only
 * their PIN, name and privilege.
 *
 * Deliberately discarded: `Passwd` (the user's device PIN code), `Card` (a
 * credential that opens the door) and every biometric template. The HRMS has no
 * use for any of them, and the safest copy of a credential is the one never
 * stored.
 */
export const parseOperlogBody = (body) => {
  const users = [];
  let otherRows = 0;

  String(body ?? '')
    .split(/\r?\n/)
    .forEach((raw) => {
      const line = raw.trim();
      if (!line) return;

      const userRow = /^USER\s+/i.test(line) ? line.replace(/^USER\s+/i, '') : /^PIN=/i.test(line) ? line : null;

      if (!userRow) {
        otherRows += 1;
        return;
      }

      const pairs = parsePairs(userRow);
      if (!pairs.PIN || !PIN_PATTERN.test(pairs.PIN)) {
        otherRows += 1;
        return;
      }

      users.push({
        userId: pairs.PIN,
        name: pairs.NAME ? pairs.NAME.slice(0, 120) : null,
        privilege: toIntOrNull(pairs.PRI ?? pairs.PRIVILEGE),
      });
    });

  return { users, otherRows };
};

/**
 * Command results from `/iclock/devicecmd`.
 *
 * Usually one `ID=..&Return=..&CMD=..` per line, batched. Shell-style results
 * use one key per line instead; both are read, and a new `ID` starts a new
 * result in either form.
 */
export const parseDeviceCmdBody = (body) => {
  const results = [];
  let current = null;

  const assign = (key, value) => {
    const name = key.trim().toUpperCase();

    if (name === 'ID') {
      current = { id: toIntOrNull(value), returnCode: null, command: null };
      results.push(current);
      return;
    }

    if (!current) return;
    if (name === 'RETURN') current.returnCode = toIntOrNull(value);
    if (name === 'CMD') current.command = String(value).trim().slice(0, 60);
  };

  String(body ?? '')
    .split(/\r?\n/)
    .forEach((raw) => {
      const line = raw.trim();
      if (!line) return;

      for (const segment of line.includes('&') ? line.split('&') : [line]) {
        const at = segment.indexOf('=');
        if (at > 0) assign(segment.slice(0, at), segment.slice(at + 1));
      }
    });

  return results.filter((result) => Number.isInteger(result.id));
};

/* -------------------------------------------------------------------------- */
/*                                 Responses                                  */
/* -------------------------------------------------------------------------- */

/**
 * The handshake reply: the options a terminal runs its push session by.
 *
 *   ATTLOGStamp / OPERLOGStamp  where to resume. The device sends a Stamp with
 *       every upload; echoing the last one back is what stops a re-handshake
 *       from resending the whole log.
 *   Delay        seconds between `getrequest` polls -- the heartbeat.
 *   ErrorDelay   seconds before retrying after a failed request.
 *   TransInterval / Realtime=1  push each punch as it happens, not in batches.
 *   TransFlag    which tables to send. Attendance and enrolments only: no
 *       photos, no fingerprint or face templates. The HRMS has no use for
 *       biometric data and should never be holding it.
 */
export const buildHandshakeResponse = ({
  serialNumber,
  attlogStamp = null,
  operlogStamp = null,
  delaySeconds = 30,
  errorDelaySeconds = 60,
}) =>
  [
    `GET OPTION FROM: ${serialNumber}`,
    `ATTLOGStamp=${attlogStamp || 'None'}`,
    `OPERLOGStamp=${operlogStamp || 'None'}`,
    'ATTPHOTOStamp=None',
    `ErrorDelay=${errorDelaySeconds}`,
    `Delay=${delaySeconds}`,
    'TransTimes=00:00;14:05',
    'TransInterval=1',
    'TransFlag=TransData AttLog OpLog EnrollUser ChgUser',
    'Realtime=1',
    'Encrypt=None',
  ].join('\n');

/**
 * Server-to-device commands this receiver will ever issue.
 *
 * A whitelist, not a convenience. The same channel can carry `Shell`, `CLEAR
 * LOG` and `DATA DELETE USERINFO`, and a command queue that accepted free text
 * would turn an HRMS account into remote root on the terminal and a way to wipe
 * the only copy of the attendance log. Only reads are allowed.
 */
export const ADMS_COMMANDS = {
  /** Asks the device to re-upload the attendance log for a window. */
  QUERY_ATTLOG: 'QUERY_ATTLOG',
  /** Asks the device to upload its enrolment list (arrives as OPERLOG). */
  QUERY_USERINFO: 'QUERY_USERINFO',
  /** Asks the device to report firmware and capacity. */
  INFO: 'INFO',
};

/** The device's own wall-clock notation, for a command's time window. */
const formatDeviceTime = (date, timeZone = null) => {
  const pad = (number) => String(number).padStart(2, '0');

  if (!timeZone) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  const shifted = new Date(date.getTime() + zoneOffsetMs(date, timeZone));
  return shifted.toISOString().slice(0, 19).replace('T', ' ');
};

/** The wire text for one whitelisted command. */
export const renderCommand = ({ type, from = null, to = null }, { timeZone = null } = {}) => {
  switch (type) {
    case ADMS_COMMANDS.QUERY_ATTLOG:
      return `DATA QUERY ATTLOG StartTime=${formatDeviceTime(new Date(from), timeZone)}\tEndTime=${formatDeviceTime(new Date(to), timeZone)}`;
    case ADMS_COMMANDS.QUERY_USERINFO:
      return 'DATA QUERY USERINFO';
    case ADMS_COMMANDS.INFO:
      return 'INFO';
    default:
      throw new Error(`Unsupported ADMS command: ${type}`);
  }
};

/* -------------------------------------------------------------------------- */
/*                               Deduplication                                */
/* -------------------------------------------------------------------------- */

/**
 * The identity of one punch, stable across every transport and every retry.
 *
 * ADMS carries no event ID, and neither do the SDK or WDMS pulls in any form
 * that survives a device being re-registered. What does identify a punch is
 * who, where and when: one enrolment on one terminal cannot produce two
 * punches in the same second. The punch TYPE is deliberately excluded -- the
 * same physical punch re-uploaded after someone edited its state on the device
 * is still the same punch, and counting it twice would double a day.
 *
 * The device key is its serial where known, so the same terminal pulled over
 * WDMS and pushed over ADMS de-duplicates against itself.
 */
export const buildDedupKey = ({ tenantId, deviceKey, deviceUserId, timestamp }) =>
  crypto
    .createHash('sha256')
    .update(`${tenantId ?? 'default'}|${String(deviceKey).toUpperCase()}|${deviceUserId}|${new Date(timestamp).toISOString()}`)
    .digest('hex');

export default {
  isValidSerial,
  parseReceiverAddress,
  assertTimeZone,
  timeZoneOffsetMinutes,
  parseDeviceTime,
  isPlausiblePunchTime,
  parseAttlogBody,
  parseOperlogBody,
  parseDeviceCmdBody,
  buildHandshakeResponse,
  renderCommand,
  buildDedupKey,
  ADMS_COMMANDS,
};
