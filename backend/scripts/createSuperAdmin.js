/**
 * One-time creation of the first SUPER_ADMIN.
 *
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='...' npm run create:superadmin
 *
 * Why this exists: a fresh database has no accounts, and none of the three
 * ways an account is normally created can make the first one.
 *
 *   - POST /auth/register hardcodes ROLES.EMPLOYEE and never reads a role from
 *     the request body, precisely so nobody can self-promote.
 *   - The admin user API requires an authenticated caller who already holds
 *     the privilege being granted -- the chicken and egg this script breaks.
 *   - `npm run seed` refuses to run when NODE_ENV=production, correctly: it
 *     creates one account per role with a password published in the source.
 *
 * SAFE TO RUN IN PRODUCTION, and safe to run twice. It invents no credential:
 * the password comes from the environment, is checked against the application's
 * own strength policy, is hashed with the same helper the login path verifies
 * against, and is never logged.
 *
 * It creates nothing else. No tenant, no employee record, no demo data.
 */
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { hashPassword, checkPasswordStrength } from '../helpers/password.helper.js';
import { ROLES, ACCOUNT_STATUS } from '../utils/constants.js';
import User from '../models/auth/user.model.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Bare console, not the winston logger: this is an operator tool talking to
 *  a terminal, and its output should not be shipped to Cloud Logging. */
const say = (message) => console.log(message);
const fail = (message) => {
  console.error(`\n  FAILED: ${message}\n`);
  process.exitCode = 1;
};

const run = async () => {
  const email = String(process.env.ADMIN_EMAIL ?? '').toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD ?? '';
  const firstName = (process.env.ADMIN_FIRST_NAME ?? 'Super').trim();
  const lastName = (process.env.ADMIN_LAST_NAME ?? 'Admin').trim();

  /**
   * A second SUPER_ADMIN is a deliberate act, not a default. Without this
   * guard a re-run -- a retried Cloud Run job, a repeated command -- would
   * quietly multiply the most privileged account in the system.
   */
  const allowAdditional = process.env.ALLOW_ADDITIONAL_SUPER_ADMIN === 'true';

  /**
   * The operator running this chose the password themselves, so they are not
   * being handed someone else's secret and there is nothing to rotate on first
   * use. Set true to force a change at first sign-in anyway -- worth doing if
   * the password was typed on a shared terminal or passed through a CI log.
   */
  const mustChangePassword = process.env.ADMIN_MUST_CHANGE_PASSWORD === 'true';

  /* ------------------------------------------------------------- inputs -- */

  if (!email || !password) {
    return fail('ADMIN_EMAIL and ADMIN_PASSWORD must both be set in the environment.');
  }

  if (!EMAIL_PATTERN.test(email)) {
    return fail(`ADMIN_EMAIL is not a valid email address: ${email}`);
  }

  /**
   * The same policy the change-password and reset flows enforce, imported
   * rather than restated -- a bootstrap account must not be the one credential
   * in the system that sidesteps the rules.
   */
  const weaknesses = checkPasswordStrength(password);
  if (weaknesses.length) {
    console.error('\n  FAILED: ADMIN_PASSWORD does not meet the password policy:');
    weaknesses.forEach((reason) => console.error(`    - ${reason}`));
    console.error('');
    process.exitCode = 1;
    return;
  }

  /* ---------------------------------------------------------- database -- */

  await connectDatabase();
  say(`\n  Connected to ${mongoose.connection.name}\n`);

  const existingSuperAdmin = await User.findOne({ role: ROLES.SUPER_ADMIN })
    .select('email status createdAt')
    .lean();

  if (existingSuperAdmin && !allowAdditional) {
    say('  A SUPER_ADMIN already exists -- nothing to do.');
    say(`    email   ${existingSuperAdmin.email}`);
    say(`    status  ${existingSuperAdmin.status}`);
    say(`    created ${new Date(existingSuperAdmin.createdAt).toISOString()}`);
    say('\n  Forgotten the password? Use the password-reset flow, or set');
    say('  ALLOW_ADDITIONAL_SUPER_ADMIN=true to add a second administrator.\n');
    return;
  }

  /**
   * Checked by email alone, with no tenant filter, because that is exactly how
   * the login lookup works: `findByEmailWithPassword` only narrows by tenant
   * when one is supplied. An account sharing this address would shadow the new
   * one at sign-in, so refuse rather than create something unreachable.
   */
  const emailTaken = await User.findOne({ email }).select('email role').lean();
  if (emailTaken) {
    return fail(
      `${email} already has an account with the role ${emailTaken.role}. ` +
        'Choose another address, or promote that account instead of creating a second one.',
    );
  }

  /* ------------------------------------------------------------ create -- */

  const user = await User.create({
    // SUPER_ADMIN operates above tenants; the schema documents null as the
    // correct value for exactly this case.
    tenantId: null,
    email,
    // Hashed with the application's own helper, at the configured cost, so the
    // login path's comparePassword verifies it without any special casing.
    password: await hashPassword(password),
    firstName,
    lastName,
    role: ROLES.SUPER_ADMIN,
    // ACTIVE and verified, together: `canLogin()` rejects an unverified
    // account whenever REQUIRE_EMAIL_VERIFICATION is on, which it is by
    // default. A bootstrap admin with no mail server configured could never
    // get past that, so verification is satisfied here rather than bypassed
    // in the login path.
    status: ACCOUNT_STATUS.ACTIVE,
    isEmailVerified: true,
    emailVerifiedAt: new Date(),
    mustChangePassword,
    createdBy: null,
  });

  say('  SUPER_ADMIN created.');
  say(`    id      ${user._id}`);
  say(`    email   ${user.email}`);
  say(`    role    ${user.role}`);
  say(`    status  ${user.status}`);
  say(`    password: stored as a bcrypt hash (${user.password.slice(0, 4)}..., ${user.password.length} chars)`);
  if (mustChangePassword) {
    say('\n  A password change is required at first sign-in.');
  }
  say('\n  Sign in at POST /api/v1/auth/login with that email and the password');
  say('  you supplied. This script never printed or stored it in plain text.\n');
};

run()
  .catch((error) => {
    // The message only; a stack here can carry the connection string, and this
    // output may end up in a build or job log.
    fail(error.message);
  })
  .finally(async () => {
    await disconnectDatabase().catch(() => {});
  });
