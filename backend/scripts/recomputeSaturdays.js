/**
 * Regrades stored Saturdays -- or, with --every-day, any stored day -- with the
 * current attendance rules.
 *
 *   TZ=Asia/Kolkata npm run recompute:saturdays -- --timezone=Asia/Kolkata                               (preview)
 *   TZ=Asia/Kolkata npm run recompute:saturdays -- --timezone=Asia/Kolkata --apply --backup=<new file>   (write)
 *   TZ=Asia/Kolkata npm run recompute:days -- --timezone=Asia/Kolkata [--from=2026-11-01] [--to=...]   (every day)
 *
 * Saving a shift's day-wise schedule changes how FUTURE days are graded; days
 * already stored keep the answer they were given. --every-day is how those are
 * brought into line, with the same protections and the same preview first.
 *
 * A day is graded when its punches arrive and stored; screens and payroll read
 * the stored result. Saturdays graded before the Saturday rule existed keep the
 * old answer until something regrades them, which is what this does -- through
 * `recomputeDay`, the same path a new punch takes, so nothing is graded twice
 * or differently.
 *
 * Only days the rules engine owns. A day corrected by hand, regularized,
 * locked, or with a status an administrator set is left exactly as it is, and
 * so is any day in a month that already has a payroll run. Only days whose
 * STATUS would change are touched, and --apply first writes their current
 * state to --backup.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import mongoose from 'mongoose';

import env from '../config/env.js';
import '../models/index.js';
import { evaluateDay, startOfDay } from '../helpers/attendanceRules.helper.js';
import { ATTENDANCE_SOURCE, ATTENDANCE_STATUS } from '../utils/constants.js';
import Attendance from '../models/attendance/attendance.model.js';
import Employee from '../models/employee/employee.model.js';
import { loadDayContext, recomputeDay } from '../services/attendance/attendance.service.js';

const COMPARED = ['status', 'workedMinutes', 'expectedMinutes', 'lateMinutes', 'earlyGoingMinutes', 'overtimeMinutes'];

const monthKey = (date) => `${date.getFullYear()}-${date.getMonth() + 1}`;

/** Why a stored day is not this command's to regrade, or null. */
export const protectedReason = (record) => {
  if (record.isLocked) return 'locked';
  if (record.isRegularized) return 'regularized';
  if (record.source === ATTENDANCE_SOURCE.MANUAL) return 'corrected by hand';
  if (record.overrideStatus) return 'status set by an administrator';
  if (record.status === ATTENDANCE_STATUS.ON_LEAVE) return 'on leave';
  return null;
};

/**
 * Every stored Saturday whose result the current rules would change. Writes
 * nothing.
 */
export const previewSaturdays = async ({ from = null, to = null, allowPayrollMonths = [], everyDay = false } = {}) => {
  const filter = {};
  if (from || to) {
    filter.date = {};
    if (from) filter.date.$gte = startOfDay(new Date(from));
    if (to) filter.date.$lte = startOfDay(new Date(to));
  }

  const records = (await Attendance.find(filter).lean()).filter(
    (record) => everyDay || startOfDay(record.date).getDay() === 6,
  );

  const employees = new Map(
    (await Employee.find({ _id: { $in: [...new Set(records.map((record) => String(record.employeeId)))] }, deletedAt: null }).lean()).map(
      (employee) => [String(employee._id), employee],
    ),
  );

  // A month with a run is left alone unless it is named, on purpose, with
  // --allow-payroll-month: regrading it is a payroll decision, not a repair.
  const allowed = new Set(allowPayrollMonths);
  const paidMonths = new Set(
    (await mongoose.connection.db.collection('payrollruns').find({}).project({ year: 1, month: 1 }).toArray())
      .map((run) => `${run.year}-${run.month}`)
      .filter((key) => !allowed.has(key)),
  );

  const changes = [];
  const skipped = {};
  const skip = (reason) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1;
  };

  for (const record of records) {
    const employee = employees.get(String(record.employeeId));
    if (!employee) {
      skip('employee no longer exists');
      continue;
    }

    const reason = protectedReason(record);
    if (reason) {
      skip(reason);
      continue;
    }
    if (paidMonths.has(monthKey(startOfDay(record.date)))) {
      skip('month already has a payroll run');
      continue;
    }

    const context = await loadDayContext(employee, record.date);
    const evaluation = evaluateDay({
      date: context.day,
      punches: record.punches ?? [],
      shift: context.shift,
      policy: context.policy,
      holiday: context.holiday,
      isWeeklyOff: context.isWeeklyOff,
    });
    if (!employee.overtimeEligible) evaluation.overtimeMinutes = 0;

    // Only a day whose STATUS the rules now read differently. Its other figures
    // move with it and are shown, but a day that stays H or stays P is left as
    // it is rather than regraded for a figure nobody asked to change.
    if (record.status === evaluation.status) continue;

    changes.push({
      record,
      employee,
      employeeCode: employee.employeeCode,
      shiftCode: context.shift?.code ?? null,
      day: startOfDay(record.date),
      from: Object.fromEntries(COMPARED.map((field) => [field, record[field] ?? 0])),
      to: Object.fromEntries(COMPARED.map((field) => [field, evaluation[field] ?? 0])),
    });
  }

  return { examined: records.length, changes, skipped };
};

/** Regrades exactly the previewed days through `recomputeDay`. */
export const applySaturdays = async (changes) => {
  let updated = 0;
  for (const { employee, day } of changes) {
    // eslint-disable-next-line no-await-in-loop -- one day at a time, the way punches arrive
    await recomputeDay(employee, day, {});
    updated += 1;
  }
  return updated;
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
    // preview from a laptop must not write anything.
    await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 10_000, autoIndex: false, autoCreate: false });

    const sample = await Attendance.findOne().sort({ date: -1 }).select('date').lean();
    if (sample && startOfDay(sample.date).getTime() !== sample.date.getTime()) {
      throw new Error(`Stored attendance days were not written in ${actual}. Run this in the zone the backend runs in.`);
    }

    // --allow-payroll-month=2026-10 (repeatable): regrade a month that has a
    // payroll run, after someone has checked the run can take it.
    const allowPayrollMonths = process.argv
      .filter((value) => value.startsWith('--allow-payroll-month='))
      .map((value) => value.split('=')[1].split('-').map(Number).join('-'));

    const { examined, changes, skipped } = await previewSaturdays({
      from: argument('from') || null,
      to: argument('to') || null,
      allowPayrollMonths,
      everyDay: process.argv.includes('--every-day'),
    });

    const statusMoves = changes.reduce((counts, change) => {
      const key = `${change.from.status} -> ${change.to.status}`;
      return { ...counts, [key]: (counts[key] ?? 0) + 1 };
    }, {});

    let updated = 0;
    if (apply && changes.length) {
      fs.writeFileSync(backupPath, JSON.stringify(changes.map((change) => change.record), null, 2), { flag: 'wx' });
      updated = await applySaturdays(changes);
    }

    console.log(
      JSON.stringify(
        {
          timezone: actual,
          applied: apply,
          backup: apply && changes.length ? backupPath : null,
          saturdaysExamined: examined,
          wouldChange: changes.length,
          statusMoves,
          skipped,
          updated,
          days: changes.map(({ employeeCode, shiftCode, day, from, to }) => ({ employeeCode, shift: shiftCode, day: day.toDateString(), from, to })),
        },
        null,
        2,
      ),
    );

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error(`Saturday recompute failed: ${error.message}`);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }
}
