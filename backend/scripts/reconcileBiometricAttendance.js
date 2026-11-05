/**
 * Brings stored biometric punches of mapped employees into attendance.
 *
 *   TZ=Asia/Kolkata npm run reconcile:biometric -- --timezone=Asia/Kolkata                                (preview)
 *   TZ=Asia/Kolkata npm run reconcile:biometric -- --timezone=Asia/Kolkata --apply --backup=<new file>    (write)
 *
 * It recovers two kinds of punch, for device user IDs mapped today:
 *
 *   waiting    UNMAPPED, FAILED or PENDING events, as Import pending punches does
 *   orphaned   IMPORTED events whose employee record no longer exists, so their
 *              attendance rows belong to nobody and appear on no screen
 *
 * What it does not do. It re-imports nothing from a device and rewrites no
 * event's punch time. It deletes nothing: the attendance rows of a missing
 * employee stay exactly where they are. Punches go through the same path as any
 * other (`reprocessEvents`), so a day that was corrected by hand, regularized or
 * locked is HELD and left as it is, a punch already on a day is not added
 * twice, and a second run finds nothing to do. Punches of an employee who still
 * exists are never moved, even if the ID now maps to somebody else.
 *
 * Days are keyed in the server's zone, so this must run in that zone: --timezone
 * must name the zone TZ is set to and the zone the stored day keys were written
 * in. --apply first writes the events it will change and the attendance days
 * they touch to --backup, which is the record to undo from.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import mongoose from 'mongoose';

import env from '../config/env.js';
// Side-effect import: this runs outside the app, and the attendance path
// populates schemas (Department, ...) that only the app's boot would register.
import '../models/index.js';
import { attributeShiftDay, startOfDay } from '../helpers/attendanceRules.helper.js';
import Attendance from '../models/attendance/attendance.model.js';
import BiometricEvent from '../models/attendance/biometricEvent.model.js';
import AppSettings from '../models/admin/appSettings.model.js';
import Employee from '../models/employee/employee.model.js';
import Shift from '../models/organization/shift.model.js';
import { holdReason } from '../services/attendance/attendanceIngest.service.js';
import { reprocessEvents, reprocessFilter, systemContext } from '../services/biometric/biometricEvent.service.js';

const SELECTION = { includeOrphaned: true };

/** Stops an apply that has stopped progressing, rather than looping on it. */
const MAX_RUNS = 50;

const devicesOf = (settings) => (settings.biometricDevices ?? []).filter((device) => device.userMappings?.length);

/**
 * What an apply would do for one device, per employee. Writes nothing.
 */
export const previewDevice = async ({ tenantId, device }) => {
  const filter = await reprocessFilter({ tenantId, device, ...SELECTION });
  const events = await BiometricEvent.find(filter).sort({ punchTime: 1 }).lean();

  const codeOf = new Map(device.userMappings.map((entry) => [String(entry.deviceUserId), entry.employeeCode]));
  const employees = await Employee.find({ tenantId: tenantId ?? null, employeeCode: { $in: [...codeOf.values()] }, deletedAt: null }).lean();
  const employeeOf = new Map(employees.map((employee) => [employee.employeeCode, employee]));
  const shifts = new Map(
    (await Shift.find({ _id: { $in: employees.map((employee) => employee.shiftId).filter(Boolean) } }).lean()).map((shift) => [String(shift._id), shift]),
  );

  const acceptFrom = device.acceptPunchesFrom ? new Date(device.acceptPunchesFrom) : null;
  const rows = new Map();

  const rowFor = (code) => {
    if (!rows.has(code)) {
      rows.set(code, { employeeCode: code, waiting: 0, orphaned: 0, newDays: new Set(), existingDays: new Set(), heldDays: new Set(), beforeAcceptFrom: 0, noEmployee: 0, first: null, last: null });
    }
    return rows.get(code);
  };

  const days = new Map();

  for (const event of events) {
    const code = codeOf.get(event.deviceUserId);
    const row = rowFor(code);
    const employee = employeeOf.get(code);

    if (event.status === 'IMPORTED') row.orphaned += 1;
    else row.waiting += 1;

    if (!employee) {
      row.noEmployee += 1;
      continue;
    }
    if (acceptFrom && event.punchTime < acceptFrom) {
      row.beforeAcceptFrom += 1;
      continue;
    }

    row.first = row.first && row.first < event.punchTime ? row.first : event.punchTime;
    row.last = row.last && row.last > event.punchTime ? row.last : event.punchTime;

    const day = attributeShiftDay(new Date(event.punchTime), shifts.get(String(employee.shiftId ?? '')));
    const key = `${employee._id}|${day.getTime()}`;

    if (!days.has(key)) {
      days.set(key, await Attendance.findOne({ employeeId: employee._id, date: startOfDay(day) }).lean());
    }

    const existing = days.get(key);
    const label = day.getTime();
    if (holdReason(existing, { allowCorrectedDays: false })) row.heldDays.add(label);
    else if (existing) row.existingDays.add(label);
    else row.newDays.add(label);
  }

  return [...rows.values()].map(({ newDays, existingDays, heldDays, ...row }) => ({
    ...row,
    newDays: newDays.size,
    existingDays: existingDays.size,
    heldDays: heldDays.size,
  }));
};

/**
 * Applies one device until nothing it can act on remains. Idempotent: what has
 * been handled leaves the selection, so a repeat finds nothing.
 */
export const applyDevice = async ({ tenantId, device }) => {
  const totals = { examined: 0, imported: 0, held: 0, failed: 0, daysUpdated: 0, stillUnmapped: 0 };
  const req = systemContext(tenantId);

  for (let run = 0; run < MAX_RUNS; run += 1) {
    const result = await reprocessEvents({ tenantId, device, ...SELECTION, req });

    totals.examined += result.received;
    totals.imported += result.imported;
    totals.held += result.held;
    totals.failed += result.failed;
    totals.daysUpdated += result.daysUpdated;
    totals.stillUnmapped = result.unmapped;

    if (!result.limited) break;
  }

  return totals;
};

/** Everything an undo would need, written before the first change. */
export const backupDevice = async ({ tenantId, device }) => {
  const filter = await reprocessFilter({ tenantId, device, ...SELECTION });
  const events = await BiometricEvent.find(filter).lean();

  const codes = device.userMappings.map((entry) => entry.employeeCode);
  const employees = await Employee.find({ tenantId: tenantId ?? null, employeeCode: { $in: codes } }).select('_id').lean();
  const attendance = await Attendance.find({ employeeId: { $in: employees.map((employee) => employee._id) } }).lean();

  return { tenantId: tenantId ?? null, deviceId: device._id, events, attendance };
};

/* ---------------------------------------------------------------- command */

const argument = (name) => (process.argv.find((value) => value.startsWith(`--${name}=`)) ?? '').slice(name.length + 3);

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const apply = process.argv.includes('--apply');
  const wanted = argument('timezone');
  const backupPath = argument('backup');
  const actual = Intl.DateTimeFormat().resolvedOptions().timeZone;

  try {
    if (!wanted) throw new Error('Pass --timezone=<the zone the backend runs in>, e.g. --timezone=Asia/Kolkata');

    const canonical = new Intl.DateTimeFormat('en-US', { timeZone: wanted }).resolvedOptions().timeZone;
    if (canonical !== actual) throw new Error(`This process runs in ${actual}, not ${wanted}. Set TZ=${wanted} for this command.`);

    if (apply && !backupPath) throw new Error('--apply needs --backup=<path to a new file>');
    if (apply && fs.existsSync(backupPath)) throw new Error(`Refusing to overwrite an existing backup: ${backupPath}`);

    // Not the app's connection: outside production that builds indexes, and a
    // preview run from a laptop must not write anything to the database.
    await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 10_000, autoIndex: false, autoCreate: false });

    const tenants = await AppSettings.find({ 'biometricDevices.0': { $exists: true } }).select('tenantId biometricDevices').lean();

    // Days are stored at local midnight, so a stored key shows the zone it was
    // written in. Running in any other zone would file punches on new keys.
    const sample = await Attendance.findOne().sort({ date: -1 }).select('date').lean();
    if (sample && startOfDay(sample.date).getTime() !== sample.date.getTime()) {
      throw new Error(`Stored attendance days were not written in ${actual}. Run this in the zone the backend runs in.`);
    }

    const backup = [];
    const report = [];

    for (const settings of tenants) {
      for (const device of devicesOf(settings)) {
        const context = { tenantId: settings.tenantId ?? null, device };
        const entry = { device: device.name, preview: await previewDevice(context) };
        report.push(entry);

        if (apply) backup.push(await backupDevice(context));
      }
    }

    if (apply) {
      fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2), { flag: 'wx' });

      for (const settings of tenants) {
        for (const device of devicesOf(settings)) {
          report.find((entry) => entry.device === device.name).applied = await applyDevice({ tenantId: settings.tenantId ?? null, device });
        }
      }
    }

    console.log(JSON.stringify({ timezone: actual, applied: apply, backup: apply ? backupPath : null, report }, null, 2));

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error(`Reconciliation failed: ${error.message}`);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }
}
