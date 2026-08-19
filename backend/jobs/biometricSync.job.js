import cron from 'node-cron';

import logger from '../config/logger.js';
import AppSettings from '../models/admin/appSettings.model.js';
import biometricSync from '../services/biometric/biometricSync.service.js';

/**
 * The scheduler that keeps attendance flowing without anybody pressing a button.
 *
 * Ticks every minute and asks a much cheaper question than "sync everything":
 * which devices are DUE? Each device carries its own interval, so a turnstile
 * on five minutes and a site terminal on an hour coexist without two schedules.
 *
 * The job owns no device logic. It decides what is due and hands each one to
 * `syncAttendanceLogs`; everything about sockets, protocols and punches lives
 * there.
 */

const EVERY_MINUTE = '* * * * *';

/**
 * Overlap guard.
 *
 * A sweep across several offline devices can take longer than a minute -- each
 * one has to reach its ten-second timeout -- and without this the next tick
 * would start a second sweep over the same devices, doubling the load on
 * exactly the terminals that are already struggling.
 */
let running = false;
let task = null;

/**
 * Whether enough time has passed since the last ATTEMPT.
 *
 * Deliberately not the last successful sync. An unreachable device fails after
 * a ten-second timeout, and keying this off `lastSyncAt` -- which a failure
 * leaves untouched -- would make a dead terminal due on every single tick,
 * burning ten seconds a minute forever and delaying every device behind it.
 *
 * `lastSyncAt` is the fallback for devices configured before the attempt field
 * existed, and a device that has never been touched at all is due immediately.
 */
const isDue = (device, now) => {
  const last = device.lastAttemptAt ?? device.lastSyncAt;
  if (!last) return true;

  const elapsedMinutes = (now.getTime() - new Date(last).getTime()) / 60_000;
  return elapsedMinutes >= (device.syncIntervalMinutes ?? 5);
};

/**
 * One sweep.
 *
 * Exported so it can be triggered directly -- by a test, or by an operator in a
 * console -- without waiting for the scheduler.
 */
export const runDueSyncs = async () => {
  if (running) {
    logger.debug('Biometric sync sweep still running; skipping this tick');
    return { skipped: true };
  }

  running = true;
  const now = new Date();
  const summary = { devices: 0, succeeded: 0, failed: 0, punchesSynced: 0 };

  try {
    /**
     * Only tenants that actually have a device to poll.
     *
     * `$elemMatch` so both conditions must hold on the SAME device -- without
     * it a tenant with one inactive auto-sync device and one active manual one
     * would match on the two halves separately and be loaded for nothing.
     */
    const tenants = await AppSettings.find({
      biometricDevices: { $elemMatch: { isActive: true, autoSync: true } },
    })
      // `+biometricDevices.password` is not optional here: a WDMS server has to
      // be logged into on every pull, and without the credential every
      // scheduled sync of one would fail on authentication while a manual sync
      // from the screen -- which does select it -- worked perfectly.
      .select('tenantId biometricDevices +biometricDevices.password')
      .lean();

    for (const settings of tenants) {
      const due = (settings.biometricDevices ?? []).filter(
        (device) => device.isActive && device.autoSync && isDue(device, now),
      );

      for (const device of due) {
        summary.devices += 1;

        /**
         * Sequential, and every device wrapped on its own.
         *
         * `syncAttendanceLogs` already returns rather than throws for a device
         * failure, but this catch is the backstop that matters: an unexpected
         * throw -- a socket library crashing, a Mongo hiccup -- must take down
         * one device's turn and nothing else. A scheduled job that dies on the
         * first bad terminal stops attendance for the whole organisation, and
         * does it silently.
         */
        try {
          const result = await biometricSync.syncAttendanceLogs(device, settings.tenantId ?? null);

          if (result.success) {
            summary.succeeded += 1;
            summary.punchesSynced += result.punchesSynced;
          } else {
            summary.failed += 1;
          }
        } catch (error) {
          summary.failed += 1;
          logger.error('Biometric sync threw outside its own handler', {
            device: device.name,
            deviceId: String(device._id),
            error: error.message,
          });
        }
      }
    }

    // Quiet when there is nothing to do: this runs 1,440 times a day, and an
    // info line per tick would bury everything else in the log.
    if (summary.devices > 0) {
      logger.info('Biometric sync sweep complete', summary);
    }

    return summary;
  } catch (error) {
    // Reaching here means the tenant query itself failed -- the database is
    // down or unreachable. Logged, swallowed, and retried on the next tick.
    logger.error('Biometric sync sweep failed', { error: error.message });
    return { ...summary, error: error.message };
  } finally {
    running = false;
  }
};

/**
 * Starts the scheduler. Called once, after the database is connected.
 *
 * Connecting first is not incidental: the first tick can land within a second
 * of boot, and a sweep against an unconnected Mongoose buffers its query until
 * the default timeout and then logs a failure that looks like a bug.
 */
export const startBiometricSyncJob = () => {
  if (task) return task;

  task = cron.schedule(EVERY_MINUTE, runDueSyncs, { name: 'biometric-sync' });

  logger.info('Biometric sync job scheduled', { schedule: EVERY_MINUTE });
  return task;
};

/** Stops the scheduler, so a graceful shutdown does not leave a timer behind. */
export const stopBiometricSyncJob = () => {
  if (!task) return;

  task.stop();
  task = null;
  logger.info('Biometric sync job stopped');
};

export default { startBiometricSyncJob, stopBiometricSyncJob, runDueSyncs };
