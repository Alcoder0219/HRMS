/**
 * Development seed: organization masters and one account per role.
 *
 * Idempotent -- re-running updates rather than duplicating, so it is safe to
 * call repeatedly while developing.
 *
 *   npm run seed
 *
 * Refuses to run against NODE_ENV=production. These are known credentials, and
 * creating them on a live system would be handing out administrator accounts.
 */
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import env from '../config/env.js';
import logger from '../config/logger.js';
import { hashPassword } from '../helpers/password.helper.js';
import { ROLES, ACCOUNT_STATUS } from '../utils/constants.js';
import { ensureSystemRoles } from '../services/admin/role.service.js';
import { loadRoleCache } from '../services/auth/roleCache.service.js';
import User from '../models/auth/user.model.js';
import Department from '../models/organization/department.model.js';
import Designation from '../models/organization/designation.model.js';
import Shift from '../models/organization/shift.model.js';
import Unit from '../models/organization/unit.model.js';
import Grade from '../models/organization/grade.model.js';
import SalaryTemplate from '../models/organization/salaryTemplate.model.js';
import AttendancePolicy from '../models/attendance/attendancePolicy.model.js';
import Holiday from '../models/attendance/holiday.model.js';

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'Hrms@2026!Seed';

const DEPARTMENTS = [
  { code: 'ENG', name: 'Engineering' },
  { code: 'HR', name: 'Human Resources' },
  { code: 'FIN', name: 'Finance' },
  { code: 'SAL', name: 'Sales' },
  { code: 'OPS', name: 'Operations' },
];

const DESIGNATIONS = [
  { code: 'SE', name: 'Software Engineer', level: 3 },
  { code: 'SSE', name: 'Senior Software Engineer', level: 5 },
  { code: 'EM', name: 'Engineering Manager', level: 7 },
  { code: 'HRBP', name: 'HR Business Partner', level: 5 },
  { code: 'ACC', name: 'Accountant', level: 4 },
  { code: 'SALEX', name: 'Sales Executive', level: 3 },
];

const SHIFTS = [
  { code: 'GEN', name: 'General', startTime: '09:30', endTime: '18:30' },
  { code: 'EARLY', name: 'Early', startTime: '07:00', endTime: '16:00' },
  { code: 'NIGHT', name: 'Night', startTime: '22:00', endTime: '06:00', isNightShift: true },
];

const UNITS = [
  { code: 'HO', name: 'Head Office', city: 'Dar es Salaam', state: 'Dar es Salaam' },
  { code: 'PLANT1', name: 'Plant 1', city: 'Kibaha', state: 'Pwani' },
  { code: 'ARU', name: 'Arusha Office', city: 'Arusha', state: 'Arusha' },
];

// Monthly gross bands, in TSH.
const GRADES = [
  { code: 'G1', name: 'Grade 1 - Entry', level: 1, minGross: 300000, maxGross: 700000 },
  { code: 'G2', name: 'Grade 2 - Junior', level: 2, minGross: 700000, maxGross: 1_200_000 },
  { code: 'G3', name: 'Grade 3 - Mid', level: 3, minGross: 1_200_000, maxGross: 2_500_000 },
  { code: 'G4', name: 'Grade 4 - Senior', level: 4, minGross: 2_500_000, maxGross: 5_000_000 },
  { code: 'G5', name: 'Grade 5 - Lead', level: 5, minGross: 5_000_000, maxGross: 10_000_000 },
];

// Every percentage is of BASIC; basic itself is solved for from the CTC.
const SALARY_TEMPLATES = [
  {
    code: 'STD',
    name: 'Standard Staff',
    description: 'Transport 10% and communication 5% of basic, one month annual leave',
    transportationPercent: 10,
    communicationPercent: 5,
    annualLeavePercent: 100,
    isDefault: true,
  },
  {
    code: 'EXPAT',
    name: 'Expatriate',
    description: 'Housing, schooling and mediclaim on top of the standard allowances',
    hraPercent: 40,
    transportationPercent: 10,
    communicationPercent: 5,
    annualLeavePercent: 100,
    mediclaimAmount: 250_000,
    schoolFeesAllowanceAmount: 500_000,
  },
  {
    code: 'CONTRACT',
    name: 'Contract / Consultant',
    description: 'Basic only, outside NSSF and NHIF',
    transportationPercent: 0,
    communicationPercent: 0,
    annualLeavePercent: 0,
    nssfApplicable: false,
    nhifApplicable: false,
  },
];

const upsert = async (Model, filter, document) =>
  Model.findOneAndUpdate(filter, { $set: document }, { upsert: true, new: true, setDefaultsOnInsert: true });

const run = async () => {
  if (env.isProduction) {
    throw new Error('Refusing to seed a production database');
  }

  await connectDatabase();

  // Roles must exist -- and the in-memory cache must be warm -- before any
  // User is created below: User.role now validates against the live role set
  // rather than a fixed enum.
  await ensureSystemRoles();
  await loadRoleCache();

  for (const department of DEPARTMENTS) {
    await upsert(Department, { tenantId: null, code: department.code }, department);
  }
  for (const designation of DESIGNATIONS) {
    await upsert(Designation, { tenantId: null, code: designation.code }, designation);
  }
  for (const shift of SHIFTS) {
    await upsert(Shift, { tenantId: null, code: shift.code }, shift);
  }

  // Masters backing the new Employee Master dropdowns.
  for (const unit of UNITS) {
    await upsert(Unit, { tenantId: null, code: unit.code }, unit);
  }
  for (const grade of GRADES) {
    await upsert(Grade, { tenantId: null, code: grade.code }, grade);
  }
  for (const template of SALARY_TEMPLATES) {
    await upsert(SalaryTemplate, { tenantId: null, code: template.code }, template);
  }

  /**
   * A default attendance policy. The rules engine falls back to its built-in
   * constants without one, but nothing tenant-specific -- geofencing,
   * regularization limits -- can be configured until this row exists.
   */
  await upsert(
    AttendancePolicy,
    { tenantId: null, departmentId: null },
    {
      name: 'Default attendance policy',
      isDefault: true,
      isActive: true,
      weeklyOffs: [0, 6],
      geofenceEnabled: false,
      regularizationWindowDays: 7,
      maxRegularizationsPerMonth: 3,
    },
  );

  const year = new Date().getFullYear();
  const holidays = [
    { name: 'New Year', month: 0, day: 1 },
    { name: 'Republic Day', month: 0, day: 26 },
    { name: 'Independence Day', month: 7, day: 15 },
    { name: 'Gandhi Jayanti', month: 9, day: 2 },
    { name: 'Christmas', month: 11, day: 25 },
  ];

  for (const holiday of holidays) {
    const date = new Date(year, holiday.month, holiday.day);
    await upsert(Holiday, { tenantId: null, date }, { name: holiday.name, date, year, type: 'PUBLIC' });
  }

  const password = await hashPassword(SEED_PASSWORD);
  const accounts = Object.values(ROLES).map((role) => ({
    email: `${role.toLowerCase().replace(/_/g, '.')}@hrms.local`,
    role,
    firstName: role
      .split('_')
      .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
      .join(' '),
    lastName: 'User',
  }));

  for (const account of accounts) {
    await upsert(
      User,
      { email: account.email },
      {
        ...account,
        password,
        status: ACCOUNT_STATUS.ACTIVE,
        isEmailVerified: true,
        emailVerifiedAt: new Date(),
      },
    );
  }

  logger.info('Seed complete', {
    departments: DEPARTMENTS.length,
    designations: DESIGNATIONS.length,
    shifts: SHIFTS.length,
    holidays: holidays.length,
    accounts: accounts.length,
  });

  console.log('\nSeeded accounts (password for all: %s)\n', SEED_PASSWORD);
  accounts.forEach(({ email, role }) => console.log(`  ${role.padEnd(14)} ${email}`));
  console.log('');

  await disconnectDatabase();
};

run().catch((error) => {
  logger.error('Seed failed', error);
  process.exitCode = 1;
});
