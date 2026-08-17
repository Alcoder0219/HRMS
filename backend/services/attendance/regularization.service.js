import logger from '../../config/logger.js';
import ApiError from '../../utils/ApiError.js';
import {
  ATTENDANCE_SOURCE,
  AUDIT_ACTIONS,
  REGULARIZATION_STATUS,
  RESOURCES,
} from '../../utils/constants.js';
import { buildPagination, buildSort, buildFilters, dateRange } from '../../utils/queryBuilder.js';
import Regularization from '../../models/attendance/regularization.model.js';
import Employee from '../../models/employee/employee.model.js';
import attendanceRepository from '../../repositories/attendance/attendance.repository.js';
import employeeRepository from '../../repositories/employee/employee.repository.js';
import { startOfDay } from '../../helpers/attendanceRules.helper.js';
import { recordAudit } from '../../helpers/audit.helper.js';
import { buildScopeFilter } from '../../helpers/permission.helper.js';
import { recomputeDay } from './attendance.service.js';

const ENTITY = 'Regularization';

export const SORTABLE_FIELDS = ['date', 'status', 'createdAt', 'decidedAt'];

const POPULATE = [
  { path: 'employeeId', select: 'employeeCode employeeId firstName lastName departmentId' },
  { path: 'approverId', select: 'employeeCode employeeId firstName lastName' },
];

const resolveEmployee = async (req, employeeId = null) => {
  const id = employeeId ?? req.user.employeeId;
  if (!id) throw ApiError.badRequest('Your login is not linked to an employee record');

  const employee = await employeeRepository.findById(id);
  if (!employee) throw ApiError.notFound('Employee not found');
  return employee;
};

/* -------------------------------------------------------------------------- */
/*                                   Request                                  */
/* -------------------------------------------------------------------------- */

/**
 * Raises a correction request for one day.
 *
 * The window and monthly cap are policy, not code: an organisation that closes
 * its month on the 7th cannot accept a correction on the 20th, because payroll
 * has already run on the figure.
 */
export const requestRegularization = async (payload, req) => {
  const employee = await resolveEmployee(req, payload.employeeId);
  const day = startOfDay(payload.date);

  const policy = await attendanceRepository.resolvePolicy(
    employee.tenantId ?? null,
    employee.departmentId?._id ?? employee.departmentId ?? null,
  );

  if (policy && !policy.regularizationEnabled) {
    throw ApiError.badRequest('Regularization is disabled for your organisation');
  }

  if (day > startOfDay(new Date())) {
    throw ApiError.badRequest('You cannot regularize a future date');
  }

  const windowDays = policy?.regularizationWindowDays ?? 7;
  const ageDays = Math.floor((startOfDay(new Date()) - day) / 86_400_000);
  if (ageDays > windowDays) {
    throw ApiError.badRequest(
      `Regularization is only allowed within ${windowDays} days. This date is ${ageDays} days old — ask HR to correct it.`,
    );
  }

  const existing = await attendanceRepository.findByEmployeeAndDate(employee._id, day);
  if (existing?.isLocked) {
    throw ApiError.badRequest('This attendance period is locked and cannot be changed');
  }

  const pending = await Regularization.findOne({
    employeeId: employee._id,
    date: day,
    status: REGULARIZATION_STATUS.PENDING,
  });
  if (pending) throw ApiError.conflict('A request for this date is already awaiting approval');

  /* --- monthly cap ------------------------------------------------------- */
  const cap = policy?.maxRegularizationsPerMonth ?? 3;
  if (cap > 0) {
    const monthStart = new Date(day.getFullYear(), day.getMonth(), 1);
    const monthEnd = new Date(day.getFullYear(), day.getMonth() + 1, 0);

    const used = await Regularization.countDocuments({
      employeeId: employee._id,
      date: { $gte: monthStart, $lte: monthEnd },
      status: { $in: [REGULARIZATION_STATUS.PENDING, REGULARIZATION_STATUS.APPROVED] },
    });

    if (used >= cap) {
      throw ApiError.badRequest(
        `You have used all ${cap} regularizations allowed this month`,
      );
    }
  }

  const request = await Regularization.create({
    tenantId: employee.tenantId ?? null,
    employeeId: employee._id,
    attendanceId: existing?._id ?? null,
    date: day,
    type: payload.type,
    requestedCheckIn: payload.requestedCheckIn ? new Date(payload.requestedCheckIn) : null,
    requestedCheckOut: payload.requestedCheckOut ? new Date(payload.requestedCheckOut) : null,
    requestedStatus: payload.requestedStatus ?? null,
    reason: payload.reason,
    // Captured now: by approval time the record may already have been
    // recomputed, and the original machine reading would be unrecoverable.
    originalSnapshot: existing
      ? {
          checkInAt: existing.checkInAt,
          checkOutAt: existing.checkOutAt,
          status: existing.status,
          workedMinutes: existing.workedMinutes,
          lateMinutes: existing.lateMinutes,
        }
      : null,
    approverId: employee.reportingManagerId?._id ?? employee.reportingManagerId ?? null,
    requestedBy: req.user.id,
  });

  await recordAudit({
    req,
    entity: ENTITY,
    entityId: request._id,
    entityLabel: `${employee.employeeCode} ${day.toISOString().slice(0, 10)}`,
    action: AUDIT_ACTIONS.CREATE,
    metadata: { type: payload.type, date: day },
  });

  logger.info('Regularization requested', {
    employeeId: String(employee._id),
    date: day,
    type: payload.type,
  });

  return Regularization.findById(request._id).populate(POPULATE);
};

/* -------------------------------------------------------------------------- */
/*                                  Decision                                  */
/* -------------------------------------------------------------------------- */

/**
 * Approve or reject.
 *
 * Approval writes the requested times onto the attendance day as MANUAL
 * punches and recomputes, so an approved correction flows through the same
 * rules engine as a real punch -- lateness and overtime are recalculated
 * rather than assumed.
 */
export const decideRegularization = async (id, { decision, comment }, req) => {
  const request = await Regularization.findById(id);
  if (!request) throw ApiError.notFound('Request not found');

  const callerTenant = req.user.tenantId ?? null;
  if (callerTenant !== null && String(request.tenantId) !== callerTenant) {
    throw ApiError.notFound('Request not found');
  }

  if (request.status !== REGULARIZATION_STATUS.PENDING) {
    throw ApiError.badRequest(`This request has already been ${request.status.toLowerCase()}`);
  }

  // Nobody approves their own correction, whatever their role.
  if (req.user.employeeId && String(request.employeeId) === String(req.user.employeeId)) {
    throw ApiError.forbidden('You cannot approve your own regularization request');
  }

  const approved = decision === REGULARIZATION_STATUS.APPROVED;

  request.status = approved ? REGULARIZATION_STATUS.APPROVED : REGULARIZATION_STATUS.REJECTED;
  request.decidedBy = req.user.id;
  request.decidedAt = new Date();
  request.decisionComment = comment ?? null;

  if (approved) {
    const employee = await employeeRepository.findById(request.employeeId);
    if (!employee) throw ApiError.notFound('Employee record not found');

    const record = await attendanceRepository.findByEmployeeAndDate(employee._id, request.date);
    if (record?.isLocked) {
      throw ApiError.badRequest('This attendance period is locked and cannot be changed');
    }

    /**
     * A regularization states only the side that was wrong. The other side
     * keeps whatever was already recorded -- writing just the corrected punch
     * would replace the array and delete the genuine one, turning "I forgot to
     * punch out" into a day with no check-in at all.
     */
    const effectiveCheckIn = request.requestedCheckIn ?? record?.checkInAt ?? null;
    const effectiveCheckOut = request.requestedCheckOut ?? record?.checkOutAt ?? null;

    const punches = [];
    if (effectiveCheckIn) {
      punches.push({
        time: effectiveCheckIn,
        source: request.requestedCheckIn ? ATTENDANCE_SOURCE.MANUAL : (record?.source ?? ATTENDANCE_SOURCE.MANUAL),
        direction: 'IN',
        recordedBy: req.user.id,
        note: request.requestedCheckIn ? 'Regularized' : 'Retained from original record',
      });
    }
    if (effectiveCheckOut) {
      punches.push({
        time: effectiveCheckOut,
        source: request.requestedCheckOut ? ATTENDANCE_SOURCE.MANUAL : (record?.source ?? ATTENDANCE_SOURCE.MANUAL),
        direction: 'OUT',
        recordedBy: req.user.id,
        note: request.requestedCheckOut ? 'Regularized' : 'Retained from original record',
      });
    }

    await attendanceRepository.upsertDay(employee._id, request.date, {
      set: {
        tenantId: employee.tenantId ?? null,
        ...(punches.length ? { punches } : {}),
        overrideStatus: request.requestedStatus ?? null,
        isRegularized: true,
        regularizationId: request._id,
        remarks: `Regularized: ${request.reason}`,
        updatedBy: req.user.id,
      },
      setOnInsert: { markedBy: req.user.id },
    });

    const updated = await recomputeDay(employee, request.date, {
      req,
      source: ATTENDANCE_SOURCE.MANUAL,
    });

    request.attendanceId = updated._id;
    request.appliedAt = new Date();
  }

  await request.save();

  await recordAudit({
    req,
    entity: ENTITY,
    entityId: request._id,
    action: AUDIT_ACTIONS.STATUS_CHANGE,
    changes: [{ field: 'status', from: REGULARIZATION_STATUS.PENDING, to: request.status }],
    metadata: { comment: comment ?? null },
  });

  logger.info('Regularization decided', { id: String(request._id), decision: request.status });

  return Regularization.findById(request._id).populate(POPULATE);
};

/** Withdrawal by the requester, allowed only while still pending. */
export const cancelRegularization = async (id, req) => {
  const request = await Regularization.findById(id);
  if (!request) throw ApiError.notFound('Request not found');

  if (String(request.employeeId) !== String(req.user.employeeId)) {
    throw ApiError.forbidden('You can only cancel your own requests');
  }

  if (request.status !== REGULARIZATION_STATUS.PENDING) {
    throw ApiError.badRequest('Only a pending request can be cancelled');
  }

  request.status = REGULARIZATION_STATUS.CANCELLED;
  request.decidedAt = new Date();
  await request.save();

  return request;
};

/* -------------------------------------------------------------------------- */
/*                                    Reads                                   */
/* -------------------------------------------------------------------------- */

const FILTER_DEFINITIONS = {
  status: (value) => ({ status: Array.isArray(value) ? { $in: value } : value }),
  type: (value) => ({ type: value }),
  employeeId: (value) => ({ employeeId: employeeRepository.toObjectId(value) }),
  from: (value, params) => {
    const range = dateRange(value, params.to ?? value);
    return range ? { date: range } : null;
  },
  to: () => null,
};

export const listRegularizations = async (query, req) => {
  const { page, limit, skip } = buildPagination(query);
  const sort = buildSort(query, SORTABLE_FIELDS, { createdAt: -1 });

  const filter = { tenantId: req.user.tenantId ?? null, ...buildFilters(query, FILTER_DEFINITIONS) };

  if (query.mine) {
    filter.employeeId = req.user.employeeId ?? null;
  } else {
    // The approval inbox is scope-limited the same way the register is: a
    // manager sees their team's requests, HR sees the tenant's.
    const scope = buildScopeFilter(req, {
      ownerField: '_id',
      managerField: 'reportingManagerId',
      departmentField: 'departmentId',
      resource: RESOURCES.ATTENDANCE,
    });

    if (scope._id !== undefined || scope.reportingManagerId !== undefined || scope.departmentId !== undefined) {
      const employees = await Employee.find({ ...scope, deletedAt: null }).select('_id').lean();
      filter.employeeId = { $in: employees.map((employee) => employee._id) };
    }
  }

  const [items, total] = await Promise.all([
    Regularization.find(filter).sort(sort).skip(skip).limit(limit).populate(POPULATE).lean(),
    Regularization.countDocuments(filter),
  ]);

  return { items, total, page, limit };
};

export const getPendingCount = async (req) => {
  const filter = { tenantId: req.user.tenantId ?? null, status: REGULARIZATION_STATUS.PENDING };

  const scope = buildScopeFilter(req, {
    ownerField: '_id',
    managerField: 'reportingManagerId',
    departmentField: 'departmentId',
    resource: RESOURCES.ATTENDANCE,
  });

  if (scope._id !== undefined || scope.reportingManagerId !== undefined || scope.departmentId !== undefined) {
    const employees = await Employee.find({ ...scope, deletedAt: null }).select('_id').lean();
    filter.employeeId = { $in: employees.map((employee) => employee._id) };
  }

  return { pending: await Regularization.countDocuments(filter) };
};

export default {
  requestRegularization,
  decideRegularization,
  cancelRegularization,
  listRegularizations,
  getPendingCount,
  SORTABLE_FIELDS,
};
