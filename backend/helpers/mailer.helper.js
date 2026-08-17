import nodemailer from 'nodemailer';
import env from '../config/env.js';
import logger from '../config/logger.js';

let transporter = null;
let activeFrom = null;

/**
 * Mail settings configured in the Administration screens, when present.
 *
 * Injected rather than imported: the settings service already imports this
 * helper to reset the transport, and importing it back would close the loop.
 * `server.js` wires it up once at boot; until then the environment is used,
 * which is also what keeps the mailer usable in scripts and tests.
 */
let configResolver = null;

export const useMailConfigResolver = (resolver) => {
  configResolver = resolver;
  transporter = null;
};

/**
 * Drops the cached transport so the next send rebuilds it.
 *
 * Called whenever the stored configuration changes. Without it, saving new
 * SMTP settings would keep sending through the old server until the process
 * restarted -- and the administrator would have no way to tell.
 */
export const resetTransport = () => {
  transporter?.close?.();
  transporter = null;
  activeFrom = null;
};

/**
 * SMTP is optional. With no host configured -- neither stored nor in the
 * environment -- the mailer logs the message (link included) instead of
 * sending it, so local development and CI can exercise the full verification
 * and reset flows without a mail server, and without silently swallowing a
 * delivery failure in production, which is logged as an error and surfaced to
 * the caller.
 *
 * Stored settings win over the environment: an administrator who configured
 * mail in the UI expects that to be what the system uses.
 */
const getTransporter = async () => {
  if (transporter) return transporter;

  const stored = configResolver ? await configResolver().catch(() => null) : null;
  const config = stored ?? (env.mail.host ? { ...env.mail, password: env.mail.password } : null);

  if (!config?.host) return null;

  activeFrom = config.from ?? env.mail.from;

  transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.user ? { user: config.user, pass: config.password } : undefined,
  });

  return transporter;
};

export const sendMail = async ({ to, subject, html, text }) => {
  const transport = await getTransporter();

  if (!transport) {
    logger.warn('SMTP not configured - email not sent', { to, subject, preview: text });
    return { delivered: false, reason: 'SMTP_NOT_CONFIGURED' };
  }

  try {
    const info = await transport.sendMail({ from: activeFrom ?? env.mail.from, to, subject, html, text });
    logger.info('Email sent', { to, subject, messageId: info.messageId });
    return { delivered: true, messageId: info.messageId };
  } catch (error) {
    // Never rethrow: a failed verification email must not roll back a
    // successful registration. It is logged and the token stays resendable.
    logger.error('Email delivery failed', { to, subject, error: error.message });
    return { delivered: false, reason: 'DELIVERY_FAILED' };
  }
};

/* -------------------------------------------------------------- templates */

const layout = (heading, body) => `
  <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1c252e">
    <h2 style="color:#1565c0;margin:0 0 16px">${heading}</h2>
    ${body}
    <hr style="border:none;border-top:1px solid #e3e8ef;margin:24px 0" />
    <p style="font-size:12px;color:#5a6a78">This is an automated message from HRMS. Please do not reply.</p>
  </div>`;

const button = (url, label) => `
  <p style="margin:24px 0">
    <a href="${url}" style="background:#1565c0;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;display:inline-block">${label}</a>
  </p>
  <p style="font-size:12px;color:#5a6a78">If the button does not work, copy this link:<br />${url}</p>`;

export const sendVerificationEmail = ({ to, name, token }) => {
  const url = `${env.clientUrl}/auth/verify-email?token=${token}`;
  return sendMail({
    to,
    subject: 'Verify your HRMS account',
    text: `Hi ${name}, verify your account: ${url}`,
    html: layout(
      'Verify your email address',
      `<p>Hi ${name},</p>
       <p>Confirm this address to activate your HRMS account. The link expires in ${env.auth.emailVerificationExpiryHours} hours.</p>
       ${button(url, 'Verify email')}`,
    ),
  });
};

export const sendPasswordResetEmail = ({ to, name, token }) => {
  const url = `${env.clientUrl}/auth/reset-password?token=${token}`;
  return sendMail({
    to,
    subject: 'Reset your HRMS password',
    text: `Hi ${name}, reset your password: ${url}`,
    html: layout(
      'Reset your password',
      `<p>Hi ${name},</p>
       <p>Use the link below to set a new password. It expires in ${env.auth.passwordResetExpiryMinutes} minutes and can only be used once.</p>
       ${button(url, 'Reset password')}
       <p>If you did not request this, no action is needed -- your password has not changed.</p>`,
    ),
  });
};

export const sendPasswordChangedEmail = ({ to, name }) =>
  sendMail({
    to,
    subject: 'Your HRMS password was changed',
    text: `Hi ${name}, your password was just changed. If this wasn't you, contact your administrator immediately.`,
    html: layout(
      'Your password was changed',
      `<p>Hi ${name},</p>
       <p>Your HRMS password was changed and all other sessions were signed out.</p>
       <p><strong>If this wasn't you, contact your administrator immediately.</strong></p>`,
    ),
  });

/* ---------------------------------------------------------------- leave -- */

const asDate = (value) =>
  value ? new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

const range = (request) =>
  request.from && request.to && new Date(request.from).getTime() !== new Date(request.to).getTime()
    ? `${asDate(request.from)} to ${asDate(request.to)}`
    : asDate(request.from);

/**
 * Tells an approver that leave is waiting on them.
 *
 * `to` is resolved by the caller because the routing rule -- reporting manager,
 * department head, or an HR queue -- belongs to the leave service, not here.
 * With no recipient the mail is skipped rather than sent nowhere.
 */
export const sendLeaveRequestEmail = async ({ to, employee, request, typeName }) => {
  if (!to) return { delivered: false, reason: 'NO_RECIPIENT' };

  const name = employee ? `${employee.firstName} ${employee.lastName}` : 'An employee';

  return sendMail({
    to,
    subject: `Leave request ${request.requestNumber} awaits your approval`,
    text: `${name} has applied for ${request.days} day(s) of ${typeName} on ${range(request)}. Reason: ${request.reason}`,
    html: layout(
      'Leave awaiting approval',
      `<p><strong>${name}</strong> has applied for leave.</p>
       <p><strong>${typeName}</strong> — ${request.days} day(s)<br/>${range(request)}</p>
       <p>Reason: ${request.reason}</p>
       <p>Open HRMS to approve or reject it.</p>`,
    ),
  });
};

/** Tells the applicant what was decided, and why when it was refused. */
export const sendLeaveDecisionEmail = async ({ to, name, request, decision, comment }) => {
  if (!to) return { delivered: false, reason: 'NO_RECIPIENT' };

  const approved = decision === 'APPROVED';
  const verdict = approved ? 'approved' : 'rejected';

  return sendMail({
    to,
    subject: `Your leave request ${request.requestNumber} was ${verdict}`,
    text: `Hi ${name}, your leave for ${range(request)} was ${verdict}.${comment ? ` Comment: ${comment}` : ''}`,
    html: layout(
      `Leave ${verdict}`,
      `<p>Hi ${name},</p>
       <p>Your request <strong>${request.requestNumber}</strong> for ${request.days} day(s) on
          ${range(request)} was <strong>${verdict}</strong>.</p>
       ${comment ? `<p>Comment: ${comment}</p>` : ''}
       ${approved ? '<p>Your balance has been updated.</p>' : '<p>No days have been deducted from your balance.</p>'}`,
    ),
  });
};

export const sendAccountLockedEmail = ({ to, name, unlockAt }) =>
  sendMail({
    to,
    subject: 'Your HRMS account has been temporarily locked',
    text: `Hi ${name}, your account was locked after too many failed sign-in attempts. It unlocks at ${unlockAt}.`,
    html: layout(
      'Account temporarily locked',
      `<p>Hi ${name},</p>
       <p>We locked your account after ${env.auth.maxLoginAttempts} failed sign-in attempts. It unlocks automatically at <strong>${unlockAt}</strong>.</p>
       <p>If this wasn't you, reset your password once the lock expires.</p>`,
    ),
  });
