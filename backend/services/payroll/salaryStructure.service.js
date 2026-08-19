import logger from '../../config/logger.js';
import ApiError from '../../utils/ApiError.js';
import { AUDIT_ACTIONS, RESOURCES } from '../../utils/constants.js';
import { buildScopeFilter } from '../../helpers/permission.helper.js';
import payrollRepository from '../../repositories/payroll/payroll.repository.js';
import employeeRepository from '../../repositories/employee/employee.repository.js';
import { deriveStructureFromCtc } from '../../helpers/salaryCalculator.helper.js';
import { structureGross } from '../../models/payroll/salaryStructure.model.js';
import { roundToCurrency } from '../../helpers/statutory.helper.js';
import { recordAudit, diffObjects } from '../../helpers/audit.helper.js';

const ENTITY = 'SalaryStructure';

/**
 * Salary structures are versioned, never edited.
 *
 * A revision creates a new effective-dated row and closes the previous one.
 * Editing in place would silently re-price every payslip already issued
 * against the old figures -- the defect an auditor looks for first.
 */

const assertComponentsMatchCtc = (payload) => {
  // Through the same helper the structure's own gross virtual uses, so adding
  // an earning column cannot leave this check silently ignoring it.
  const components = structureGross(payload);

  const monthlyCtc = roundToCurrency(payload.monthlyCtc ?? Number(payload.annualCtc || 0) / 12);

  // A shilling of slack absorbs rounding across the components; more than that
  // is a data-entry error that would quietly under- or over-pay every month.
  if (Math.abs(roundToCurrency(components) - monthlyCtc) > 1) {
    throw ApiError.unprocessable('Salary components do not add up to the monthly CTC', [
      {
        field: 'components',
        message: `Components total ${roundToCurrency(components)} but monthly CTC is ${monthlyCtc}`,
      },
    ]);
  }

  return monthlyCtc;
};

export const previewFromCtc = (annualCtc, options) => deriveStructureFromCtc(annualCtc, options);

export const createStructure = async (payload, req) => {
  const employee = await employeeRepository.findById(payload.employeeId, { populate: false });
  if (!employee) throw ApiError.notFound('Employee not found');

  const callerTenant = req.user.tenantId ?? null;
  const recordTenant = employee.tenantId ? String(employee.tenantId) : null;
  if (callerTenant !== null && recordTenant !== callerTenant) {
    throw ApiError.notFound('Employee not found');
  }

  const effectiveFrom = new Date(payload.effectiveFrom);
  const monthlyCtc = assertComponentsMatchCtc(payload);

  const existing = await payrollRepository.findStructureOn(employee._id, effectiveFrom);
  if (existing && new Date(existing.effectiveFrom).getTime() === effectiveFrom.getTime()) {
    throw ApiError.conflict('A structure already exists with this effective date');
  }

  await payrollRepository.closePreviousStructure(employee._id, effectiveFrom);

  const structure = await payrollRepository.createStructure({
    ...payload,
    tenantId: employee.tenantId ?? null,
    employeeId: employee._id,
    effectiveFrom,
    monthlyCtc,
    createdBy: req.user.id,
    updatedBy: req.user.id,
  });

  await recordAudit({
    req,
    entity: ENTITY,
    entityId: structure._id,
    entityLabel: `${employee.employeeCode} from ${effectiveFrom.toISOString().slice(0, 10)}`,
    action: existing ? AUDIT_ACTIONS.UPDATE : AUDIT_ACTIONS.CREATE,
    changes: diffObjects(
      existing
        ? {
            basic: existing.basic,
            hraAllowance: existing.hraAllowance,
            transportationAllowance: existing.transportationAllowance,
            annualCtc: existing.annualCtc,
          }
        : {},
      {
        basic: structure.basic,
        hraAllowance: structure.hraAllowance,
        transportationAllowance: structure.transportationAllowance,
        annualCtc: structure.annualCtc,
      },
    ),
    metadata: { revisionReason: payload.revisionReason ?? null },
  });

  logger.info('Salary structure created', {
    employeeId: String(employee._id),
    effectiveFrom,
    annualCtc: structure.annualCtc,
  });

  return structure;
};

/**
 * A salary structure is the most sensitive record about a person.
 *
 * A SELF-scoped caller may read only their own; anything wider is decided by
 * the RBAC scope, exactly as payslips are. Without this, any authenticated
 * user holding `payroll:read` -- which every employee does, so they can see
 * their own payslip -- could read anyone's pay.
 */
const assertMayReadStructure = (employeeId, req) => {
  const scope = buildScopeFilter(req, { ownerField: '_id', resource: RESOURCES.PAYROLL });

  if (scope._id !== undefined && String(scope._id) !== String(employeeId)) {
    throw ApiError.forbidden('You can only view your own salary structure');
  }
};

export const getCurrentStructure = async (employeeId, req, date = new Date()) => {
  assertMayReadStructure(employeeId, req);

  const structure = await payrollRepository.findStructureOn(employeeId, date);
  if (!structure) throw ApiError.notFound('No salary structure is in force for this employee');
  return structure;
};

export const getStructureHistory = (employeeId, req) => {
  assertMayReadStructure(employeeId, req);
  return payrollRepository.findStructureHistory(employeeId);
};

export default { createStructure, getCurrentStructure, getStructureHistory, previewFromCtc };
