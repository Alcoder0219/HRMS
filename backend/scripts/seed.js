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
  { code: 'HO', name: 'Head Office', city: 'Pune', state: 'Maharashtra', ptState: 'Maharashtra', lwfState: 'Maharashtra' },
  { code: 'PLANT1', name: 'Plant 1', city: 'Chakan', state: 'Maharashtra', ptState: 'Maharashtra', lwfState: 'Maharashtra' },
  { code: 'BLR', name: 'Bengaluru Office', city: 'Bengaluru', state: 'Karnataka', ptState: 'Karnataka', lwfState: 'Karnataka' },
];

const GRADES = [
  { code: 'G1', name: 'Grade 1 - Entry', level: 1, minGross: 15000, maxGross: 30000 },
  { code: 'G2', name: 'Grade 2 - Junior', level: 2, minGross: 30000, maxGross: 55000 },
  { code: 'G3', name: 'Grade 3 - Mid', level: 3, minGross: 55000, maxGross: 90000 },
  { code: 'G4', name: 'Grade 4 - Senior', level: 4, minGross: 90000, maxGross: 150000 },
  { code: 'G5', name: 'Grade 5 - Lead', level: 5, minGross: 150000, maxGross: 300000 },
];

const SALARY_TEMPLATES = [
  {
    code: 'STD',
    name: 'Standard Staff',
    description: 'Basic 40% of gross, HRA 50% of basic',
    basicPercent: 40,
    hraPercentOfBasic: 50,
    conveyanceAmount: 1600,
    medicalAmount: 1250,
    isDefault: true,
  },
  {
    code: 'WORKMAN',
    name: 'Workman',
    description: 'Higher basic for statutory coverage',
    basicPercent: 60,
    hraPercentOfBasic: 40,
    conveyanceAmount: 1600,
    lwfApplicable: true,
  },
  {
    code: 'CONTRACT',
    name: 'Contract / Consultant',
    description: 'No statutory contributions',
    basicPercent: 100,
    hraPercentOfBasic: 0,
    pfApplicable: false,
    esiApplicable: false,
    professionalTaxApplicable: false,
  },
];

const upsert = async (Model, filter, document) =>
  Model.findOneAndUpdate(filter, { $set: document }, { upsert: true, new: true, setDefaultsOnInsert: true });

const run = async () => {
  if (env.isProduction) {
    throw new Error('Refusing to seed a production database');
  }

  await connectDatabase();

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
