import ZKLib from 'node-zklib';

import logger from '../../config/logger.js';
import ApiError from '../../utils/ApiError.js';
import AppSettings from '../../models/admin/appSettings.model.js';
import {
  mapPunchDirection,
  recordAndApply,
  seenDeviceUserIds,
  systemContext,
  ZK_PUNCH_TYPES,
} from './biometricEvent.service.js';

/**
 * The only module that reaches OUT to a physical attendance terminal.
 *
 * Everything above it -- the admin endpoints, the cron job -- deals in device
 * records and sync results, never in sockets. That boundary is what makes the
 * rest of the product testable without a device on the desk, and what means a
 * second vendor's protocol is a new branch in `connectToDevice` rather than a
 * change spread across the codebase.
 *
 * It deliberately does NOT compute attendance. Punches are handed to the event
 * layer, which stores them, de-duplicates them and passes the new ones to
 * `ingestBiometric` -- the same path an ADMS push takes. A pulled day and a
 * pushed day must produce identical attendance, and they do, because they run
 * the same code.
 *
 * ADMS_PUSH devices are the exception that proves the rule: they call in and
 * are never called, so nothing here opens a connection to one. Their side
 * lives in `admsReceiver.service.js`.
 */

// Kept importable from here, where they have always been.
export { mapPunchDirection, systemContext, ZK_PUNCH_TYPES };

/** Nothing here waits on a device longer than this. */
const CONNECT_TIMEOUT_MS = 10_000;

/**
 * A device that has never synced is not asked for its entire history.
 *
 * ZKTeco terminals hold months of logs -- tens of thousands of punches -- and
 * importing all of it on the first run would recompute a year of attendance
 * days that payroll has already closed. The first sync takes the recent window
 * and the high-water mark carries it forward from there. An administrator who
 * genuinely wants the older logs can widen this by back-dating `lastSyncAt`.
 */
const FIRST_SYNC_WINDOW_DAYS = 7;

/* -------------------------------------------------------------------------- */
/*                                 Connection                                 */
/* -------------------------------------------------------------------------- */

/** Rejects rather than hanging when a device accepts a socket and says nothing. */
const withTimeout = (promise, ms, label) => {
  let timer;

  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

/**
 * Closes a ZK session without trusting the library to do it.
 *
 * `zk.disconnect()` dispatches through `functionWrapper`, which switches on
 * `connectionType` -- and when a connection ATTEMPT failed, that field was
 * never set. The wrapper falls to its default branch and rejects with
 * "Socket isn't connected" without ever calling `closeSocket()`, so the bound
 * UDP handle is leaked. One handle per failed attempt, every sync interval,
 * for as long as a device stays unreachable.
 *
 * The transports are therefore closed directly, then destroyed outright if
 * they are somehow still open. Bounded, and silent: this runs on the failure
 * path, and an error here would replace the real diagnosis with noise about
 * cleanup.
 */
const closeQuietly = async (zk) => {
  for (const transport of [zk?.zklibUdp, zk?.zklibTcp]) {
    if (!transport?.socket) continue;
    try {
      await withTimeout(transport.disconnect(), 3_000, 'disconnect');
    } catch {
      /* falls through to the hard close below */
    }
  }

  try {
    zk?.zklibUdp?.socket?.close();
  } catch {
    /* already closed */
  }
  try {
    zk?.zklibTcp?.socket?.destroy();
  } catch {
    /* already closed */
  }
};

/** Reached over a raw SDK socket, which means: on the local network only. */
const isSocketProtocol = (device) => device.protocol === 'ZK_UDP' || device.protocol === 'ZK_TCP';

/** A terminal serving its own logs over HTTP as tab-separated text. */
const isWebProtocol = (device) => device.protocol === 'ZK_WEB' || device.protocol === 'GENERIC_API';

/** A WDMS/BioTime server that terminals push to. Authenticated, aggregated. */
const isWdmsProtocol = (device) => device.protocol === 'WDMS_API';

/** A terminal that pushes to this server's `/iclock` receiver. Never polled. */
export const isPushProtocol = (device) => device.protocol === 'ADMS_PUSH';

/**
 * Whether an ADMS terminal has been heard from recently enough to call online.
 *
 * Three missed heartbeats plus slack, so one dropped poll on a flaky office
 * link does not flicker the indicator.
 */
export const isPushDeviceOnline = (device, { pollDelaySeconds = 30, now = new Date() } = {}) => {
  const lastSeen = device.adms?.lastSeenAt;
  if (!lastSeen) return false;
  return now.getTime() - new Date(lastSeen).getTime() <= (pollDelaySeconds * 3 + 30) * 1000;
};

/**
 * What a "connection test" means for a device nobody can call.
 *
 * The only honest answer is when it last called in. Nothing is sent to it --
 * there is no address to send to -- and a test that reported success without
 * ever having heard from the terminal would be a lie the whole feature exists
 * to prevent.
 */
const pushDeviceStatus = (device, { pollDelaySeconds = 30 } = {}) => {
  const state = device.adms ?? {};
  const online = isPushDeviceOnline(device, { pollDelaySeconds });

  if (!state.lastSeenAt) {
    return {
      connected: false,
      protocol: device.protocol,
      info: null,
      error: `Serial ${device.serialNumber} has never contacted this server`,
      suggestion:
        'On the terminal, open Comm → Cloud Server Setting, set Server Mode to ADMS and point it at this ' +
        'server (or at the office gateway). The serial number entered here must match the one in the ' +
        "device's System Info exactly.",
    };
  }

  return {
    connected: online,
    protocol: device.protocol,
    info: {
      serverType: 'ADMS',
      serialNumber: device.serialNumber,
      firmware: state.firmware ?? null,
      platform: state.deviceModel ?? null,
      pushVersion: state.pushVersion ?? null,
      lastSeenAt: state.lastSeenAt,
      lastSeenIp: state.lastSeenIp ?? null,
      userCount: state.enrolments?.length || null,
      logCount: null,
    },
    error: online ? null : `No contact since ${new Date(state.lastSeenAt).toISOString()}`,
    suggestion: online
      ? null
      : 'The terminal has stopped calling in. Check its network cable or Wi-Fi, the office gateway if one is used, and the Cloud Server Setting on the device.',
  };
};

/**
 * Why a LAN protocol failed, in terms of what to do about it.
 *
 * The SDK runs over UDP or a raw TCP socket to a terminal on the same network.
 * Neither traverses NAT, so a device configured this way but addressed across
 * the internet cannot work however long it is retried -- and the timeout it
 * produces looks identical to a device that is merely switched off. Saying so
 * turns an afternoon of debugging into a settings change.
 */
const protocolSuggestion = (device) => {
  if (isSocketProtocol(device)) {
    return (
      'This protocol uses the ZKTeco SDK socket, which only works on the local network — ' +
      'UDP and raw TCP do not cross NAT or firewalls. If the device is remote, switch the ' +
      'protocol to ZK_WEB (port 8081) for a terminal that serves its own logs over HTTP, or ' +
      'WDMS_API if the address is a ZKTeco WDMS/BioTime server rather than a terminal.'
    );
  }

  if (isWebProtocol(device)) {
    return (
      'No ZKTeco web endpoint answered. If this address serves a WDMS or BioTime web ' +
      'application rather than a terminal, switch the protocol to WDMS_API and supply a ' +
      'username and password.'
    );
  }

  return null;
};

/**
 * Opens a socket to a ZKTeco terminal.
 *
 * `inport` is 0 so the kernel assigns an ephemeral local UDP port. The library
 * binds whatever it is given, and a fixed number would make two devices syncing
 * at the same moment collide with EADDRINUSE -- which is exactly what the cron
 * job does when several terminals fall due on the same tick.
 *
 * The library's own `createSocket()` always tries TCP and falls back to UDP
 * only on ECONNREFUSED, so it cannot honour an explicit protocol choice. A
 * device configured for UDP therefore drives the UDP transport directly. That
 * reaches into the library's internals knowingly: the alternative is a setting
 * that silently does nothing.
 */
export const connectToDevice = async (device) => {
  if (isPushProtocol(device)) {
    throw ApiError.badRequest('An ADMS_PUSH device calls this server; it cannot be connected to.');
  }

  if (!isSocketProtocol(device)) {
    throw ApiError.badRequest(
      `${device.protocol} is an HTTP protocol and holds no socket. Use the HTTP client instead.`,
    );
  }

  const zk = new ZKLib(device.ipAddress, device.port, CONNECT_TIMEOUT_MS, 0);

  try {
    if (device.protocol === 'ZK_UDP') {
      await withTimeout(zk.zklibUdp.createSocket(), CONNECT_TIMEOUT_MS, 'UDP connect');
      await withTimeout(zk.zklibUdp.connect(), CONNECT_TIMEOUT_MS, 'UDP handshake');
      zk.connectionType = 'udp';
    } else {
      await withTimeout(zk.zklibTcp.createSocket(), CONNECT_TIMEOUT_MS, 'TCP connect');
      await withTimeout(zk.zklibTcp.connect(), CONNECT_TIMEOUT_MS, 'TCP handshake');
      zk.connectionType = 'tcp';
    }

    return zk;
  } catch (error) {
    // Leave no half-open socket behind: a leaked UDP handle holds the event
    // loop open and accumulates one per failed attempt.
    await closeQuietly(zk);
    throw new Error(
      `Could not reach ${device.ipAddress}:${device.port} over ${device.protocol} — ${error.message}`,
    );
  }
};

/**
 * Runs `work` against a connected device and always closes the socket.
 *
 * Every exported operation goes through this. A device left connected refuses
 * the next session until its own timeout expires, so a sync that threw halfway
 * would lock out the one that follows it five minutes later.
 */
const withDevice = async (device, work) => {
  const zk = await connectToDevice(device);

  try {
    return await work(zk);
  } finally {
    await closeQuietly(zk);
  }
};

/* -------------------------------------------------------------------------- */
/*                     HTTP: terminal web API (ZK_WEB)                        */
/* -------------------------------------------------------------------------- */

const httpBase = (device) => `http://${device.ipAddress}:${device.port}`;

/**
 * The paths a ZKTeco web terminal is known to serve its data on.
 *
 * Two vendor generations use different prefixes for the same thing and there is
 * no way to tell them apart short of asking, so both are tried in turn. A 404
 * is not an error here -- it is the answer "not this one".
 */
const WEB_API_PATHS = ['/iclock/getdata', '/csl/getdata'];

/**
 * Fetches one kind of data from a terminal's own web interface.
 *
 * Returns the path that worked alongside the payload, because knowing WHICH
 * endpoint answered is most of the diagnosis when a device half-works -- and it
 * is shown on the connection test for exactly that reason.
 */
export const fetchFromDevice = async (device, dataType, timeout = 15_000) => {
  const attempts = [];

  for (const path of WEB_API_PATHS) {
    const url = `${httpBase(device)}${path}?type=${encodeURIComponent(dataType)}`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(timeout),
        headers: { Accept: 'text/plain, application/json' },
      });

      if (response.ok) {
        const data = await response.text();

        /**
         * A 200 carrying HTML is not this API.
         *
         * A web application on the same port answers every unknown path with
         * its own page, so treating any 200 as success would parse a login
         * screen as an attendance log and import nothing while reporting
         * success. This is precisely what a WDMS server does.
         */
        if (/^\s*<(!doctype|html)/i.test(data)) {
          attempts.push(`${path}: returned an HTML page, not device data`);
          continue;
        }

        return { data, path, status: response.status };
      }

      attempts.push(`${path}: HTTP ${response.status}`);
    } catch (error) {
      attempts.push(`${path}: ${error.message}`);
    }
  }

  throw new Error(
    `No ZKTeco web endpoint answered at ${httpBase(device)} (${attempts.join('; ')})`,
  );
};

/** Header rows, in the spellings the various firmwares use. */
const isHeaderRow = (value) => ['user_id', 'pin', 'userid', 'no'].includes(String(value).toLowerCase());

/**
 * Attendance rows from a terminal's web API.
 *
 *   USER_ID <tab> TIMESTAMP <tab> STATUS <tab> VERIFY_MODE
 *
 * Split on tabs OR commas: the same firmware family serves both depending on
 * how it was configured, and the fields never legitimately contain either.
 *
 * Unlike the SDK path, this one DOES carry the punch type, so the punches
 * arrive properly labelled IN or OUT.
 */
export const parseAttendanceLines = (rawText) => {
  const punches = [];

  for (const line of String(rawText ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue;

    const parts = line.split(/[\t,]/).map((part) => part.trim());
    if (parts.length < 3) continue;

    const [userId, timestamp, status] = parts;
    if (!userId || isHeaderRow(userId)) continue;

    const time = new Date(timestamp);
    if (Number.isNaN(time.getTime())) continue;

    punches.push({
      deviceUserId: String(userId),
      timestamp: time,
      punchType: Number.parseInt(status, 10),
    });
  }

  return punches;
};

/**
 * Enrolment rows from a terminal's web API.
 *
 *   USER_ID <tab> NAME <tab> PRIVILEGE <tab> CARD_NO
 */
export const parseUserLines = (rawText) => {
  const users = [];

  for (const line of String(rawText ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue;

    const parts = line.split(/[\t,]/).map((part) => part.trim());
    if (parts.length < 2) continue;

    const [userId, name, privilege, cardNumber] = parts;
    if (!userId || isHeaderRow(userId)) continue;

    users.push({
      userId: String(userId),
      name: name || null,
      role: privilege ?? null,
      cardNumber: cardNumber || null,
    });
  }

  return users;
};

/* -------------------------------------------------------------------------- */
/*                    HTTP: WDMS / BioTime server (WDMS_API)                  */
/* -------------------------------------------------------------------------- */

/**
 * A ZKTeco WDMS or BioTime server, which is not a terminal.
 *
 * Terminals PUSH to it over the iClock protocol; it stores every punch from
 * every device registered to it and serves them through an authenticated REST
 * API. That makes it the right thing to integrate with whenever it exists: it
 * is reachable over the internet, it needs no LAN, and it already holds the
 * logs of devices this HRMS could never reach directly.
 *
 * The API is Django REST Framework:
 *
 *   POST /api-token-auth/            {username, password} -> {token}
 *   GET  /iclock/api/transactions/   Authorization: Token <token>
 *   GET  /iclock/api/terminals/
 *   GET  /personnel/api/employees/
 *
 * Results are paginated in the DRF style -- {count, next, previous, results}.
 */
const WDMS = {
  auth: '/api-token-auth/',
  transactions: '/iclock/api/transactions/',
  terminals: '/iclock/api/terminals/',
  employees: '/personnel/api/employees/',
};

/**
 * Exchanges the stored credentials for an API token.
 *
 * Not cached between syncs. A DRF token is long-lived, but caching it would
 * mean holding a credential in process memory across tenants for the sake of
 * one request per sync -- and a sync runs every few minutes, not every second.
 */
const wdmsLogin = async (device) => {
  if (!device.username || !device.password) {
    throw new Error('WDMS_API needs a username and password. Add them to the device.');
  }

  const response = await fetch(`${httpBase(device)}${WDMS.auth}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ username: device.username, password: device.password }),
    signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok || !payload.token) {
    // The server's own wording, which distinguishes a wrong password from an
    // account that is disabled -- and is more useful than anything invented.
    const detail =
      payload.non_field_errors?.join(' ') ?? payload.detail ?? `HTTP ${response.status}`;
    throw new Error(`WDMS rejected the credentials: ${detail}`);
  }

  return payload.token;
};

/**
 * A paginated collection, followed to the end.
 *
 * `pageLimit` is a guard rather than a preference: a server holding years of
 * punches would otherwise be walked in full on a first sync, and the sync is
 * bounded by time anyway.
 */
const wdmsGet = async (device, token, path, params = {}, { pageLimit = 50 } = {}) => {
  const results = [];
  let url = new URL(`${httpBase(device)}${path}`);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '') url.searchParams.set(key, value);
  });

  for (let page = 0; page < pageLimit && url; page += 1) {
    const response = await fetch(url, {
      headers: { Authorization: `Token ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS * 2),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`WDMS ${path} responded ${response.status} ${body.slice(0, 160)}`);
    }

    const payload = await response.json();

    // DRF pagination, with a bare array as the un-paginated fallback.
    if (Array.isArray(payload)) return payload;

    results.push(...(payload.results ?? []));
    url = payload.next ? new URL(payload.next) : null;
  }

  return results;
};

/**
 * The field names differ across WDMS and BioTime builds for the same value, so
 * each is read through a list of candidates rather than one guess.
 */
const pick = (row, ...keys) => {
  for (const key of keys) {
    if (row[key] !== null && row[key] !== undefined && row[key] !== '') return row[key];
  }
  return null;
};

/* -------------------------------------------------------------------------- */
/*                              Device queries                                */
/* -------------------------------------------------------------------------- */

/**
 * Identity and capacity. Used by Test Connection, and by nothing that writes.
 *
 * The counts are the useful half: an administrator who sees 0 enrolled users
 * has reached *a* device but not the one they meant.
 */
export const getDeviceInfo = async (device) => {
  if (isWdmsProtocol(device)) {
    const token = await wdmsLogin(device);
    const terminals = await wdmsGet(device, token, WDMS.terminals, {}, { pageLimit: 5 });

    // One row when the device row is pinned to a serial, otherwise the whole
    // estate the server is collecting from.
    const matching = device.wdmsTerminalSerial
      ? terminals.filter((row) => String(pick(row, 'sn', 'serial_number') ?? '') === device.wdmsTerminalSerial)
      : terminals;

    return {
      serverType: 'WDMS',
      terminalCount: terminals.length,
      terminals: matching.slice(0, 20).map((row) => ({
        serialNumber: pick(row, 'sn', 'serial_number'),
        alias: pick(row, 'alias', 'terminal_name', 'name'),
        lastActivity: pick(row, 'last_activity', 'last_online'),
      })),
      serialNumber: device.wdmsTerminalSerial ?? device.serialNumber ?? null,
      userCount: null,
      logCount: null,
    };
  }

  if (isWebProtocol(device)) {
    const response = await fetchFromDevice(device, 'deviceinfo', CONNECT_TIMEOUT_MS);

    /**
     * Terminal firmware returns this as loose `key=value` text rather than a
     * structured document, so the few fields worth showing are picked out and
     * the rest is left alone.
     */
    const field = (name) =>
      (new RegExp(`${name}=([^,\\n\\r]+)`, 'i').exec(response.data) ?? [])[1]?.trim() ?? null;

    return {
      serialNumber: field('SerialNumber') ?? device.serialNumber ?? null,
      firmware: field('FirmVer'),
      platform: field('Platform'),
      userCount: Number(field('UserCount')) || null,
      logCount: Number(field('TransactionCount') ?? field('AttLogCount')) || null,
      apiPath: response.path,
    };
  }

  return withDevice(device, async (zk) => {
    const info = await withTimeout(zk.getInfo(), CONNECT_TIMEOUT_MS, 'getInfo');

    /**
     * Serial, firmware and platform come from separate commands that not every
     * firmware answers. They are reported when available and null when not,
     * rather than failing a connection test that has already succeeded.
     */
    const optional = async (command) => {
      try {
        const raw = await withTimeout(zk.executeCmd(1011, command), 4_000, command);
        return String(raw ?? '')
          .replace(/\0/g, '')
          .split('=')
          .pop()
          .trim() || null;
      } catch {
        return null;
      }
    };

    return {
      serialNumber: (await optional('~SerialNumber')) ?? device.serialNumber ?? null,
      firmware: await optional('~ZKFPVersion'),
      platform: await optional('~Platform'),
      userCount: info?.userCounts ?? null,
      logCount: info?.logCounts ?? null,
      logCapacity: info?.logCapacity ?? null,
    };
  });
};

/**
 * Everyone enrolled on the device.
 *
 * Feeds the mapping screen. `userId` is the field the attendance logs key off,
 * NOT `uid` -- `uid` is the device's internal row number and changes when
 * enrolments are deleted, which would silently break every mapping made
 * against it.
 */
export const getDeviceUsers = async (device, { tenantId = null } = {}) => {
  /**
   * An ADMS terminal is never read on demand. Its roster is what it last
   * announced in an operation log -- plus, for a terminal that has not sent
   * one yet, the IDs it has actually punched with, so nobody who is clocking
   * in is missing from the mapping screen.
   */
  if (isPushProtocol(device)) {
    const enrolled = new Map((device.adms?.enrolments ?? []).map((entry) => [entry.userId, entry]));
    const seen = await seenDeviceUserIds(tenantId, device._id);

    seen.forEach((userId) => {
      if (!enrolled.has(userId)) enrolled.set(userId, { userId, name: null, privilege: null });
    });

    return [...enrolled.values()]
      .map((entry) => ({ userId: entry.userId, name: entry.name ?? null, role: entry.privilege ?? null, cardNumber: null }))
      .sort((a, b) => a.userId.localeCompare(b.userId, undefined, { numeric: true }));
  }

  if (isWdmsProtocol(device)) {
    const token = await wdmsLogin(device);
    const employees = await wdmsGet(device, token, WDMS.employees);

    return employees
      .map((row) => ({
        // `emp_code` is the identifier a punch carries, not the row's `id`.
        userId: String(pick(row, 'emp_code', 'pin', 'badgenumber', 'user_id') ?? '').trim(),
        name: [pick(row, 'first_name', 'name'), pick(row, 'last_name')].filter(Boolean).join(' ') || null,
        role: pick(row, 'privilege') ?? null,
        cardNumber: pick(row, 'card_no', 'card_number') ?? null,
      }))
      .filter((user) => user.userId);
  }

  if (isWebProtocol(device)) {
    const response = await fetchFromDevice(device, 'user');
    return parseUserLines(response.data);
  }

  return withDevice(device, async (zk) => {
    const result = await withTimeout(zk.getUsers(), CONNECT_TIMEOUT_MS * 3, 'getUsers');

    return (result?.data ?? [])
      .map((user) => ({
        userId: String(user.userId ?? user.uid ?? '').trim(),
        name: (user.name ?? '').trim() || null,
        role: user.role ?? null,
        cardNumber: user.cardno ? String(user.cardno) : null,
      }))
      .filter((user) => user.userId);
  });
};

/**
 * Quick reachability probe. Failure is a result, not an exception.
 *
 * A failure carries a `suggestion` where one applies. The commonest way to
 * misconfigure this is to point a LAN-only protocol at an internet address, and
 * the timeout that produces is indistinguishable from a device being switched
 * off -- so the check that can tell them apart says so here rather than leaving
 * it to be worked out.
 */
export const testConnection = async (device, { pollDelaySeconds = 30 } = {}) => {
  if (isPushProtocol(device)) return pushDeviceStatus(device, { pollDelaySeconds });

  try {
    const info = await getDeviceInfo(device);
    return { connected: true, protocol: device.protocol, info, error: null, suggestion: null };
  } catch (error) {
    logger.warn('Biometric device test failed', {
      device: device.name,
      protocol: device.protocol,
      address: `${device.ipAddress}:${device.port}`,
      error: error.message,
    });

    return {
      connected: false,
      protocol: device.protocol,
      info: null,
      error: error.message,
      suggestion: protocolSuggestion(device),
    };
  }
};

/* -------------------------------------------------------------------------- */
/*                                   Sync                                     */
/* -------------------------------------------------------------------------- */

/**
 * Raw logs, normalised to `{ deviceUserId, timestamp, punchType }`.
 *
 * `since` is passed down rather than only being filtered afterwards: the WDMS
 * API can filter server-side, and asking a server holding a year of punches for
 * all of them so the caller can discard 99% is the difference between a sync
 * that takes a second and one that times out.
 */
const readLogs = async (device, since) => {
  if (isWdmsProtocol(device)) {
    const token = await wdmsLogin(device);

    const rows = await wdmsGet(device, token, WDMS.transactions, {
      // DRF filter names vary by build; both are accepted and an unknown query
      // parameter is ignored rather than rejected.
      start_time: since?.toISOString().slice(0, 19).replace('T', ' '),
      punch_time__gte: since?.toISOString(),
      terminal_sn: device.wdmsTerminalSerial ?? undefined,
      page_size: 500,
    });

    return rows
      .map((row) => ({
        deviceUserId: String(pick(row, 'emp_code', 'pin', 'badgenumber', 'user_id') ?? '').trim(),
        timestamp: new Date(pick(row, 'punch_time', 'checktime', 'timestamp')),
        punchType: pick(row, 'punch_state', 'checktype', 'status'),
      }))
      .filter((log) => log.deviceUserId && !Number.isNaN(log.timestamp.getTime()));
  }

  if (isWebProtocol(device)) {
    const response = await fetchFromDevice(device, 'attlog');
    return parseAttendanceLines(response.data);
  }

  return withDevice(device, async (zk) => {
    const result = await withTimeout(zk.getAttendances(), CONNECT_TIMEOUT_MS * 6, 'getAttendances');

    /**
     * `punchType` is null on this path, and that is a property of the library
     * rather than of the device.
     *
     * A ZKTeco attendance record carries the punch type at byte 31 of its
     * 40-byte form, but node-zklib's decoder returns only the user id and the
     * timestamp and drops the rest -- and its UDP decoder reads a 16-byte
     * record that never had the field at all. Punches therefore arrive
     * unlabelled and are stored as UNKNOWN.
     *
     * That is correct rather than merely tolerable: attendance is computed
     * first-punch-to-last-punch from the TIMES, and direction labels are read
     * only to catch a contradiction. See `reducePunches`.
     */
    return (result?.data ?? [])
      .map((record) => ({
        deviceUserId: String(record.deviceUserId ?? '').trim(),
        timestamp: new Date(record.recordTime),
        punchType: record.punchType ?? null,
      }))
      .filter((log) => log.deviceUserId && !Number.isNaN(log.timestamp.getTime()));
  });
};

/** Persists the outcome without rewriting the rest of the settings document. */
const recordSyncOutcome = async (tenantId, deviceId, fields) => {
  await AppSettings.updateOne(
    { tenantId: tenantId ?? null, 'biometricDevices._id': deviceId },
    { $set: Object.fromEntries(Object.entries(fields).map(([key, value]) => [`biometricDevices.$.${key}`, value])) },
  );
};

/**
 * Pulls a device's logs and hands the new ones to the attendance engine.
 *
 * Idempotent in the way that matters: `lastSyncAt` is a high-water mark on the
 * PUNCH timestamps, so re-running immediately imports nothing. It is advanced
 * only on the strength of punches actually taken, which is why a device whose
 * clock is behind the server's does not lose the punches in between.
 *
 * Unmapped device user IDs are reported, never guessed at -- and no longer
 * dropped either: every punch read is stored as an event, so one that arrives
 * before its enrolment is mapped is imported by Reprocess once it is. A retry
 * or a back-dated mark is equally safe, because the event store will not take
 * the same punch twice.
 *
 * @returns {{ success, punchesFound, punchesSynced, daysUpdated, duplicates, held, unmappedUserIds, unknownEmployeeCodes, errors }}
 */
export const syncAttendanceLogs = async (device, tenantId, actorReq = null) => {
  if (isPushProtocol(device)) {
    throw ApiError.badRequest('An ADMS_PUSH device sends its own punches; there is nothing to pull.');
  }

  const req = actorReq ?? systemContext(tenantId);
  const startedAt = new Date();

  const result = {
    deviceId: String(device._id),
    deviceName: device.name,
    success: false,
    punchesFound: 0,
    punchesSynced: 0,
    duplicates: 0,
    held: 0,
    daysUpdated: 0,
    unmappedUserIds: [],
    unknownEmployeeCodes: [],
    errors: [],
  };

  try {
    /**
     * The window to import.
     *
     * After the first run this is the high-water mark, exclusive -- a punch at
     * exactly `lastSyncAt` was taken last time, and re-importing it would push
     * a duplicate onto the day's punch array.
     *
     * Computed BEFORE the read so a server-side filter can use it. The local
     * filter below still runs regardless: a terminal cannot filter at all, and
     * a WDMS build that ignores the query parameter must not be trusted to
     * have honoured it.
     */
    const since = device.lastSyncAt
      ? new Date(device.lastSyncAt)
      : new Date(startedAt.getTime() - FIRST_SYNC_WINDOW_DAYS * 86_400_000);

    const logs = await readLogs(device, since);
    result.punchesFound = logs.length;

    const fresh = logs.filter((log) => log.timestamp > since);

    if (fresh.length) {
      /**
       * The one call that writes. Everything above is transport and
       * translation; storing, de-duplicating, mapping and the day recompute
       * all belong to the event layer and the ingest service beneath it.
       */
      const recorded = await recordAndApply({
        tenantId,
        device,
        transport: device.protocol,
        kind: 'PULL',
        logs: fresh,
        req,
      });

      result.punchesSynced = recorded.imported;
      result.duplicates = recorded.duplicate;
      result.held = recorded.held;
      result.daysUpdated = recorded.daysUpdated;
      result.unmappedUserIds = recorded.unmappedUserIds;
      result.unknownEmployeeCodes = recorded.unknownEmployeeCodes ?? [];
      result.errors.push(...recorded.errors);
    }

    /**
     * The mark advances to the newest punch SEEN, including ones that could not
     * be mapped.
     *
     * Holding it back for an unmapped punch would re-read the same rejected
     * logs on every run forever. Nothing is lost by advancing it: an unmapped
     * punch is stored as an UNMAPPED event, and Reprocess imports it once a
     * mapping exists.
     */
    const newest = fresh.reduce(
      (latest, log) => (log.timestamp > latest ? log.timestamp : latest),
      since,
    );

    const partial = result.unmappedUserIds.length > 0 || result.errors.length > 0;
    result.success = true;

    const message = partial
      ? `${result.punchesSynced} punch(es) synced; ${result.unmappedUserIds.length} unmapped device user(s)`
      : `${result.punchesSynced} punch(es) synced`;

    await recordSyncOutcome(tenantId, device._id, {
      lastSyncAt: newest,
      lastAttemptAt: startedAt,
      lastSyncStatus: partial ? 'PARTIAL' : 'SUCCESS',
      lastSyncMessage: message.slice(0, 500),
      lastSyncPunchCount: result.punchesSynced,
    });

    logger.info('Biometric device synced', {
      device: device.name,
      address: `${device.ipAddress}:${device.port}`,
      found: result.punchesFound,
      synced: result.punchesSynced,
      daysUpdated: result.daysUpdated,
      unmapped: result.unmappedUserIds.length,
    });

    return result;
  } catch (error) {
    result.success = false;
    result.errors.push(error.message);

    /**
     * `lastAttemptAt` advances even on failure, but `lastSyncAt` does NOT.
     *
     * That pair is what makes an offline device back off to its normal interval
     * instead of being retried on every tick of the job, while still losing
     * nothing: the moment it answers again, the unchanged high-water mark pulls
     * in everything that happened while it was away.
     */
    await recordSyncOutcome(tenantId, device._id, {
      lastAttemptAt: startedAt,
      lastSyncStatus: 'FAILED',
      lastSyncMessage: String(error.message).slice(0, 500),
    }).catch(() => {});

    logger.error('Biometric device sync failed', {
      device: device.name,
      address: `${device.ipAddress}:${device.port}`,
      error: error.message,
    });

    return result;
  }
};

/**
 * Wipes the device's stored logs.
 *
 * Never called automatically and never by the cron job. A terminal's log is the
 * only copy of what it read; clearing it after a sync that silently dropped
 * unmapped punches would destroy the evidence needed to recover them. It exists
 * because full devices stop recording, and that is a decision for a person.
 */
export const clearDeviceLogs = async (device) => {
  if (!isSocketProtocol(device)) {
    throw ApiError.badRequest('Clearing logs is only supported over the ZK socket protocol');
  }

  return withDevice(device, async (zk) => {
    await withTimeout(zk.clearAttendanceLog(), CONNECT_TIMEOUT_MS, 'clearAttendanceLog');
    logger.warn('Biometric device logs cleared', { device: device.name });
    return { cleared: true };
  });
};

export default {
  connectToDevice,
  getDeviceInfo,
  getDeviceUsers,
  syncAttendanceLogs,
  testConnection,
  clearDeviceLogs,
  mapPunchDirection,
  systemContext,
  isPushProtocol,
  isPushDeviceOnline,
  fetchFromDevice,
  parseAttendanceLines,
  parseUserLines,
};
