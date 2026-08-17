import mongoose from 'mongoose';

import LeaveType from '../../models/leave/leaveType.model.js';
import LeaveBalance, { deriveAvailable } from '../../models/leave/leaveBalance.model.js';
import LeaveRequest from '../../models/leave/leaveRequest.model.js';
import Employee from '../../models/employee/employee.model.js';
import Attendance from '../../models/attendance/attendance.model.js';

import ApiError from '../../utils/ApiError.js';
import {
  AUDIT_ACTIONS,
  LEAVE_STATUS,
  LEAVE_STATUS_TRANSITIONS,
  LEAVE_LEDGER_ACTIONS,
  ATTENDANCE_STATUS,
  ATTENDANCE_SOURCE,
  RESOURCES,
} from '../../utils/constants.js';
import { buildPagination, buildSort, buildSearch } from '../../utils/queryBuilder.js';
import { buildScopeFilter } from '../../helpers/permission.helper.js';
import { recordAudit, diffObjects } from '../../helpers/audit.helper.js';
import attendanceRepository from '../../repositories/attendance/attendance.repository.js';
import {
  expandLeaveDays,
  countLeaveDays,
  accruedEntitlement,
  carryForwardable,
  encashableDays,
  validateRequest,
  startOfDay,
} from '../../helpers/leaveCalculator.helper.js';
import { sendLeaveDecisionEmail, sendLeaveRequestEmail } from '../../helpers/mailer.helper.js';

/**
 * Leave: types, balances, requests and their approval.
 *
 * Deliberately reuses the attendance module rather than restating it. Weekly
 * offs come from the shift or the attendance policy and holidays from the
 * holiday calendar, so a day that attendance treats as non-working is a day
 * leave does not charge for. Two independent definitions of "working day" would
 * disagree the first time either changed.
 */

const tenantOf = (req) => req.user?.tenantId ?? null;

/* -------------------------------------------------------------------------- */
/*                                 Leave types                                */
/* -------------------------------------------------------------------------- */

const TYPE_SORTABLE = ['name', 'code', 'daysPerYear', 'isActive', 'createdAt'];

export const listTypes = async (query, req) => {
  const { page, limit, skip } = buildPagination(query);
  const filter = { tenantId: tenantOf(req) };

  if (query.status === 'active') filter.isActive = true;
  if (query.status === 'inactive') filter.isActive = false;

  Object.assign(filter, buildSearch(query.search, ['name', 'code']));

  const sort = buildSort({ sortBy: query.sortBy, sortOrder: query.sortOrder }, TYPE_SORTABLE, { name: 1 });

  const [items, total] = await Promise.all([
    LeaveType.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    LeaveType.countDocuments(filter),
  ]);

  return { items, total, page, limit };
};

export const getType = async (id, req) => {
  const type = await LeaveType.findOne({ _id: id, tenantId: tenantOf(req) }).lean();
  if (!type) throw ApiError.notFound('Leave type not found');

  // How many people currently hold a balance against it -- the question asked
  // before anyone tries to delete one.
  const inUse = await LeaveBalance.countDocuments({ leaveTypeId: id });
  const requests = await LeaveRequest.countDocuments({ leaveTypeId: id });

  return { ...type, usage: { balances: inUse, requests } };
};

const assertCodeFree = async (tenantId, code, excludeId = null) => {
  if (!code) return;

  const clash = await LeaveType.findOne({
    tenantId,
    code,
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  })
    .select('name')
    .lean();

  if (clash) throw ApiError.conflict(`Code "${code}" is already used by ${clash.name}`);
};

export const createType = async (payload, req) => {
  const tenantId = tenantOf(req);
  await assertCodeFree(tenantId, payload.code);

  const type = await LeaveType.create({ ...payload, tenantId, createdBy: req.user.id });

  await recordAudit({
    req,
    entity: 'LeaveType',
    entityId: type._id,
    entityLabel: type.name,
    action: AUDIT_ACTIONS.CREATE,
    changes: diffObjects({}, type.toObject({ depopulate: true })),
  });

  return type.toObject();
};

export const updateType = async (id, payload, req) => {
  const existing = await LeaveType.findOne({ _id: id, tenantId: tenantOf(req) });
  if (!existing) throw ApiError.notFound('Leave type not found');

  if (payload.code && payload.code !== existing.code) {
    await assertCodeFree(tenantOf(req), payload.code, id);
  }

  const before = existing.toObject({ depopulate: true });
  Object.assign(existing, payload, { updatedBy: req.user.id });
  await existing.save();

  const changes = diffObjects(before, existing.toObject({ depopulate: true }));

  if (changes.length) {
    await recordAudit({
      req,
      entity: 'LeaveType',
      entityId: existing._id,
      entityLabel: existing.name,
      action: AUDIT_ACTIONS.UPDATE,
      changes,
    });
  }

  return existing.toObject();
};

export const setTypeStatus = async (id, isActive, req) => {
  const type = await LeaveType.findOneAndUpdate(
    { _id: id, tenantId: tenantOf(req) },
    { $set: { isActive, updatedBy: req.user.id } },
    { new: true },
  );

  if (!type) throw ApiError.notFound('Leave type not found');

  await recordAudit({
    req,
    entity: 'LeaveType',
    entityId: type._id,
    entityLabel: type.name,
    action: AUDIT_ACTIONS.STATUS_CHANGE,
    changes: [{ field: 'isActive', from: String(!isActive), to: String(isActive) }],
  });

  return type.toObject();
};

/**
 * Removes a type only when nothing points at it.
 *
 * A balance or a request holding a type id that resolves to nothing is the same
 * orphan state the data cleanup had to repair. Deactivating keeps the history
 * readable and stops the type being offered, which is what "delete" means here.
 */
export const deleteType = async (id, req) => {
  const type = await LeaveType.findOne({ _id: id, tenantId: tenantOf(req) });
  if (!type) throw ApiError.notFound('Leave type not found');

  const [balances, requests] = await Promise.all([
    LeaveBalance.countDocuments({ leaveTypeId: id }),
    LeaveRequest.countDocuments({ leaveTypeId: id }),
  ]);

  if (balances > 0 || requests > 0) {
    const detail = [
      balances ? `${balances} balance${balances === 1 ? '' : 's'}` : null,
      requests ? `${requests} request${requests === 1 ? '' : 's'}` : null,
    ]
      .filter(Boolean)
      .join(' and ');

    throw ApiError.conflict(`${type.name} is still used by ${detail}. Deactivate it instead.`);
  }

  await LeaveType.deleteOne({ _id: id });

  await recordAudit({
    req,
    entity: 'LeaveType',
    entityId: type._id,
    entityLabel: type.name,
    action: AUDIT_ACTIONS.DELETE,
  });

  return { deleted: true, name: type.name };
};

/* -------------------------------------------------------------------------- */
/*                                  Balances                                  */
/* -------------------------------------------------------------------------- */

/** Restricts a query to the records this caller may see. */
const scopeFilter = (req) => {
  const scope = buildScopeFilter(req, {
    ownerField: 'employeeId',
    managerField: 'reportingManagerId',
    departmentField: 'departmentId',
    resource: RESOURCES.LEAVE,
  });

  return scope;
};

/** Employee ids the caller may act on, or null when unrestricted. */
const scopedEmployeeIds = async (req) => {
  const scope = scopeFilter(req);

  const restricted =
    scope._id !== undefined || scope.reportingManagerId !== undefined || scope.departmentId !== undefined;

  if (!restricted) return null;

  const employees = await Employee.find({ ...scope, deletedAt: null }).select('_id').lean();
  return employees.map((employee) => employee._id);
};

/** The employee a self-service call belongs to. */
const resolveEmployee = async (req, employeeId = null) => {
  const id = employeeId ?? req.user?.employeeId;

  if (!id) {
    throw ApiError.badRequest('Your login is not linked to an employee record');
  }

  const employee = await Employee.findOne({ _id: id, deletedAt: null })
    .select('employeeCode employeeId firstName lastName gender joiningDate departmentId shiftId workEmail reportingManagerId tenantId')
    .lean();

  if (!employee) throw ApiError.notFound('Employee not found');
  return employee;
};

/**
 * Reads a balance, creating it on first use.
 *
 * An employee has no balance row until something needs one, so this is where a
 * year's entitlement is materialised rather than in a nightly job nobody runs.
 */
export const ensureBalance = async ({ employee, type, year, req, asOf = new Date() }) => {
  const tenantId = employee.tenantId ?? null;

  const existing = await LeaveBalance.findOne({
    tenantId,
    employeeId: employee._id,
    leaveTypeId: type._id,
    year,
  });

  const entitled = accruedEntitlement({
    daysPerYear: type.daysPerYear,
    accrual: type.accrual,
    year,
    asOf,
    joiningDate: employee.joiningDate,
  });

  if (existing) {
    /**
     * A monthly-accruing type earns more as the year runs, so the entitlement
     * is topped up on read. Only ever upward -- reducing it would silently
     * claw back days already taken.
     */
    if (entitled > (existing.entitled ?? 0)) {
      const added = Number((entitled - existing.entitled).toFixed(2));

      existing.entitled = entitled;
      existing.accrued = entitled;
      existing.ledger.push({
        action: LEAVE_LEDGER_ACTIONS.ACCRUAL,
        days: added,
        note: `Accrued to ${entitled} day(s)`,
        by: req?.user?.id ?? null,
      });

      await existing.save();
    }

    return existing;
  }

  return LeaveBalance.create({
    tenantId,
    employeeId: employee._id,
    leaveTypeId: type._id,
    year,
    entitled,
    accrued: entitled,
    ledger: [
      {
        action: LEAVE_LEDGER_ACTIONS.OPENING,
        days: entitled,
        note: `${type.name} entitlement for ${year}`,
        by: req?.user?.id ?? null,
      },
    ],
  });
};

/** Every active type's balance for one employee, materialising any missing. */
export const getEmployeeBalances = async ({ employeeId, year, req }) => {
  const employee = await resolveEmployee(req, employeeId);
  const types = await LeaveType.find({ tenantId: employee.tenantId ?? null, isActive: true }).lean();

  const balances = await Promise.all(
    types.map(async (type) => {
      const balance = await ensureBalance({ employee, type, year, req });

      return {
        ...deriveAvailable(balance.toObject()),
        leaveType: { _id: type._id, name: type.name, code: type.code, colour: type.colour, isPaid: type.isPaid },
      };
    }),
  );

  return {
    employee: {
      _id: employee._id,
      employeeCode: employee.employeeCode,
      employeeId: employee.employeeId ?? null,
      fullName: `${employee.firstName} ${employee.lastName}`,
    },
    year,
    balances,
  };
};

/** Org-wide balance list, for the Leave Balance screen. */
export const listBalances = async (query, req) => {
  const { page, limit, skip } = buildPagination(query);
  const filter = { tenantId: tenantOf(req), year: query.year };

  if (query.leaveTypeId) filter.leaveTypeId = query.leaveTypeId;
  if (query.employeeId) filter.employeeId = query.employeeId;

  const allowed = await scopedEmployeeIds(req);
  if (allowed) filter.employeeId = filter.employeeId ?? { $in: allowed };

  const [items, total] = await Promise.all([
    LeaveBalance.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate({ path: 'employeeId', select: 'employeeCode employeeId firstName lastName departmentId' })
      .populate({ path: 'leaveTypeId', select: 'name code colour' })
      .lean(),
    LeaveBalance.countDocuments(filter),
  ]);

  return { items: items.map(deriveAvailable), total, page, limit };
};

/**
 * Moves what survives a year end into the next year, and lapses the rest.
 *
 * Idempotent: a balance that already carries a figure for the target year is
 * skipped, so running it twice does not double anyone's entitlement.
 */
export const runCarryForward = async ({ fromYear, toYear, leaveTypeId = null }, req) => {
  const tenantId = tenantOf(req);

  const typeFilter = { tenantId, isActive: true, 'carryForward.enabled': true };
  if (leaveTypeId) typeFilter._id = leaveTypeId;

  const types = await LeaveType.find(typeFilter).lean();
  if (!types.length) return { processed: 0, carried: 0, lapsed: 0, skipped: 0, types: 0 };

  const byType = new Map(types.map((type) => [String(type._id), type]));

  const balances = await LeaveBalance.find({
    tenantId,
    year: fromYear,
    leaveTypeId: { $in: types.map((type) => type._id) },
  });

  let processed = 0;
  let skipped = 0;
  let carriedTotal = 0;
  let lapsedTotal = 0;

  for (const balance of balances) {
    const type = byType.get(String(balance.leaveTypeId));
    if (!type) continue;

    const { available } = deriveAvailable(balance.toObject());
    const { carried, lapsed } = carryForwardable({ available, carryForward: type.carryForward });

    const target = await LeaveBalance.findOne({
      tenantId,
      employeeId: balance.employeeId,
      leaveTypeId: balance.leaveTypeId,
      year: toYear,
    });

    // Already carried into this year: leave it alone rather than adding again.
    if (target && target.carriedForward > 0) {
      skipped += 1;
      continue;
    }

    const employee = await Employee.findById(balance.employeeId).select('joiningDate').lean();

    const entitled = accruedEntitlement({
      daysPerYear: type.daysPerYear,
      accrual: type.accrual,
      year: toYear,
      asOf: new Date(toYear, 0, 1),
      joiningDate: employee?.joiningDate,
    });

    if (target) {
      target.carriedForward = carried;
      target.ledger.push({
        action: LEAVE_LEDGER_ACTIONS.CARRY_FORWARD,
        days: carried,
        note: `Carried from ${fromYear}`,
        by: req.user.id,
      });
      await target.save();
    } else {
      await LeaveBalance.create({
        tenantId,
        employeeId: balance.employeeId,
        leaveTypeId: balance.leaveTypeId,
        year: toYear,
        entitled,
        accrued: entitled,
        carriedForward: carried,
        ledger: [
          { action: LEAVE_LEDGER_ACTIONS.OPENING, days: entitled, note: `Entitlement for ${toYear}`, by: req.user.id },
          { action: LEAVE_LEDGER_ACTIONS.CARRY_FORWARD, days: carried, note: `Carried from ${fromYear}`, by: req.user.id },
        ],
      });
    }

    if (lapsed > 0) {
      balance.lapsed = (balance.lapsed ?? 0) + lapsed;
      balance.ledger.push({
        action: LEAVE_LEDGER_ACTIONS.LAPSED,
        days: lapsed,
        note: `Beyond the ${type.name} carry-forward limit`,
        by: req.user.id,
      });
      await balance.save();
    }

    processed += 1;
    carriedTotal += carried;
    lapsedTotal += lapsed;
  }

  await recordAudit({
    req,
    entity: 'LeaveBalance',
    entityId: null,
    entityLabel: `Carry forward ${fromYear} to ${toYear}`,
    action: AUDIT_ACTIONS.BULK_UPDATE,
    metadata: { fromYear, toYear, processed, skipped, carried: carriedTotal, lapsed: lapsedTotal },
  });

  return {
    processed,
    skipped,
    carried: Number(carriedTotal.toFixed(2)),
    lapsed: Number(lapsedTotal.toFixed(2)),
    types: types.length,
  };
};

/** Pays out part of a balance. The money side is Payroll's; this is the ledger. */
export const encashBalance = async ({ balanceId, days, note }, req) => {
  const balance = await LeaveBalance.findOne({ _id: balanceId, tenantId: tenantOf(req) });
  if (!balance) throw ApiError.notFound('Leave balance not found');

  const type = await LeaveType.findById(balance.leaveTypeId).lean();
  if (!type) throw ApiError.notFound('Leave type not found');

  const { available } = deriveAvailable(balance.toObject());
  const { allowed, reason } = encashableDays({ available, encashment: type.encashment, requested: days });

  if (reason) throw ApiError.badRequest(reason);

  balance.encashed = (balance.encashed ?? 0) + allowed;
  balance.ledger.push({
    action: LEAVE_LEDGER_ACTIONS.ENCASHED,
    days: allowed,
    note: note ?? `Encashed ${allowed} day(s)`,
    by: req.user.id,
  });

  await balance.save();

  await recordAudit({
    req,
    entity: 'LeaveBalance',
    entityId: balance._id,
    entityLabel: `${type.name} ${balance.year}`,
    action: AUDIT_ACTIONS.UPDATE,
    changes: [{ field: 'encashed', from: String(balance.encashed - allowed), to: String(balance.encashed) }],
    metadata: { days: allowed },
  });

  return deriveAvailable(balance.toObject());
};

/** Manual correction, in either direction, with a reason on the record. */
export const adjustBalance = async ({ balanceId, days, note }, req) => {
  const balance = await LeaveBalance.findOne({ _id: balanceId, tenantId: tenantOf(req) });
  if (!balance) throw ApiError.notFound('Leave balance not found');

  balance.adjusted = Number(((balance.adjusted ?? 0) + days).toFixed(2));
  balance.ledger.push({
    action: LEAVE_LEDGER_ACTIONS.ADJUSTMENT,
    days,
    note,
    by: req.user.id,
  });

  await balance.save();

  await recordAudit({
    req,
    entity: 'LeaveBalance',
    entityId: balance._id,
    action: AUDIT_ACTIONS.UPDATE,
    changes: [{ field: 'adjusted', from: String(balance.adjusted - days), to: String(balance.adjusted) }],
    metadata: { days, note },
  });

  return deriveAvailable(balance.toObject());
};

/* -------------------------------------------------------------------------- */
/*                                  Requests                                  */
/* -------------------------------------------------------------------------- */

const REQUEST_SORTABLE = ['from', 'to', 'days', 'status', 'createdAt'];

/** Sequential per tenant and year, so a request can be quoted in a conversation. */
const nextRequestNumber = async (tenantId, year) => {
  const count = await LeaveRequest.countDocuments({ tenantId, year });
  return `LV${year}${String(count + 1).padStart(5, '0')}`;
};

/**
 * The working-day context for a range: which days are off, and which are
 * holidays.
 *
 * Read from the attendance module so leave and attendance agree on what a
 * working day is.
 */
const workingContext = async (employee, from, to) => {
  const tenantId = employee.tenantId ?? null;

  const [holidays, policy] = await Promise.all([
    attendanceRepository.findHolidays(tenantId, from, to),
    attendanceRepository.resolvePolicy(tenantId, employee.departmentId ?? null),
  ]);

  // A shift's own weekly offs beat the tenant policy, matching how attendance
  // grades the same day.
  const shift = employee.shiftId
    ? await mongoose.model('Shift').findById(employee.shiftId).select('weeklyOffs').lean()
    : null;

  const weeklyOffs = shift?.weeklyOffs?.length ? shift.weeklyOffs : (policy?.weeklyOffs ?? [0]);

  return { holidays, weeklyOffs };
};

/** Dry-run: what a request would cost, and what would stop it. */
export const previewRequest = async (payload, req) => {
  const employee = await resolveEmployee(req, payload.employeeId);

  const type = await LeaveType.findOne({ _id: payload.leaveTypeId, isActive: true }).lean();
  if (!type) throw ApiError.notFound('Leave type not found or inactive');

  const { holidays, weeklyOffs } = await workingContext(employee, payload.from, payload.to);

  const breakdown = expandLeaveDays({
    from: payload.from,
    to: payload.to,
    weeklyOffs,
    holidays,
    countsHolidays: type.countsHolidays,
    isHalfDay: payload.isHalfDay,
    session: payload.session,
  });

  const days = countLeaveDays(breakdown);
  const year = startOfDay(payload.from).getFullYear();

  const balanceDocument = await ensureBalance({ employee, type, year, req });
  const balance = deriveAvailable(balanceDocument.toObject());

  const overlapping = await LeaveRequest.find({
    employeeId: employee._id,
    status: { $in: [LEAVE_STATUS.PENDING, LEAVE_STATUS.APPROVED] },
    from: { $lte: startOfDay(payload.to) },
    to: { $gte: startOfDay(payload.from) },
    ...(payload.excludeRequestId ? { _id: { $ne: payload.excludeRequestId } } : {}),
  })
    .select('requestNumber from to')
    .lean();

  const problems = validateRequest({
    type,
    days,
    from: payload.from,
    balance,
    employee,
    overlapping,
  });

  return { days, breakdown, balance, problems, overlapping, type, year };
};

export const applyForLeave = async (payload, req) => {
  const preview = await previewRequest(payload, req);

  if (preview.problems.length) {
    throw ApiError.unprocessable('This leave cannot be applied for', preview.problems.map((message) => ({ message })));
  }

  const employee = await resolveEmployee(req, payload.employeeId);
  const tenantId = employee.tenantId ?? null;

  const request = await LeaveRequest.create({
    tenantId,
    employeeId: employee._id,
    leaveTypeId: preview.type._id,
    requestNumber: await nextRequestNumber(tenantId, preview.year),
    from: startOfDay(payload.from),
    to: startOfDay(payload.to),
    year: preview.year,
    days: preview.days,
    breakdown: preview.breakdown,
    isHalfDay: Boolean(payload.isHalfDay),
    session: payload.isHalfDay ? (payload.session ?? 'FIRST_HALF') : null,
    reason: payload.reason,
    contactDuringLeave: payload.contactDuringLeave ?? null,
    approverId: employee.reportingManagerId ?? null,
    // What the rules were when this was raised.
    typeSnapshot: {
      name: preview.type.name,
      code: preview.type.code,
      isPaid: preview.type.isPaid,
      countsHolidays: preview.type.countsHolidays,
      requiresApproval: preview.type.requiresApproval,
    },
    status: preview.type.requiresApproval ? LEAVE_STATUS.PENDING : LEAVE_STATUS.APPROVED,
    appliedBy: req.user.id,
    createdBy: req.user.id,
  });

  /**
   * Pending days are held against the balance immediately.
   *
   * Without this, three applications for the last five days would all validate
   * and the third would be honoured against nothing.
   */
  await LeaveBalance.updateOne(
    { tenantId, employeeId: employee._id, leaveTypeId: preview.type._id, year: preview.year },
    { $inc: { pending: preview.days } },
  );

  // A type that needs no approval is committed straight away.
  if (!preview.type.requiresApproval) {
    await commitApproval(request, req);
  }

  await recordAudit({
    req,
    entity: 'LeaveRequest',
    entityId: request._id,
    entityLabel: request.requestNumber,
    action: AUDIT_ACTIONS.CREATE,
    metadata: { days: preview.days, type: preview.type.name },
  });

  // Notification never blocks the application: a mail server being down is not
  // a reason to refuse leave.
  sendLeaveRequestEmail({
    to: null,
    employee,
    request: request.toObject(),
    typeName: preview.type.name,
  }).catch(() => {});

  return request.toObject();
};

/** Moves days from pending to taken, and marks the attendance days. */
const commitApproval = async (request, req) => {
  await LeaveBalance.updateOne(
    {
      tenantId: request.tenantId,
      employeeId: request.employeeId,
      leaveTypeId: request.leaveTypeId,
      year: request.year,
    },
    {
      $inc: { pending: -request.days, taken: request.days },
      $push: {
        ledger: {
          action: LEAVE_LEDGER_ACTIONS.TAKEN,
          days: request.days,
          note: `${request.requestNumber}`,
          leaveRequestId: request._id,
          by: req.user.id,
          at: new Date(),
        },
      },
    },
  );

  /**
   * Approved leave is written into attendance.
   *
   * Payroll counts ON_LEAVE as payable, so leave that never reached the
   * attendance record would be paid as an absence. Only days the leave
   * actually charges for are marked -- a weekly off inside the range stays
   * whatever attendance already made it.
   */
  const chargeable = request.breakdown.filter((day) => day.days > 0);

  await Promise.all(
    chargeable.map((day) =>
      Attendance.updateOne(
        { employeeId: request.employeeId, date: startOfDay(day.date) },
        {
          $set: {
            /**
             * The day's own charge decides the status, not the request's.
             *
             * `breakdown[].days` is already 0.5 for a half day and 1 for a
             * full one -- it is what the balance is debited by -- but this
             * wrote ON_LEAVE for every chargeable day and threw that figure
             * away. A half day therefore reached attendance as a whole day
             * off: the balance said 0.5 and the register said 1.
             *
             * HALF_DAY is the status the rest of the system already counts as
             * half a day -- payroll adds `halfDay x 0.5` to payable days and
             * the same again to loss of pay -- so routing a 0.5 day here makes
             * every downstream figure follow the leave that was actually
             * taken, with no other change.
             *
             * Only the status is set. Any in and out times already on the day
             * are left alone, so an employee who worked the other half keeps
             * that record.
             */
            status: day.days < 1 ? ATTENDANCE_STATUS.HALF_DAY : ATTENDANCE_STATUS.ON_LEAVE,
            source: ATTENDANCE_SOURCE.SYSTEM,
            remarks: `Leave ${request.requestNumber}`,
          },
          $setOnInsert: {
            tenantId: request.tenantId,
            employeeId: request.employeeId,
            date: startOfDay(day.date),
          },
        },
        { upsert: true },
      ),
    ),
  );
};

/** Returns held or consumed days to the balance. */
const releaseDays = async (request, { fromPending }, req) => {
  await LeaveBalance.updateOne(
    {
      tenantId: request.tenantId,
      employeeId: request.employeeId,
      leaveTypeId: request.leaveTypeId,
      year: request.year,
    },
    {
      $inc: fromPending ? { pending: -request.days } : { taken: -request.days },
      $push: {
        ledger: {
          action: LEAVE_LEDGER_ACTIONS.RETURNED,
          days: request.days,
          note: `${request.requestNumber} ${fromPending ? 'withdrawn' : 'cancelled'}`,
          leaveRequestId: request._id,
          by: req.user.id,
          at: new Date(),
        },
      },
    },
  );
};

const assertTransition = (from, to) => {
  if (!LEAVE_STATUS_TRANSITIONS[from]?.includes(to)) {
    throw ApiError.badRequest(`A ${from.toLowerCase()} request cannot become ${to.toLowerCase()}`);
  }
};

export const decideRequest = async (id, { decision, comment }, req) => {
  const request = await LeaveRequest.findOne({ _id: id, tenantId: tenantOf(req) });
  if (!request) throw ApiError.notFound('Leave request not found');

  assertTransition(request.status, decision);

  // Approving your own leave defeats the point of the approval.
  if (String(request.employeeId) === String(req.user.employeeId ?? '')) {
    throw ApiError.forbidden('You cannot decide your own leave request');
  }

  request.status = decision;
  request.decision = {
    decision,
    by: req.user.id,
    byEmail: req.user.email ?? null,
    at: new Date(),
    comment: comment ?? null,
  };

  await request.save();

  if (decision === LEAVE_STATUS.APPROVED) await commitApproval(request, req);
  else await releaseDays(request, { fromPending: true }, req);

  await recordAudit({
    req,
    entity: 'LeaveRequest',
    entityId: request._id,
    entityLabel: request.requestNumber,
    // The audit model constrains `action` to AUDIT_ACTIONS, which has no
    // APPROVE. The decision is carried in the change and the metadata instead
    // of inventing a value the enum would reject.
    action: AUDIT_ACTIONS.STATUS_CHANGE,
    changes: [{ field: 'status', from: LEAVE_STATUS.PENDING, to: decision }],
    metadata: { decision, comment: comment ?? null },
  });

  const employee = await Employee.findById(request.employeeId).select('firstName lastName workEmail').lean();

  sendLeaveDecisionEmail({
    to: employee?.workEmail,
    name: employee ? `${employee.firstName} ${employee.lastName}` : 'there',
    request: request.toObject(),
    decision,
    comment,
  }).catch(() => {});

  return request.toObject();
};

export const cancelRequest = async (id, { reason }, req) => {
  const request = await LeaveRequest.findOne({ _id: id, tenantId: tenantOf(req) });
  if (!request) throw ApiError.notFound('Leave request not found');

  assertTransition(request.status, LEAVE_STATUS.CANCELLED);

  const wasApproved = request.status === LEAVE_STATUS.APPROVED;

  request.status = LEAVE_STATUS.CANCELLED;
  request.cancelledAt = new Date();
  request.cancelReason = reason ?? null;
  await request.save();

  await releaseDays(request, { fromPending: !wasApproved }, req);

  /**
   * An approved cancellation leaves the written days behind in attendance.
   *
   * They are cleared rather than left, or payroll would keep paying for leave
   * that was withdrawn.
   *
   * Both statuses are matched. A half day is now written as HALF_DAY, and
   * clearing only ON_LEAVE would have left every cancelled half day standing --
   * still counting half a payable day for leave that no longer exists.
   */
  if (wasApproved) {
    const chargeable = request.breakdown.filter((day) => day.days > 0);

    await Attendance.updateMany(
      {
        employeeId: request.employeeId,
        date: { $in: chargeable.map((day) => startOfDay(day.date)) },
        status: { $in: [ATTENDANCE_STATUS.ON_LEAVE, ATTENDANCE_STATUS.HALF_DAY] },
      },
      { $set: { status: ATTENDANCE_STATUS.ABSENT, remarks: `Leave ${request.requestNumber} cancelled` } },
    );
  }

  await recordAudit({
    req,
    entity: 'LeaveRequest',
    entityId: request._id,
    entityLabel: request.requestNumber,
    action: AUDIT_ACTIONS.UPDATE,
    changes: [{ field: 'status', from: wasApproved ? LEAVE_STATUS.APPROVED : LEAVE_STATUS.PENDING, to: LEAVE_STATUS.CANCELLED }],
  });

  return request.toObject();
};

export const listRequests = async (query, req) => {
  const { page, limit, skip } = buildPagination(query);
  const filter = { tenantId: tenantOf(req) };

  if (query.status) filter.status = query.status;
  if (query.leaveTypeId) filter.leaveTypeId = query.leaveTypeId;
  if (query.employeeId) filter.employeeId = query.employeeId;
  if (query.year) filter.year = query.year;

  if (query.from || query.to) {
    filter.from = {};
    if (query.to) filter.from.$lte = startOfDay(query.to);
    if (query.from) filter.to = { $gte: startOfDay(query.from) };
  }

  // `mine` is the self-service view and ignores scope entirely.
  if (query.mine) {
    filter.employeeId = req.user.employeeId ?? null;
  } else {
    const allowed = await scopedEmployeeIds(req);
    if (allowed) filter.employeeId = filter.employeeId ?? { $in: allowed };
  }

  const sort = buildSort({ sortBy: query.sortBy, sortOrder: query.sortOrder }, REQUEST_SORTABLE, { from: -1 });

  const [items, total] = await Promise.all([
    LeaveRequest.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate({ path: 'employeeId', select: 'employeeCode employeeId firstName lastName departmentId' })
      .populate({ path: 'leaveTypeId', select: 'name code colour isPaid' })
      .lean(),
    LeaveRequest.countDocuments(filter),
  ]);

  return { items, total, page, limit };
};

export const getRequest = async (id, req) => {
  const request = await LeaveRequest.findOne({ _id: id, tenantId: tenantOf(req) })
    .populate({ path: 'employeeId', select: 'employeeCode employeeId firstName lastName departmentId workEmail' })
    .populate({ path: 'leaveTypeId', select: 'name code colour isPaid' })
    .lean();

  if (!request) throw ApiError.notFound('Leave request not found');
  return request;
};

export const pendingCount = async (req) => {
  const filter = { tenantId: tenantOf(req), status: LEAVE_STATUS.PENDING };

  const allowed = await scopedEmployeeIds(req);
  if (allowed) filter.employeeId = { $in: allowed };

  return { pending: await LeaveRequest.countDocuments(filter) };
};

/**
 * Who is away over a period.
 *
 * The question a manager actually asks is not "what did X apply for" but "how
 * many of my team are out on the 14th", so this returns days rather than
 * requests.
 */
export const leaveCalendar = async ({ from, to, departmentId }, req) => {
  const filter = {
    tenantId: tenantOf(req),
    status: { $in: [LEAVE_STATUS.APPROVED, LEAVE_STATUS.PENDING] },
    from: { $lte: startOfDay(to) },
    to: { $gte: startOfDay(from) },
  };

  const allowed = await scopedEmployeeIds(req);
  if (allowed) filter.employeeId = { $in: allowed };

  const requests = await LeaveRequest.find(filter)
    .populate({ path: 'employeeId', select: 'employeeCode employeeId firstName lastName departmentId' })
    .populate({ path: 'leaveTypeId', select: 'name code colour' })
    .lean();

  const relevant = departmentId
    ? requests.filter((request) => String(request.employeeId?.departmentId ?? '') === String(departmentId))
    : requests;

  const byDate = new Map();

  relevant.forEach((request) => {
    request.breakdown
      .filter((day) => day.days > 0)
      .forEach((day) => {
        const key = startOfDay(day.date).toISOString().slice(0, 10);
        if (key < startOfDay(from).toISOString().slice(0, 10)) return;
        if (key > startOfDay(to).toISOString().slice(0, 10)) return;

        if (!byDate.has(key)) byDate.set(key, []);

        byDate.get(key).push({
          requestId: String(request._id),
          requestNumber: request.requestNumber,
          employeeId: String(request.employeeId?._id ?? request.employeeId),
          employeeCode: request.employeeId?.employeeCode ?? null,
          fullName: request.employeeId
            ? `${request.employeeId.firstName} ${request.employeeId.lastName}`
            : null,
          leaveType: request.leaveTypeId?.name ?? null,
          colour: request.leaveTypeId?.colour ?? null,
          status: request.status,
          days: day.days,
          session: day.session,
        });
      });
  });

  return {
    from,
    to,
    days: [...byDate.entries()]
      .map(([date, entries]) => ({ date, count: entries.length, entries }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
};

/* -------------------------------------------------------------------------- */
/*                                   Reports                                  */
/* -------------------------------------------------------------------------- */

/** Balance and consumption per employee, for the Leave Reports screen. */
export const leaveReport = async ({ year, leaveTypeId, departmentId }, req) => {
  const filter = { tenantId: tenantOf(req), year };
  if (leaveTypeId) filter.leaveTypeId = leaveTypeId;

  const allowed = await scopedEmployeeIds(req);
  if (allowed) filter.employeeId = { $in: allowed };

  const balances = await LeaveBalance.find(filter)
    .populate({ path: 'employeeId', select: 'employeeCode employeeId firstName lastName departmentId' })
    .populate({ path: 'leaveTypeId', select: 'name code' })
    .lean();

  const relevant = departmentId
    ? balances.filter((balance) => String(balance.employeeId?.departmentId ?? '') === String(departmentId))
    : balances;

  const rows = relevant.map((balance) => {
    const derived = deriveAvailable(balance);

    return {
      employeeId: String(balance.employeeId?._id ?? balance.employeeId),
      employeeCode: balance.employeeId?.employeeCode ?? null,
      fullName: balance.employeeId
        ? `${balance.employeeId.firstName} ${balance.employeeId.lastName}`
        : null,
      leaveType: balance.leaveTypeId?.name ?? null,
      entitled: derived.entitled,
      carriedForward: derived.carriedForward,
      adjusted: derived.adjusted,
      taken: derived.taken,
      pending: derived.pending,
      encashed: derived.encashed,
      lapsed: derived.lapsed,
      available: derived.available,
    };
  });

  const totals = rows.reduce(
    (sum, row) => ({
      entitled: sum.entitled + row.entitled,
      taken: sum.taken + row.taken,
      available: sum.available + row.available,
      encashed: sum.encashed + row.encashed,
    }),
    { entitled: 0, taken: 0, available: 0, encashed: 0 },
  );

  return { year, rows, totals };
};

export default {
  listTypes,
  getType,
  createType,
  updateType,
  setTypeStatus,
  deleteType,
  getEmployeeBalances,
  listBalances,
  runCarryForward,
  encashBalance,
  adjustBalance,
  previewRequest,
  applyForLeave,
  decideRequest,
  cancelRequest,
  listRequests,
  getRequest,
  pendingCount,
  leaveCalendar,
  leaveReport,
};
