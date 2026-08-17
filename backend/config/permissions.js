import { ROLES, ACTIONS, RESOURCES, SCOPES, WILDCARD } from '../utils/constants.js';

const { READ, CREATE, UPDATE, DELETE, APPROVE, REJECT, EXPORT, PRINT, DASHBOARD } = ACTIONS;

/* ----------------------------------------------------------- action sets */

const FULL = [READ, CREATE, UPDATE, DELETE, APPROVE, REJECT, EXPORT, PRINT, DASHBOARD];
const MANAGE = [READ, CREATE, UPDATE, DELETE, EXPORT, PRINT, DASHBOARD];
const REVIEW = [READ, APPROVE, REJECT, EXPORT, PRINT, DASHBOARD];
const VIEW = [READ, EXPORT, PRINT, DASHBOARD];
const VIEW_ONLY = [READ];
const SELF_SERVICE = [READ, CREATE];

/**
 * The authorisation matrix: role -> resource -> permitted actions.
 *
 * Static and in code on purpose. Authorisation rules are a security boundary,
 * and keeping them in a reviewable, diffable, deployable file means a change
 * goes through code review rather than a database write. Per-tenant custom
 * roles, when they arrive, layer ON TOP of this baseline -- they never widen a
 * role beyond what is granted here.
 *
 * `scope` answers "over whose records" and is enforced separately from the
 * action check. Both must pass.
 */
export const PERMISSION_MATRIX = {
  /* -------------------------------------------------------- platform ---- */

  [ROLES.SUPER_ADMIN]: {
    scope: SCOPES.GLOBAL,
    description: 'Platform operator. Unrestricted across every tenant.',
    permissions: { [WILDCARD]: [WILDCARD] },
  },

  [ROLES.COMPANY_ADMIN]: {
    scope: SCOPES.TENANT,
    description: 'Owns one customer organisation and everything inside it.',
    permissions: {
      [RESOURCES.DASHBOARD]: [READ, DASHBOARD],
      [RESOURCES.TENANT]: [READ, UPDATE, EXPORT, PRINT, DASHBOARD],
      [RESOURCES.USER]: FULL,
      [RESOURCES.ROLE]: [READ, UPDATE, DASHBOARD],
      [RESOURCES.EMPLOYEE]: FULL,
      [RESOURCES.ORGANIZATION]: FULL,
      [RESOURCES.ATTENDANCE]: FULL,
      [RESOURCES.LEAVE]: FULL,
      [RESOURCES.PAYROLL]: FULL,
      [RESOURCES.RECRUITMENT]: FULL,
      [RESOURCES.PERFORMANCE]: FULL,
      [RESOURCES.DOCUMENT]: FULL,
      [RESOURCES.NOTIFICATION]: MANAGE,
      [RESOURCES.REPORT]: VIEW,
      // Read-only by design: an audit trail an administrator can edit is not
      // an audit trail.
      [RESOURCES.AUDIT]: VIEW,
    },
  },

  /* ------------------------------------------------------- people ops ---- */

  [ROLES.HR]: {
    scope: SCOPES.TENANT,
    description: 'People operations across the organisation.',
    permissions: {
      [RESOURCES.DASHBOARD]: [READ, DASHBOARD],
      [RESOURCES.USER]: [READ, CREATE, UPDATE, EXPORT, DASHBOARD],
      [RESOURCES.EMPLOYEE]: FULL,
      [RESOURCES.ORGANIZATION]: MANAGE,
      [RESOURCES.ATTENDANCE]: FULL,
      [RESOURCES.LEAVE]: FULL,
      // Deliberately not FULL. HR needs visibility into payroll outcomes for
      // people questions, but authoring and approving a pay run belongs to
      // PAYROLL -- separation of duties over salary data.
      [RESOURCES.PAYROLL]: VIEW,
      [RESOURCES.RECRUITMENT]: FULL,
      [RESOURCES.PERFORMANCE]: FULL,
      [RESOURCES.DOCUMENT]: FULL,
      [RESOURCES.NOTIFICATION]: MANAGE,
      [RESOURCES.REPORT]: VIEW,
      [RESOURCES.AUDIT]: VIEW_ONLY,
    },
  },

  /* ---------------------------------------------------------- finance ---- */

  [ROLES.PAYROLL]: {
    scope: SCOPES.TENANT,
    description: 'Prepares, approves and publishes pay runs.',
    permissions: {
      [RESOURCES.DASHBOARD]: [READ, DASHBOARD],
      [RESOURCES.PAYROLL]: FULL,
      // Read access to the inputs a pay run consumes, and nothing more.
      [RESOURCES.EMPLOYEE]: VIEW,
      [RESOURCES.ATTENDANCE]: VIEW,
      [RESOURCES.LEAVE]: VIEW,
      [RESOURCES.ORGANIZATION]: VIEW_ONLY,
      [RESOURCES.DOCUMENT]: VIEW,
      [RESOURCES.NOTIFICATION]: VIEW_ONLY,
      [RESOURCES.REPORT]: VIEW,
    },
  },

  [ROLES.ACCOUNTS]: {
    scope: SCOPES.TENANT,
    description: 'Consumes payroll output for the ledger. Cannot author a pay run.',
    permissions: {
      [RESOURCES.DASHBOARD]: [READ, DASHBOARD],
      [RESOURCES.PAYROLL]: VIEW,
      [RESOURCES.EMPLOYEE]: VIEW_ONLY,
      [RESOURCES.ORGANIZATION]: VIEW_ONLY,
      [RESOURCES.DOCUMENT]: VIEW,
      [RESOURCES.NOTIFICATION]: VIEW_ONLY,
      [RESOURCES.REPORT]: VIEW,
    },
  },

  /* ------------------------------------------------------------- line ---- */

  [ROLES.HOD]: {
    scope: SCOPES.DEPARTMENT,
    description: 'Heads a department; approves within it.',
    permissions: {
      [RESOURCES.DASHBOARD]: [READ, DASHBOARD],
      [RESOURCES.EMPLOYEE]: VIEW,
      [RESOURCES.ORGANIZATION]: VIEW,
      [RESOURCES.ATTENDANCE]: REVIEW,
      [RESOURCES.LEAVE]: REVIEW,
      [RESOURCES.RECRUITMENT]: REVIEW,
      [RESOURCES.PERFORMANCE]: [READ, CREATE, UPDATE, APPROVE, REJECT, EXPORT, PRINT, DASHBOARD],
      [RESOURCES.DOCUMENT]: VIEW,
      [RESOURCES.NOTIFICATION]: VIEW_ONLY,
      [RESOURCES.REPORT]: VIEW,
    },
  },

  [ROLES.MANAGER]: {
    scope: SCOPES.TEAM,
    description: 'Line manager of direct reports.',
    permissions: {
      [RESOURCES.DASHBOARD]: [READ, DASHBOARD],
      [RESOURCES.EMPLOYEE]: VIEW_ONLY,
      [RESOURCES.ORGANIZATION]: VIEW_ONLY,
      [RESOURCES.ATTENDANCE]: [READ, APPROVE, REJECT, EXPORT, DASHBOARD],
      [RESOURCES.LEAVE]: [READ, APPROVE, REJECT, EXPORT, DASHBOARD],
      [RESOURCES.PERFORMANCE]: [READ, CREATE, UPDATE, EXPORT, DASHBOARD],
      [RESOURCES.DOCUMENT]: VIEW_ONLY,
      [RESOURCES.NOTIFICATION]: VIEW_ONLY,
      [RESOURCES.REPORT]: [READ, EXPORT, DASHBOARD],
    },
  },

  /* ----------------------------------------------------------- special ---- */

  [ROLES.SECURITY]: {
    scope: SCOPES.TENANT,
    description: 'Gate desk. Records physical attendance; sees no HR data.',
    permissions: {
      [RESOURCES.DASHBOARD]: [READ, DASHBOARD],
      [RESOURCES.ATTENDANCE]: [READ, CREATE, EXPORT, PRINT, DASHBOARD],
      // Enough to identify someone at the gate. Nothing about their pay,
      // performance or leave.
      [RESOURCES.EMPLOYEE]: VIEW_ONLY,
      [RESOURCES.NOTIFICATION]: VIEW_ONLY,
    },
  },

  [ROLES.AUDITOR]: {
    scope: SCOPES.TENANT,
    description: 'Compliance review. Reads and exports everything, writes nothing.',
    permissions: {
      [RESOURCES.DASHBOARD]: [READ, DASHBOARD],
      [RESOURCES.TENANT]: VIEW,
      [RESOURCES.USER]: VIEW,
      [RESOURCES.ROLE]: VIEW_ONLY,
      [RESOURCES.EMPLOYEE]: VIEW,
      [RESOURCES.ORGANIZATION]: VIEW,
      [RESOURCES.ATTENDANCE]: VIEW,
      [RESOURCES.LEAVE]: VIEW,
      [RESOURCES.PAYROLL]: VIEW,
      [RESOURCES.RECRUITMENT]: VIEW,
      [RESOURCES.PERFORMANCE]: VIEW,
      [RESOURCES.DOCUMENT]: VIEW,
      [RESOURCES.REPORT]: VIEW,
      [RESOURCES.AUDIT]: VIEW,
    },
  },

  /* ------------------------------------------------------ self service ---- */

  [ROLES.EMPLOYEE]: {
    scope: SCOPES.SELF,
    description: 'Self-service. Every grant below is scoped to their own records.',
    permissions: {
      [RESOURCES.DASHBOARD]: [READ, DASHBOARD],
      [RESOURCES.EMPLOYEE]: [READ, UPDATE],
      [RESOURCES.ATTENDANCE]: SELF_SERVICE,
      // DELETE is for withdrawing a request that has not been actioned yet;
      // the SELF scope is what stops it touching anyone else's.
      [RESOURCES.LEAVE]: [READ, CREATE, DELETE],
      [RESOURCES.PAYROLL]: [READ, PRINT],
      [RESOURCES.PERFORMANCE]: [READ, UPDATE],
      [RESOURCES.DOCUMENT]: [READ, CREATE, PRINT],
      [RESOURCES.NOTIFICATION]: [READ, UPDATE],
      [RESOURCES.ORGANIZATION]: VIEW_ONLY,
    },
  },
};

/**
 * Resources whose scope is always SELF regardless of role -- a personal inbox
 * stays personal even for a COMPANY_ADMIN.
 */
export const ALWAYS_SELF_SCOPED = [RESOURCES.NOTIFICATION];

export default PERMISSION_MATRIX;
