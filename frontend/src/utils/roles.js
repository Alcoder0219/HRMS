/**
 * Role identifiers, mirroring backend/utils/constants.js.
 *
 * Only the names and display metadata are duplicated -- never the permission
 * matrix. The server sends each user their resolved permission list, so there
 * is one set of rules and the client cannot drift from it.
 */
export const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  COMPANY_ADMIN: 'COMPANY_ADMIN',
  HR: 'HR',
  PAYROLL: 'PAYROLL',
  ACCOUNTS: 'ACCOUNTS',
  HOD: 'HOD',
  MANAGER: 'MANAGER',
  SECURITY: 'SECURITY',
  AUDITOR: 'AUDITOR',
  EMPLOYEE: 'EMPLOYEE',
};

export const ROLE_RANK = {
  [ROLES.SUPER_ADMIN]: 100,
  [ROLES.COMPANY_ADMIN]: 90,
  [ROLES.HR]: 70,
  [ROLES.PAYROLL]: 65,
  [ROLES.ACCOUNTS]: 60,
  [ROLES.HOD]: 50,
  [ROLES.MANAGER]: 40,
  [ROLES.AUDITOR]: 30,
  [ROLES.SECURITY]: 20,
  [ROLES.EMPLOYEE]: 10,
};

export const ROLE_LABELS = {
  [ROLES.SUPER_ADMIN]: 'Super Admin',
  [ROLES.COMPANY_ADMIN]: 'Company Admin',
  [ROLES.HR]: 'HR',
  [ROLES.PAYROLL]: 'Payroll',
  [ROLES.ACCOUNTS]: 'Accounts',
  [ROLES.HOD]: 'Head of Department',
  [ROLES.MANAGER]: 'Manager',
  [ROLES.SECURITY]: 'Security',
  [ROLES.AUDITOR]: 'Auditor',
  [ROLES.EMPLOYEE]: 'Employee',
};

export const SCOPES = {
  SELF: 'SELF',
  TEAM: 'TEAM',
  DEPARTMENT: 'DEPARTMENT',
  TENANT: 'TENANT',
  GLOBAL: 'GLOBAL',
};

export const SCOPE_LABELS = {
  [SCOPES.SELF]: 'Own records',
  [SCOPES.TEAM]: 'Direct team',
  [SCOPES.DEPARTMENT]: 'Department',
  [SCOPES.TENANT]: 'Whole organisation',
  [SCOPES.GLOBAL]: 'All organisations',
};
