import os from 'node:os';
import app from './app.js';
import env from './config/env.js';
import logger from './config/logger.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { ensureSystemRoles } from './services/admin/role.service.js';
import { loadRoleCache } from './services/auth/roleCache.service.js';

let server;

/**
 * Every non-internal IPv4 address this machine answers on.
 *
 * Printed at boot so nobody has to run `ipconfig` to find out which address to
 * give the rest of the office -- and so a machine with several interfaces
 * (Wi-Fi and Ethernet both up) shows all of them.
 */
const lanAddresses = () =>
  Object.values(os.networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address);

const start = async () => {
  // Connect before listening: a server that accepts traffic without a database
  // just converts every request into a 500.
  await connectDatabase();

  /**
   * Roles moved from a static import to the `Role` collection. `ensureSystemRoles`
   * fills in the ten built-in roles on a fresh database without ever touching
   * one that already exists (see its own comment), and `loadRoleCache` must run
   * before `app.listen` -- every permission check reads the cache
   * synchronously, so the very first request needs it already warm.
   */
  await ensureSystemRoles();
  await loadRoleCache();

  // Let the mailer read SMTP settings configured in Administration, falling
  // back to the environment. Wired here rather than imported inside the mailer
  // so the helper stays usable in scripts and tests that never boot a server.
  const { default: settingsService } = await import('./services/admin/settings.service.js');
  const { useMailConfigResolver } = await import('./helpers/mailer.helper.js');
  useMailConfigResolver(() => settingsService.resolveMailConfig(null));

  /**
   * Poll the biometric terminals on their own schedules.
   *
   * After `connectDatabase`, deliberately: the first tick can land within a
   * second, and a sweep against an unconnected Mongoose would buffer its query
   * until the driver's timeout and then log a failure that reads like a bug.
   */
  const { startBiometricSyncJob } = await import('./jobs/biometricSync.job.js');
  startBiometricSyncJob();

  /**
   * The ADMS receiver's configuration, checked once at boot.
   *
   * A mistyped zone name would otherwise surface as every pushed punch being
   * rejected; failing here names the variable instead.
   */
  if (env.biometricTimeZone) {
    const { assertTimeZone } = await import('./helpers/adms.helper.js');
    try {
      assertTimeZone(env.biometricTimeZone);
    } catch {
      throw new Error(`[config] BIOMETRIC_DEVICE_TIMEZONE is not a valid IANA time zone: ${env.biometricTimeZone}`);
    }
  }

  if (env.adms.enabled) {
    const { admsSecurityMode } = await import('./middlewares/admsGuard.js');
    const { default: BiometricEvent } = await import('./models/attendance/biometricEvent.model.js');

    /**
     * Checked, not created: production runs with autoIndex off and index builds
     * are an operator's decision (npm run migrate:biometric). Without this one,
     * concurrent retries of the same punch can store it twice, so its absence
     * is loud rather than silent.
     */
    const indexes = await BiometricEvent.collection.indexes().catch(() => []);
    if (!indexes.some((index) => index.key?.dedupKey === 1 && index.unique)) {
      logger.error('biometricevents.dedupKey unique index is missing -- run `npm run migrate:biometric`');
    }

    const mode = admsSecurityMode();
    const log = mode === 'MISCONFIGURED' ? logger.error.bind(logger) : logger.info.bind(logger);
    log(`ADMS receiver enabled at /iclock (security: ${mode})`, {
      deviceTimeZone: env.biometricTimeZone ?? 'server local',
      pollDelaySeconds: env.adms.pollDelaySeconds,
    });
  }

  // Binding to env.host (0.0.0.0 by default) is what accepts connections from
  // other machines. Omitting the argument binds to every interface too, but
  // making it explicit means it can be locked down to one interface in
  // production without a code change.
  server = app.listen(env.port, env.host, () => {
    const addresses = lanAddresses();

    logger.info(`HRMS API listening on ${env.host}:${env.port}`, {
      environment: env.nodeEnv,
      apiPrefix: env.apiPrefix,
      network: addresses.map((address) => `http://${address}:${env.port}`),
    });

    console.log(`\n  HRMS API  ${env.nodeEnv}`);
    console.log(`  Local     http://localhost:${env.port}${env.apiPrefix}`);
    addresses.forEach((address) =>
      console.log(`  Network   http://${address}:${env.port}${env.apiPrefix}`),
    );
    console.log('');
  });
};

/**
 * Graceful shutdown: stop accepting connections, let in-flight requests finish,
 * then close MongoDB. Without this, a rolling deploy can abort a payroll write
 * midway through.
 */
const shutdown = async (signal) => {
  logger.info(`${signal} received, shutting down`);

  const forceExit = setTimeout(() => {
    logger.error('Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, 15_000).unref();

  try {
    // Before the server closes: a sweep that starts during shutdown would open
    // sockets to devices and then query a database that is about to go away.
    const { stopBiometricSyncJob } = await import('./jobs/biometricSync.job.js');
    stopBiometricSyncJob();

    if (server) await new Promise((resolve) => server.close(resolve));
    await disconnectDatabase();
    clearTimeout(forceExit);
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', error);
    process.exit(1);
  }
};

['SIGTERM', 'SIGINT'].forEach((signal) => process.on(signal, () => shutdown(signal)));

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', reason);
  shutdown('unhandledRejection');
});

process.on('uncaughtException', (error) => {
  // The process state is undefined after this point, so it is logged and the
  // process is replaced rather than kept alive.
  logger.error('Uncaught exception', error);
  shutdown('uncaughtException');
});

start().catch((error) => {
  logger.error('Failed to start server', error);
  process.exit(1);
});
