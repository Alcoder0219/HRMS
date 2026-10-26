import env from '../../config/env.js';
import logger from '../../config/logger.js';
import AppSettings from '../../models/admin/appSettings.model.js';
import BiometricSyncLog from '../../models/attendance/biometricSyncLog.model.js';
import {
  buildHandshakeResponse,
  parseAttlogBody,
  parseDeviceCmdBody,
  parseOperlogBody,
  renderCommand,
} from '../../helpers/adms.helper.js';
import { recordAndApply } from './biometricEvent.service.js';

/**
 * The server side of a ZKTeco terminal's ADMS push session.
 *
 * Each exported handler takes what the device sent -- serial, query, body --
 * and returns the plain-text reply the device expects. HTTP, guards and rate
 * limits belong to the route; attendance belongs to the event layer. What is
 * left here is the session: who this terminal is, what it is owed back, and
 * what it last told us.
 *
 * Identity is the serial number, and only a serial registered by an
 * administrator as an active ADMS_PUSH device is served. An unknown one is
 * refused and remembered, so the settings screen can show "a terminal with
 * serial X is trying to connect" instead of leaving someone to read logs.
 */

/** A heartbeat arrives every few seconds; `lastSeenAt` is written at most this often. */
const SEEN_WRITE_INTERVAL_MS = 20_000;

/** Commands handed out per poll. The device runs them in order. */
const COMMANDS_PER_POLL = 5;

/** A command the device has not confirmed within this long is given up on. */
const COMMAND_EXPIRY_MS = 24 * 60 * 60 * 1000;

/** Enrolments kept per device -- the terminal's own capacity is in this range. */
const MAX_ENROLMENTS = 5000;

/* -------------------------------------------------------------------------- */
/*                               Device identity                              */
/* -------------------------------------------------------------------------- */

export class AdmsRejection extends Error {
  constructor(status, reply, reason) {
    super(reason);
    this.status = status;
    this.reply = reply;
  }
}

/**
 * Serials that called in without being registered, per instance.
 *
 * In memory, deliberately: this is a hint for the administrator setting a
 * device up, not a record, and persisting every unknown caller would let
 * anyone on the internet write to the database by guessing at a URL.
 */
const unregistered = new Map();
const MAX_UNREGISTERED = 50;
const UNREGISTERED_LOG_INTERVAL_MS = 10 * 60 * 1000;

const noteUnregistered = (serial, ip) => {
  const now = new Date();
  const entry = unregistered.get(serial) ?? { serialNumber: serial, firstSeenAt: now, requests: 0, lastLoggedAt: 0 };

  entry.lastSeenAt = now;
  entry.lastSeenIp = ip;
  entry.requests += 1;

  if (now.getTime() - entry.lastLoggedAt > UNREGISTERED_LOG_INTERVAL_MS) {
    logger.warn('ADMS request from an unregistered serial number', { serialNumber: serial, ip });
    entry.lastLoggedAt = now.getTime();
  }

  unregistered.delete(serial);
  unregistered.set(serial, entry);
  if (unregistered.size > MAX_UNREGISTERED) unregistered.delete(unregistered.keys().next().value);
};

export const listUnregisteredSerials = () =>
  [...unregistered.values()]
    .reverse()
    .map(({ lastLoggedAt: _ignored, ...entry }) => entry);

/**
 * The tenant and device a serial belongs to, with everything a request needs.
 *
 * `$elemMatch` in the projection returns only the matching device, so a tenant
 * with twenty terminals does not load all twenty on every heartbeat.
 */
export const resolveDevice = async (serial, ip) => {
  const settings = await AppSettings.findOne(
    { biometricDevices: { $elemMatch: { serialNumber: serial, protocol: 'ADMS_PUSH' } } },
    { tenantId: 1, biometricDevices: { $elemMatch: { serialNumber: serial, protocol: 'ADMS_PUSH' } } },
  ).lean();

  const device = settings?.biometricDevices?.[0];

  if (!device) {
    noteUnregistered(serial, ip);
    throw new AdmsRejection(403, 'UNKNOWN DEVICE', 'Serial number is not registered as an ADMS device');
  }

  if (!device.isActive) {
    throw new AdmsRejection(403, 'DEVICE DISABLED', 'Device is registered but inactive');
  }

  return { tenantId: settings.tenantId ?? null, device };
};

/** Writes ADMS session fields on one device without rewriting the document. */
const updateState = (tenantId, deviceId, set = {}, extra = {}) =>
  AppSettings.updateOne(
    { tenantId: tenantId ?? null, 'biometricDevices._id': deviceId },
    {
      ...(Object.keys(set).length
        ? { $set: Object.fromEntries(Object.entries(set).map(([key, value]) => [`biometricDevices.$.${key}`, value])) }
        : {}),
      ...extra,
    },
  );

/**
 * Records that the device is alive, at most every twenty seconds.
 *
 * The online indicator needs a fresh timestamp; it does not need one written
 * on every five-second poll from every terminal in the estate.
 */
const touch = async ({ tenantId, device }, ip, fields = {}) => {
  const last = device.adms?.lastSeenAt ? new Date(device.adms.lastSeenAt).getTime() : 0;
  const due = Date.now() - last >= SEEN_WRITE_INTERVAL_MS;

  if (!due && !Object.keys(fields).length) return;

  await updateState(tenantId, device._id, {
    'adms.lastSeenAt': new Date(),
    'adms.lastSeenIp': ip ?? null,
    ...fields,
  });
};

/**
 * Firmware, as some devices report it on every poll.
 *
 *   INFO=Ver 8.0.4.2-20190920,12,0,1534,192.168.1.201,10,7,15,0,111
 *
 * Only the version is kept -- the counts change with every punch and the LAN
 * address is the office's business.
 */
const firmwareFrom = (query) => {
  const info = query.INFO ?? query.info;
  if (!info) return null;
  const version = String(info).split(',')[0].trim();
  return version ? version.slice(0, 80) : null;
};

/* -------------------------------------------------------------------------- */
/*                                  Handlers                                  */
/* -------------------------------------------------------------------------- */

/**
 * `GET /iclock/cdata?SN=..&options=all` -- the session handshake.
 *
 * The reply's stamps are what the device last sent, so a terminal that reboots
 * resumes where it left off instead of re-uploading its whole memory.
 */
export const handshake = async (context, { query, ip }) => {
  const state = context.device.adms ?? {};

  await touch(context, ip, {
    'adms.lastHandshakeAt': new Date(),
    'adms.pushVersion': query.pushver ? String(query.pushver).slice(0, 30) : (state.pushVersion ?? null),
    ...(query.DeviceType || query.devicetype
      ? { 'adms.deviceModel': String(query.DeviceType ?? query.devicetype).slice(0, 80) }
      : {}),
  });

  logger.info('ADMS handshake', { device: context.device.name, serialNumber: context.device.serialNumber, ip });

  return buildHandshakeResponse({
    serialNumber: context.device.serialNumber,
    attlogStamp: state.attlogStamp,
    operlogStamp: state.operlogStamp,
    delaySeconds: env.adms.pollDelaySeconds,
    errorDelaySeconds: env.adms.errorDelaySeconds,
  });
};

/** A stamp is an opaque resume marker; anything that is not one is not stored. */
const cleanStamp = (value) => {
  const text = String(value ?? '').trim();
  return /^[A-Za-z0-9._-]{1,30}$/.test(text) ? text : null;
};

/**
 * `POST /iclock/cdata?SN=..&table=ATTLOG` -- attendance.
 *
 * The reply acknowledges every line it read, valid or not. A malformed line is
 * logged and dropped; refusing the whole upload because of it would make the
 * terminal resend the same batch forever and block every punch behind it.
 *
 * A database failure is the opposite case, and THROWS: the route answers 500,
 * the terminal keeps the batch and retries after ErrorDelay, and the event
 * store makes that retry harmless.
 */
export const receiveAttlog = async (context, { query, body, ip }) => {
  const { tenantId, device } = context;
  const { records, rejected } = parseAttlogBody(body, { timeZone: env.biometricTimeZone });

  const result = await recordAndApply({
    tenantId,
    device,
    transport: 'ADMS_PUSH',
    kind: 'PUSH',
    logs: records,
    rejected,
    remoteIp: ip,
  });

  const now = new Date();
  const stamp = cleanStamp(query.Stamp ?? query.stamp);
  const previousNewest = device.adms?.lastEventAt ? new Date(device.adms.lastEventAt) : null;
  const newest =
    result.newestPunchTime && (!previousNewest || result.newestPunchTime > previousNewest)
      ? result.newestPunchTime
      : previousNewest;

  const partial = result.unmapped > 0 || result.held > 0 || result.rejected > 0 || result.failed > 0;

  // The list columns the pull devices already fill, so the settings table
  // reads the same whichever direction a device's punches travel.
  await touch(context, ip, {
    ...(stamp ? { 'adms.attlogStamp': stamp } : {}),
    'adms.lastEventAt': newest,
    'adms.lastEventReceivedAt': now,
    lastSyncAt: now,
    lastAttemptAt: now,
    lastSyncStatus: result.failed > 0 && result.imported === 0 ? 'FAILED' : partial ? 'PARTIAL' : 'SUCCESS',
    lastSyncMessage: `Push: ${result.imported} imported, ${result.duplicate} duplicate, ${result.unmapped} unmapped, ${result.held} held, ${result.rejected} rejected`.slice(0, 500),
    lastSyncPunchCount: result.imported,
  });

  if (rejected.length) {
    logger.warn('ADMS upload contained invalid lines', {
      device: device.name,
      rejected: rejected.length,
      reasons: [...new Set(rejected.map((entry) => entry.reason))],
    });
  }

  return `OK: ${records.length + rejected.length}`;
};

/**
 * `POST /iclock/cdata?SN=..&table=OPERLOG` -- the operation log.
 *
 * Read only for the USER rows, which are how an ADMS terminal tells the server
 * who is enrolled. They replace the stored row for the same PIN; nobody is
 * removed, because an operation log describes changes, not the whole roster.
 */
export const receiveOperlog = async (context, { query, body, ip }) => {
  const { users } = parseOperlogBody(body);
  const stamp = cleanStamp(query.OpStamp ?? query.Stamp ?? query.stamp);

  if (users.length) {
    const reportedAt = new Date();
    const merged = new Map((context.device.adms?.enrolments ?? []).map((entry) => [entry.userId, entry]));
    users.forEach((user) => merged.set(user.userId, { ...user, reportedAt }));

    await touch(context, ip, {
      'adms.enrolments': [...merged.values()].slice(-MAX_ENROLMENTS),
      'adms.enrolmentsReportedAt': reportedAt,
      ...(stamp ? { 'adms.operlogStamp': stamp } : {}),
    });

    logger.info('ADMS enrolments reported', { device: context.device.name, users: users.length });
  } else if (stamp) {
    await touch(context, ip, { 'adms.operlogStamp': stamp });
  } else {
    await touch(context, ip);
  }

  return 'OK';
};

/**
 * Anything else posted to cdata -- photos, templates, option dumps.
 *
 * Acknowledged and discarded. None of it is requested, and fingerprint and face
 * data in particular must not be stored by an HRMS. Answering OK stops the
 * terminal retrying it.
 */
export const receiveOther = async (context, { ip }) => {
  await touch(context, ip);
  return 'OK';
};

/**
 * `GET /iclock/getrequest` -- the heartbeat, and the only way to reach the device.
 *
 * Replies with queued commands as `C:<id>:<command>` lines, or `OK` when there
 * are none.
 */
export const poll = async (context, { query, ip }) => {
  const { tenantId, device } = context;
  const firmware = firmwareFrom(query);
  const now = Date.now();

  const commands = device.adms?.commands ?? [];
  const expired = commands.filter(
    (command) => ['QUEUED', 'SENT'].includes(command.status) && now - new Date(command.queuedAt).getTime() > COMMAND_EXPIRY_MS,
  );
  const due = commands
    .filter((command) => command.status === 'QUEUED' && !expired.includes(command))
    .slice(0, COMMANDS_PER_POLL);

  await touch(context, ip, firmware && firmware !== device.adms?.firmware ? { 'adms.firmware': firmware } : {});

  if (!due.length && !expired.length) return 'OK';

  const sentAt = new Date();
  const changed = new Map([
    ...expired.map((command) => [command.commandId, { status: 'EXPIRED', completedAt: sentAt }]),
    ...due.map((command) => [command.commandId, { status: 'SENT', sentAt }]),
  ]);

  await updateState(tenantId, device._id, {
    'adms.commands': commands.map((command) =>
      changed.has(command.commandId) ? { ...command, ...changed.get(command.commandId) } : command,
    ),
  });

  if (!due.length) return 'OK';

  logger.info('ADMS commands sent', { device: device.name, commands: due.map((command) => command.type) });

  return due
    .map((command) => `C:${command.commandId}:${renderCommand(command, { timeZone: env.biometricTimeZone })}`)
    .join('\n');
};

/**
 * `POST /iclock/devicecmd` -- what the device made of the commands.
 *
 * A non-negative Return is success. -1 on an attendance query usually means
 * "no records in that window", which the screen says rather than calling it a
 * failure.
 */
export const receiveCommandResults = async (context, { body, ip }) => {
  const { tenantId, device } = context;
  const results = parseDeviceCmdBody(body);
  const commands = device.adms?.commands ?? [];
  const byId = new Map(results.map((result) => [result.id, result]));
  const completedAt = new Date();

  const matched = commands.filter((command) => byId.has(command.commandId));

  if (matched.length) {
    await updateState(tenantId, device._id, {
      'adms.commands': commands.map((command) => {
        const result = byId.get(command.commandId);
        if (!result) return command;
        return {
          ...command,
          status: result.returnCode !== null && result.returnCode >= 0 ? 'DONE' : 'FAILED',
          returnCode: result.returnCode,
          completedAt,
        };
      }),
    });

    await BiometricSyncLog.create({
      tenantId: tenantId ?? null,
      deviceId: device._id,
      deviceSerial: device.serialNumber,
      kind: 'COMMAND',
      transport: 'ADMS_PUSH',
      success: matched.every((command) => (byId.get(command.commandId).returnCode ?? -1) >= 0),
      message: matched
        .map((command) => `${command.type} #${command.commandId} returned ${byId.get(command.commandId).returnCode}`)
        .join('; ')
        .slice(0, 500),
      remoteIp: ip,
    }).catch((error) => logger.warn('Could not log ADMS command result', { error: error.message }));
  }

  await touch(context, ip);
  return 'OK';
};

export default {
  resolveDevice,
  handshake,
  receiveAttlog,
  receiveOperlog,
  receiveOther,
  poll,
  receiveCommandResults,
  listUnregisteredSerials,
  AdmsRejection,
};
