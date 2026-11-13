/**
 * READ-ONLY report of unit assignments, for review before and after unit data
 * isolation is switched on. Writes nothing, ever.
 *
 *   npm run audit:units
 *
 * Lists, for administrative correction:
 *   - unit-restricted accounts that will see NO unit data (no unit, no linked
 *     employee with a unit) -- they lose access to every unit screen
 *   - accounts whose own unit list disagrees with their linked employee's unit
 *   - accounts holding several units in a role that may hold only one
 *   - employees with no unit, or a unit that does not exist or is inactive
 *   - employees linked from more than one account, or whose `userId` points at
 *     a different account than the one linking to them
 *
 * Emails are masked in the output. Nothing is assigned automatically.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';

import '../models/index.js';
import { MULTI_UNIT_ROLES, UNIT_UNRESTRICTED_ROLES } from '../utils/constants.js';

const id = (value) => (value ? String(value._id ?? value) : null);
const mask = (email = '') => email.replace(/^(.{2}).*(@.*)$/, '$1***$2');

export const auditUnitAssignments = async () => {
  const db = mongoose.connection.db;

  const units = await db.collection('units').find({}).toArray();
  const unitById = new Map(units.map((unit) => [id(unit._id), unit]));
  const unitName = (unitId) => unitById.get(id(unitId))?.code ?? `missing:${id(unitId)}`;

  const employees = await db
    .collection('employees')
    .find({ deletedAt: null })
    .project({ employeeCode: 1, unitId: 1, userId: 1, status: 1 })
    .toArray();
  const employeeById = new Map(employees.map((employee) => [id(employee._id), employee]));

  const users = await db
    .collection('users')
    .find({})
    .project({ email: 1, role: 1, status: 1, employeeId: 1, unitIds: 1 })
    .toArray();

  const report = { units: [], accounts: [], noUnitAccess: [], conflicts: [], employees: [], links: [] };

  report.units = units.map((unit) => ({
    code: unit.code,
    name: unit.name,
    active: unit.isActive !== false,
    employees: employees.filter((employee) => id(employee.unitId) === id(unit._id)).length,
  }));

  for (const user of users) {
    const label = `${user.role} ${user.status} ${mask(user.email)}`;
    const employee = user.employeeId ? employeeById.get(id(user.employeeId)) : null;
    const own = (user.unitIds ?? []).map(id);
    const unrestricted = UNIT_UNRESTRICTED_ROLES.includes(user.role);

    const effective = unrestricted
      ? 'ALL UNITS'
      : own.length
        ? own.map(unitName).join(', ')
        : employee?.unitId
          ? `${unitName(employee.unitId)} (from ${employee.employeeCode})`
          : 'NONE';

    report.accounts.push({ account: label, reach: effective });
    if (unrestricted) continue;

    if (effective === 'NONE') {
      report.noUnitAccess.push(
        `${label}: ${user.employeeId ? (employee ? `employee ${employee.employeeCode} has no unit` : 'linked employee missing or deleted') : 'no unit and no linked employee'}`,
      );
    }
    if (own.length && employee?.unitId && !own.includes(id(employee.unitId))) {
      report.conflicts.push(`${label}: account units ${own.map(unitName).join(', ')} do not include employee ${employee.employeeCode}'s unit ${unitName(employee.unitId)}`);
    }
    if (own.length > 1 && !MULTI_UNIT_ROLES.includes(user.role)) {
      report.conflicts.push(`${label}: holds ${own.length} units but a ${user.role} may hold one`);
    }
    own.filter((unitId) => !unitById.has(unitId)).forEach((unitId) => report.conflicts.push(`${label}: assigned unit ${unitId} does not exist`));
    if (employee?.userId && id(employee.userId) !== id(user._id)) {
      report.links.push(`${label}: employee ${employee.employeeCode}.userId points at a different account`);
    }
  }

  for (const employee of employees) {
    if (!employee.unitId) report.employees.push(`${employee.employeeCode} (${employee.status}): no unit`);
    else if (!unitById.has(id(employee.unitId))) report.employees.push(`${employee.employeeCode}: unit ${id(employee.unitId)} does not exist`);
    else if (unitById.get(id(employee.unitId)).isActive === false) report.employees.push(`${employee.employeeCode}: unit ${unitName(employee.unitId)} is inactive`);
  }

  const linkCounts = new Map();
  users.filter((user) => user.employeeId).forEach((user) => linkCounts.set(id(user.employeeId), (linkCounts.get(id(user.employeeId)) ?? 0) + 1));
  linkCounts.forEach((count, employeeId) => {
    if (count > 1) report.links.push(`employee ${employeeById.get(employeeId)?.employeeCode ?? employeeId}: linked from ${count} accounts`);
  });

  return report;
};

const runningDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (runningDirectly) {
  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000, autoIndex: false, autoCreate: false });
    const report = await auditUnitAssignments();
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error('Unit audit failed:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}
