/**
 * Re-derives stored attendance overtime from the times already on file.
 *
 *   npm run recompute:overtime -- --dry-run
 *   npm run recompute:overtime -- --from=2026-08-01
 *   npm run recompute:overtime -- --employee=EMP00007
 *
 * Overtime is derived when a day is written, so days written before the
 * weekly-off rule recognised the roster still hold the figure that rule
 * produced -- a Sunday worked 09:48 to 17:35 sits at 00:00 until something
 * re-derives it. Re-saving the day through Edit Attendance does that for one
 * day; this does it for a month or a year.
 *
 * Deliberately narrow. It calls the same `recomputeOvertimeForEmployee` the
 * application uses, which touches `overtimeMinutes` and `expectedMinutes` and
 * nothing else: times, status, worked minutes, leave, payroll and every other
 * field are left exactly as they are. Nothing is recalculated from a shift, a
 * holiday calendar or a policy threshold.
 *
 * Idempotent -- a second run reports zero updated. Start with `--dry-run`.
 */
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import logger from '../config/logger.js';
import Employee from '../models/employee/employee.model.js';
import { recomputeOvertimeForEmployee } from '../services/attendance/overtimeRecompute.service.js';

const argument = (name) => {
  const match = process.argv.find((value) => value.startsWith(`--${name}=`));
  return match ? match.slice(name.length + 3) : null;
};

const run = async () => {
  const dryRun = process.argv.includes('--dry-run');
  const employeeCode = argument('employee');
  const fromRaw = argument('from');
  const from = fromRaw ? new Date(fromRaw) : null;

  if (from && Number.isNaN(from.getTime())) {
    throw new Error(`--from is not a date: ${fromRaw}`);
  }

  await connectDatabase();

  const filter = { deletedAt: null };
  if (employeeCode) filter.employeeCode = employeeCode.toUpperCase();

  // Only what the rule reads. `shiftId`, `departmentId` and `tenantId` are what
  // resolve the employee's weekly offs.
  const employees = await Employee.find(filter)
    .select('employeeCode tenantId departmentId shiftId overtimeEligible standardDutyMinutes')
    .lean();

  let scanned = 0;
  let updated = 0;
  const changedEmployees = [];

  for (const employee of employees) {
    const result = await recomputeOvertimeForEmployee(employee, { from, dryRun });

    scanned += result.scanned;
    updated += result.updated;
    if (result.updated) changedEmployees.push(`${employee.employeeCode} (${result.updated})`);
  }

  logger.info(dryRun ? 'Overtime recompute -- dry run, nothing written' : 'Overtime recompute completed', {
    employees: employees.length,
    daysScanned: scanned,
    daysChanged: updated,
    from: from ? from.toISOString().slice(0, 10) : 'all time',
    changed: changedEmployees.slice(0, 50),
  });

  await disconnectDatabase();
};

run().catch(async (error) => {
  logger.error('Overtime recompute failed', { error: error.message });
  await disconnectDatabase().catch(() => {});
  process.exitCode = 1;
});
