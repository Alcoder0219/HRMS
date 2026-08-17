import nodemailer from 'nodemailer';

import AppSettings from '../../models/admin/appSettings.model.js';

import ApiError from '../../utils/ApiError.js';
import env from '../../config/env.js';
import logger from '../../config/logger.js';
import { AUDIT_ACTIONS } from '../../utils/constants.js';
import { recordAudit, diffObjects } from '../../helpers/audit.helper.js';
import { resetTransport } from '../../helpers/mailer.helper.js';

/**
 * Company profile, outbound mail and notification policy.
 *
 * One document per tenant, created on first read. An administrator opening the
 * screen before anyone has saved anything should see the defaults laid out,
 * not an empty page and an error -- so the read is an upsert of an empty
 * document rather than a 404.
 */

const tenantOf = (req) => req.user?.tenantId ?? null;

const MASK = '********';

/** The stored settings document, created if this tenant has none yet. */
const load = async (tenantId, { withPassword = false } = {}) => {
  const query = AppSettings.findOne({ tenantId });
  if (withPassword) query.select('+email.password');

  const found = await query;
  if (found) return found;

  return AppSettings.create({ tenantId });
};

/**
 * Mail settings as the client may see them.
 *
 * The password is never returned in any form, not even encrypted. What the
 * screen needs to know is whether one is set, so it can show "unchanged"
 * instead of an empty box that would look like the password was lost.
 */
const presentEmail = (settings, hasPassword) => ({
  enabled: settings.email?.enabled ?? false,
  host: settings.email?.host ?? null,
  port: settings.email?.port ?? 587,
  secure: settings.email?.secure ?? false,
  username: settings.email?.username ?? null,
  passwordSet: hasPassword,
  password: hasPassword ? MASK : null,
  fromName: settings.email?.fromName ?? null,
  fromAddress: settings.email?.fromAddress ?? null,
  replyTo: settings.email?.replyTo ?? null,
  lastTestedAt: settings.email?.lastTestedAt ?? null,
  lastTestOk: settings.email?.lastTestOk ?? null,
  lastTestError: settings.email?.lastTestError ?? null,
  /**
   * What the server would use if these settings were disabled.
   *
   * Shown so an administrator can see that mail already works from the
   * environment before switching to a stored configuration and, most likely,
   * breaking it.
   */
  environmentFallback: {
    configured: Boolean(env.mail.host),
    host: env.mail.host || null,
    from: env.mail.from,
  },
});

export const getSettings = async (req) => {
  const settings = await load(tenantOf(req), { withPassword: true });
  const hasPassword = Boolean(settings.email?.password);

  return {
    company: settings.company ?? {},
    email: presentEmail(settings, hasPassword),
    notifications: settings.notifications ?? {},
    maintenanceMode: settings.maintenanceMode,
    maintenanceMessage: settings.maintenanceMessage,
    lastBackupAt: settings.lastBackupAt,
    lastRestoreAt: settings.lastRestoreAt,
    updatedAt: settings.updatedAt,
  };
};

export const updateCompany = async (payload, req) => {
  const settings = await load(tenantOf(req));
  const before = settings.company?.toObject ? settings.company.toObject() : { ...settings.company };

  Object.entries(payload).forEach(([key, value]) => {
    settings.company[key] = value;
  });

  settings.updatedBy = req.user?.id ?? null;
  await settings.save();

  const changes = diffObjects(before, settings.company.toObject());
  if (changes.length) {
    await recordAudit({
      req,
      entity: 'CompanyProfile',
      entityId: settings._id,
      entityLabel: settings.company?.name ?? 'Company profile',
      action: AUDIT_ACTIONS.UPDATE,
      changes,
    });
  }

  return settings.company;
};

/**
 * Saves mail settings.
 *
 * An absent or masked password leaves the stored one alone. Without that rule,
 * loading the screen and saving an unrelated field would blank the password,
 * because the form never held the real value to send back.
 */
export const updateEmail = async (payload, req) => {
  const settings = await load(tenantOf(req), { withPassword: true });
  const hadPassword = Boolean(settings.email?.password);

  const changed = [];

  ['enabled', 'host', 'port', 'secure', 'username', 'fromName', 'fromAddress', 'replyTo'].forEach((field) => {
    if (payload[field] === undefined) return;
    if (settings.email[field] !== payload[field]) {
      changed.push({ field, from: settings.email[field] ?? null, to: payload[field] });
      settings.email[field] = payload[field];
    }
  });

  if (payload.password !== undefined && payload.password !== MASK && payload.password !== '') {
    settings.email.password = payload.password;
    changed.push({ field: 'password', from: hadPassword ? MASK : null, to: MASK });
  }

  if (payload.clearPassword) {
    settings.email.password = null;
    changed.push({ field: 'password', from: hadPassword ? MASK : null, to: null });
  }

  if (settings.email.enabled && !settings.email.host) {
    throw ApiError.badRequest('A host is required before mail can be enabled');
  }

  settings.updatedBy = req.user?.id ?? null;
  await settings.save();

  // The mailer caches its transport; stale settings would keep sending
  // through the old server until the process restarted.
  resetTransport();

  if (changed.length) {
    await recordAudit({
      req,
      entity: 'EmailConfiguration',
      entityId: settings._id,
      entityLabel: settings.email?.host ?? 'Email configuration',
      action: AUDIT_ACTIONS.UPDATE,
      changes: changed,
    });
  }

  return presentEmail(settings, Boolean(settings.email?.password));
};

/**
 * Verifies the stored mail settings, optionally by sending to an address.
 *
 * Failures are returned as a result rather than thrown: "your SMTP password is
 * wrong" is the answer to the question, not an error in asking it, and a 500
 * here would tell the administrator nothing they could act on.
 */
export const testEmail = async ({ to }, req) => {
  const settings = await load(tenantOf(req), { withPassword: true });
  const config = settings.email ?? {};

  if (!config.host) throw ApiError.badRequest('No mail host is configured to test');

  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port ?? 587,
    secure: Boolean(config.secure),
    auth: config.username ? { user: config.username, pass: config.password ?? '' } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
  });

  let ok = false;
  let message = null;

  try {
    await transport.verify();

    if (to) {
      await transport.sendMail({
        from: config.fromAddress
          ? `${config.fromName ?? 'HRMS'} <${config.fromAddress}>`
          : env.mail.from,
        to,
        subject: 'HRMS mail configuration test',
        text: 'This message confirms that the HRMS mail configuration is working.',
      });
    }

    ok = true;
    message = to ? `Test message sent to ${to}` : 'The mail server accepted the connection';
  } catch (error) {
    ok = false;
    message = error.message;
    logger.warn('Mail configuration test failed', { host: config.host, error: error.message });
  } finally {
    transport.close?.();
  }

  settings.email.lastTestedAt = new Date();
  settings.email.lastTestOk = ok;
  settings.email.lastTestError = ok ? null : String(message).slice(0, 500);
  await settings.save();

  return { ok, message, testedAt: settings.email.lastTestedAt };
};

export const updateNotifications = async (payload, req) => {
  const settings = await load(tenantOf(req));
  const before = settings.notifications?.toObject
    ? settings.notifications.toObject()
    : { ...settings.notifications };

  Object.entries(payload).forEach(([key, value]) => {
    settings.notifications[key] = value;
  });

  settings.updatedBy = req.user?.id ?? null;
  await settings.save();

  const changes = diffObjects(before, settings.notifications.toObject());
  if (changes.length) {
    await recordAudit({
      req,
      entity: 'NotificationSettings',
      entityId: settings._id,
      entityLabel: 'Notification settings',
      action: AUDIT_ACTIONS.UPDATE,
      changes,
    });
  }

  return settings.notifications;
};

export const setMaintenance = async ({ enabled, message }, req) => {
  const settings = await load(tenantOf(req));
  const from = settings.maintenanceMode;

  settings.maintenanceMode = enabled;
  settings.maintenanceMessage = enabled ? (message ?? null) : null;
  settings.updatedBy = req.user?.id ?? null;
  await settings.save();

  await recordAudit({
    req,
    entity: 'AppSettings',
    entityId: settings._id,
    entityLabel: 'Maintenance mode',
    action: AUDIT_ACTIONS.STATUS_CHANGE,
    changes: [{ field: 'maintenanceMode', from, to: enabled }],
  });

  return { maintenanceMode: settings.maintenanceMode, maintenanceMessage: settings.maintenanceMessage };
};

/** Used by the mailer to prefer stored settings over the environment. */
export const resolveMailConfig = async (tenantId = null) => {
  const settings = await AppSettings.findOne({ tenantId }).select('+email.password').lean();
  if (!settings?.email?.enabled || !settings.email.host) return null;

  return {
    host: settings.email.host,
    port: settings.email.port ?? 587,
    secure: Boolean(settings.email.secure),
    user: settings.email.username ?? '',
    password: settings.email.password ?? '',
    from: settings.email.fromAddress
      ? `${settings.email.fromName ?? 'HRMS'} <${settings.email.fromAddress}>`
      : env.mail.from,
  };
};

export default {
  getSettings,
  updateCompany,
  updateEmail,
  testEmail,
  updateNotifications,
  setMaintenance,
  resolveMailConfig,
};
