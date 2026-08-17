import logger from '../../config/logger.js';
import ApiError from '../../utils/ApiError.js';
import {
  ACTIONS,
  AUDIT_ACTIONS,
  EMPLOYEE_STATUS,
  EMPLOYEE_STATUS_TRANSITIONS,
  RESOURCES,
} from '../../utils/constants.js';
import {
  buildPagination,
  buildSort,
  buildSearch,
  buildFilters,
  dateRange,
} from '../../utils/queryBuilder.js';
import employeeRepository from '../../repositories/employee/employee.repository.js';
import auditLogRepository from '../../repositories/audit/auditLog.repository.js';
import { deriveSalaryTotals, deriveOvertimeRate } from '../../models/employee/employee.model.js';
// The Employee Master is the source of truth; payroll reads a projection of it.
import { syncSalaryStructure } from './salaryStructureSync.service.js';
// Stored attendance carries overtime derived from these settings; see below.
import { syncOvertimeAfterEmployeeChange } from '../attendance/overtimeRecompute.service.js';
import { recordAudit, diffObjects } from '../../helpers/audit.helper.js';
import { can, buildScopeFilter } from '../../helpers/permission.helper.js';
import {
  createEmployeeFolders,
  removeEmployeeFolder,
  renameEmployeeFolder,
  rewriteStoredPath,
} from '../../helpers/employeeFiles.helper.js';

const ENTITY = 'Employee';

/** Columns a client may sort by. See queryBuilder for why this is restricted. */
export const SORTABLE_FIELDS = [
  'employeeCode',
  // Sortable now that it is a column on the Employee Master. Covered by the
  // {tenantId, employeeId} unique index, so it is not a collection scan.
  'employeeId',
  'firstName',
  'lastName',
  'joiningDate',
  'confirmationDate',
  'status',
  'employmentType',
  'createdAt',
  'updatedAt',
];

/** Prefix-matched search fields. */
const SEARCHABLE_FIELDS = [
  'employeeCode',
  'employeeId',
  'firstName',
  'lastName',
  'workEmail',
  'personalEmail',
  'mobile',
];

/* -------------------------------------------------------------------------- */
/*                            Sensitive field masking                         */
/* -------------------------------------------------------------------------- */

const maskTail = (value, visible = 4) => {
  if (!value) return null;
  const text = String(value);
  if (text.length <= visible) return '*'.repeat(text.length);
  return `${'*'.repeat(text.length - visible)}${text.slice(-visible)}`;
};

/**
 * National identity and bank numbers are masked unless the caller can edit the
 * record or is the record.
 *
 * Read access to a directory is not read access to someone's Aadhaar. A
 * manager legitimately needs `employee:read` to see their team, and that must
 * not hand them the whole team's identity documents.
 */
export const maskSensitive = (employee, requester) => {
  if (!employee) return employee;

  const isSelf = requester?.employeeId && String(requester.employeeId) === String(employee._id ?? employee.id);
  const maySeeFull = isSelf || can(requester?.role, RESOURCES.EMPLOYEE, ACTIONS.UPDATE);
  if (maySeeFull) return employee;

  return {
    ...employee,
    statutory: employee.statutory
      ? {
          ...employee.statutory,
          aadhaar: maskTail(employee.statutory.aadhaar),
          pan: maskTail(employee.statutory.pan),
          passportNumber: maskTail(employee.statutory.passportNumber),
          drivingLicense: maskTail(employee.statutory.drivingLicense),
        }
      : employee.statutory,
    bankDetails: employee.bankDetails
      ? { ...employee.bankDetails, accountNumber: maskTail(employee.bankDetails.accountNumber) }
      : employee.bankDetails,
    // Compensation is need-to-know even among people who may read the profile.
    salaryStructure: employee.salaryStructure
      ? { ...employee.salaryStructure, ctc: null }
      : employee.salaryStructure,
  };
};

/* -------------------------------------------------------------------------- */
/*                                   List                                     */
/* -------------------------------------------------------------------------- */

const FILTER_DEFINITIONS = {
  status: (value) => ({ status: Array.isArray(value) ? { $in: value } : value }),
  departmentId: (value) => ({ departmentId: employeeRepository.toObjectId(value) }),
  designationId: (value) => ({ designationId: employeeRepository.toObjectId(value) }),
  shiftId: (value) => ({ shiftId: employeeRepository.toObjectId(value) }),
  reportingManagerId: (value) => ({ reportingManagerId: employeeRepository.toObjectId(value) }),
  employmentType: (value) => ({ employmentType: Array.isArray(value) ? { $in: value } : value }),
  gender: (value) => ({ gender: value }),
  bloodGroup: (value) => ({ bloodGroup: value }),
  maritalStatus: (value) => ({ maritalStatus: value }),
  workLocation: (value) => ({ workLocation: value }),
  joinedFrom: (value, params) => {
    const range = dateRange(value, params.joinedTo);
    return range ? { joiningDate: range } : null;
  },
  // Consumed by joinedFrom; declared so it is not treated as unknown.
  joinedTo: () => null,
};

export const listEmployees = async (query, req) => {
  const { page, limit, skip } = buildPagination(query);
  const sort = buildSort(query, SORTABLE_FIELDS, { createdAt: -1 });

  // Scope first: what this role may see at all, before any client filter.
  const scope = buildScopeFilter(req, {
    ownerField: '_id',
    managerField: 'reportingManagerId',
    departmentField: 'departmentId',
    resource: RESOURCES.EMPLOYEE,
  });
  delete scope.tenantId;

  const filter = {
    tenantId: req.user.tenantId ?? null,
    ...scope,
    // Deleted rows are opt-in, and only for callers who could restore them.
    deletedAt: query.includeDeleted && can(req.user.role, RESOURCES.EMPLOYEE, ACTIONS.DELETE)
      ? { $exists: true }
      : null,
    ...buildFilters(query, FILTER_DEFINITIONS),
  };

  const search = buildSearch(query.search, SEARCHABLE_FIELDS);
  if (search) Object.assign(filter, search);

  const { items, total } = await employeeRepository.paginate({ filter, sort, skip, limit });

  return {
    items: items.map((item) => maskSensitive(item, req.user)),
    total,
    page,
    limit,
  };
};

export const getStatusSummary = async (req) => {
  const scope = buildScopeFilter(req, {
    ownerField: '_id',
    managerField: 'reportingManagerId',
    departmentField: 'departmentId',
    resource: RESOURCES.EMPLOYEE,
  });

  const rows = await employeeRepository.statusSummary({
    ...scope,
    tenantId: req.user.tenantId ?? null,
  });

  const summary = Object.fromEntries(Object.values(EMPLOYEE_STATUS).map((status) => [status, 0]));
  rows.forEach(({ _id, count }) => {
    summary[_id] = count;
  });
  summary.total = rows.reduce((sum, row) => sum + row.count, 0);

  return summary;
};

/* -------------------------------------------------------------------------- */
/*                                   Read                                     */
/* -------------------------------------------------------------------------- */

export const getEmployee = async (id, req, { includeDeleted = false } = {}) => {
  const employee = await employeeRepository.findById(id, { includeDeleted });
  if (!employee) throw ApiError.notFound('Employee not found');

  assertSameTenant(employee, req);

  return maskSensitive(employee.toObject({ virtuals: true }), req.user);
};

/**
 * Tenant isolation at the record level. The list query is already scoped, but a
 * direct fetch by id must be checked explicitly -- an id from another tenant is
 * otherwise a valid lookup.
 */
const assertSameTenant = (employee, req) => {
  const callerTenant = req.user?.tenantId ?? null;
  const recordTenant = employee.tenantId ? String(employee.tenantId) : null;

  if (callerTenant !== null && recordTenant !== callerTenant) {
    // Reported as "not found", not "forbidden": confirming the id exists
    // elsewhere would itself leak information across tenants.
    throw ApiError.notFound('Employee not found');
  }
};

/* -------------------------------------------------------------------------- */
/*                                  Create                                    */
/* -------------------------------------------------------------------------- */

const assertUniqueIdentifiers = async (tenantId, payload, excludeId = null) => {
  const conflicts = [];

  if (payload.employeeId) {
    const existing = await employeeRepository.findByEmployeeId(tenantId, payload.employeeId);
    if (existing && String(existing._id) !== String(excludeId)) {
      conflicts.push({ field: 'employeeId', message: 'This employee ID is already in use' });
    }
  }

  if (payload.workEmail) {
    const existing = await employeeRepository.findByWorkEmail(tenantId, payload.workEmail);
    if (existing && String(existing._id) !== String(excludeId)) {
      conflicts.push({ field: 'workEmail', message: 'This work email is already in use' });
    }
  }

  if (conflicts.length) throw ApiError.conflict('Duplicate identifier', conflicts);
};

const assertDatesAreCoherent = (payload, existing = {}) => {
  const joining = payload.joiningDate ?? existing.joiningDate;
  const confirmation = payload.confirmationDate ?? existing.confirmationDate;
  const dob = payload.dateOfBirth ?? existing.dateOfBirth;

  const errors = [];

  if (joining && confirmation && new Date(confirmation) < new Date(joining)) {
    errors.push({ field: 'confirmationDate', message: 'Confirmation cannot precede joining' });
  }

  if (dob && joining && new Date(joining) <= new Date(dob)) {
    errors.push({ field: 'joiningDate', message: 'Joining date must be after date of birth' });
  }

  if (dob) {
    const ageYears = (Date.now() - new Date(dob).getTime()) / 31_557_600_000;
    // A hard floor rather than a warning: employing a minor is a legal matter,
    // not a data-entry preference.
    if (ageYears < 14) errors.push({ field: 'dateOfBirth', message: 'Employee must be at least 14 years old' });
    if (ageYears > 100) errors.push({ field: 'dateOfBirth', message: 'Date of birth looks incorrect' });
  }

  if (errors.length) throw ApiError.unprocessable('Validation failed', errors);
};

/**
 * Saves the employee, reissuing whichever generated identifier the database
 * rejects until the write lands.
 *
 * The unique index is the arbiter, not the generators' own pre-checks: two
 * creates can pass those checks simultaneously and only one of them can win the
 * write. Catching the duplicate-key error and drawing again is what makes
 * near-simultaneous creation safe, and it is the only point where the outcome
 * is actually decided.
 *
 * Both identifiers are retried, because either can lose the race and a failure
 * on one is indistinguishable to the user from a failure on the other -- two
 * people added at the same moment simply have to both succeed. `employeeCode`
 * is the more likely of the two: it is a sequence, so concurrent callers read
 * the same highest value and derive the same next one, where the random ID only
 * collides by chance.
 *
 * A caller-SUPPLIED identifier is never reissued. A migrated payroll number or
 * a code typed on the offer-conversion screen that collides is a data problem
 * for the user to see, not one to paper over by silently storing something
 * other than what they asked for.
 */
/**
 * Generous, because the sequence lets exactly one caller through per round: a
 * burst of N simultaneous creates needs N rounds to drain, so a ceiling near
 * the expected concurrency is really a ceiling on how many people can be added
 * at once. The jitter below is what keeps that from being the common case.
 */
const MAX_IDENTIFIER_ATTEMPTS = 12;

/**
 * Spreads a colliding burst out before it reads the sequence again.
 *
 * Without it every loser retries in the same tick, reads the same highest code
 * and collides again -- the herd stays in step and only one more gets through
 * each round. A short random pause breaks the lockstep.
 */
const jitter = () => new Promise((resolve) => { setTimeout(resolve, 15 + Math.random() * 60); });

const createWithUniqueIdentifiers = async (attributes, { tenantId, suppliedCode, suppliedId }) => {
  let employeeCode = suppliedCode ?? (await employeeRepository.nextEmployeeCode(tenantId));

  for (let attempt = 1; ; attempt += 1) {
    const employeeId = suppliedId || (await employeeRepository.generateEmployeeId());

    try {
      return await employeeRepository.create({ ...attributes, employeeCode, employeeId });
    } catch (error) {
      const clashed = error?.code === 11000 ? Object.keys(error.keyPattern ?? {}) : [];
      const codeClashed = clashed.includes('employeeCode') && !suppliedCode;
      const idClashed = clashed.includes('employeeId') && !suppliedId;

      // Anything else -- a duplicate work email, a validation failure -- is the
      // caller's to see, unchanged.
      if ((!codeClashed && !idClashed) || attempt >= MAX_IDENTIFIER_ATTEMPTS) throw error;

      logger.warn('An employee identifier collided on write; reissuing', {
        employeeCode: codeClashed ? employeeCode : undefined,
        employeeId: idClashed ? employeeId : undefined,
        attempt,
      });

      if (codeClashed) {
        await jitter();
        employeeCode = await employeeRepository.nextEmployeeCode(tenantId);
      }
    }
  }
};

export const createEmployee = async (payload, req) => {
  const tenantId = req.user.tenantId ?? null;

  await assertUniqueIdentifiers(tenantId, payload);
  assertDatesAreCoherent(payload);

  if (payload.reportingManagerId) {
    const manager = await employeeRepository.findById(payload.reportingManagerId, { populate: false });
    if (!manager) throw ApiError.badRequest('The selected reporting manager does not exist');
    assertSameTenant(manager, req);
  }

  const employee = await createWithUniqueIdentifiers(
    {
      ...payload,
      tenantId,
      status: payload.status ?? EMPLOYEE_STATUS.PROBATION,
      createdBy: req.user.id,
      updatedBy: req.user.id,
    },
    { tenantId, suppliedCode: payload.employeeCode, suppliedId: payload.employeeId },
  );

  /**
   * The attachment folder tree, created with the employee.
   *
   * Not awaited into the failure path: a filesystem problem must not roll back
   * a saved employee, and the upload middleware creates the folders again
   * before writing anything, so a miss here is recoverable rather than fatal.
   */
  await createEmployeeFolders(employee.employeeCode).catch((error) =>
    logger.error('Could not create attachment folders for a new employee', {
      employeeCode: employee.employeeCode,
      error: error.message,
    }),
  );

  // Payroll reads an effective-dated structure, not the employee's embedded
  // one. Projected here so a new joiner with a salary is payable immediately,
  // without anyone re-entering the same figures on the Payroll screen.
  await syncSalaryStructure(employee, req);

  await recordAudit({
    req,
    entity: ENTITY,
    entityId: employee._id,
    entityLabel: `${employee.employeeCode} - ${employee.fullName}`,
    action: AUDIT_ACTIONS.CREATE,
    changes: diffObjects({}, employee.toObject()),
  });

  logger.info('Employee created', {
    id: String(employee._id),
    employeeCode: employee.employeeCode,
    employeeId: employee.employeeId,
  });

  return getEmployee(employee._id, req);
};

/* -------------------------------------------------------------------------- */
/*                                  Update                                    */
/* -------------------------------------------------------------------------- */

/** Fields no ordinary update may touch; each has its own guarded operation. */
const IMMUTABLE_FIELDS = [
  'employeeCode',
  // The employee ID is permanent once issued. It is quoted on payslips,
  // attendance sheets and statutory filings, so a record that changed it would
  // stop matching its own history -- and an edit screen is not the place to
  // decide that.
  'employeeId',
  'tenantId',
  'status',
  'lifecycle',
  'deletedAt',
  'deletedBy',
  'documents',
  'photo',
  'createdBy',
];

/**
 * Keeps the attachment folder in step with the employee record.
 *
 * Two jobs. If the employee code changed, the folder is renamed and the stored
 * paths are rewritten to match -- otherwise every existing document would point
 * at a directory that no longer exists. And if the folder is simply missing,
 * it is created: employees that predate this feature have no folder, and the
 * first edit is a natural moment to give them one.
 *
 * `employeeCode` is currently in IMMUTABLE_FIELDS, so the rename branch cannot
 * fire through the API today. It is here so that relaxing that immutability
 * later cannot silently orphan a folder full of identity documents.
 */
const syncAttachmentFolder = async (before, updated, req) => {
  try {
    const fromCode = before?.employeeCode;
    const toCode = updated?.employeeCode;

    if (fromCode && toCode && fromCode !== toCode) {
      const renamed = await renameEmployeeFolder(fromCode, toCode);

      if (renamed) {
        const documents = (updated.documents ?? []).map((document) => ({
          ...(document.toObject ? document.toObject() : document),
          filePath: rewriteStoredPath(document.filePath, fromCode, toCode),
        }));

        await employeeRepository.updateById(updated._id, { $set: { documents } });

        await recordAudit({
          req,
          entity: ENTITY,
          entityId: updated._id,
          entityLabel: `${toCode} - ${updated.fullName}`,
          action: AUDIT_ACTIONS.UPDATE,
          changes: [{ field: 'attachmentsFolder', from: fromCode, to: toCode }],
          metadata: { documentsRepointed: documents.length },
        });
      }

      return;
    }

    await createEmployeeFolders(toCode);
  } catch (error) {
    // Never fails the save: the employee update itself succeeded, and the
    // upload middleware recreates the folders before it writes anything.
    logger.error('Could not sync the attachment folder', {
      employeeCode: updated?.employeeCode,
      error: error.message,
    });
  }
};

export const updateEmployee = async (id, payload, req) => {
  const existing = await employeeRepository.findById(id, { populate: false });
  if (!existing) throw ApiError.notFound('Employee not found');
  assertSameTenant(existing, req);

  const update = { ...payload };
  IMMUTABLE_FIELDS.forEach((field) => delete update[field]);

  await assertUniqueIdentifiers(req.user.tenantId ?? null, update, id);
  assertDatesAreCoherent(update, existing.toObject());

  if (update.reportingManagerId !== undefined && update.reportingManagerId !== null) {
    const cycles = await employeeRepository.wouldCreateReportingCycle(id, update.reportingManagerId);
    // Left unchecked this deadlocks every approval chain that walks the tree.
    if (cycles) {
      throw ApiError.badRequest('That reporting line would create a circular hierarchy');
    }
  }

  const before = existing.toObject();

  /**
   * Salary totals are re-derived on update too.
   *
   * The model's pre-validate hook covers document saves, but `findOneAndUpdate`
   * does not run document middleware -- so without this an edited component
   * would leave gross, deductions and net stale, and the record would disagree
   * with itself. Merged with the stored values first, because a partial update
   * may send only one component.
   */
  if (update.salaryStructure) {
    const merged = { ...(before.salaryStructure ?? {}), ...update.salaryStructure };
    update.salaryStructure = { ...merged, ...deriveSalaryTotals(merged) };
  }

  /**
   * Overtime is re-derived on the same path and for the same reason.
   *
   * It also depends on gross, so it is computed after the salary merge above --
   * changing basic must move the hourly rate with it, not leave a stale figure
   * that payroll would then pay against.
   */
  if (update.overtime || update.salaryStructure || update.overtimeEligible !== undefined) {
    const mergedOvertime = { ...(before.overtime ?? {}), ...(update.overtime ?? {}) };

    // The section toggle wins when supplied; otherwise the legacy top-level
    // flag can still drive eligibility.
    if (update.overtime?.eligible === undefined && update.overtimeEligible !== undefined) {
      mergedOvertime.eligible = update.overtimeEligible;
    }

    const gross =
      update.salaryStructure?.grossSalary ?? before.salaryStructure?.grossSalary ?? 0;

    /**
     * Priced against the current month, because that is the only month an
     * employee record can meaningfully claim. The figure is what the Employee
     * Master displays; the payroll run re-derives it for the month it pays.
     */
    update.overtime = { ...mergedOvertime, ...deriveOvertimeRate(mergedOvertime, gross) };
    update.overtimeEligible = mergedOvertime.eligible;
  }

  const updated = await employeeRepository.updateById(id, {
    $set: { ...update, updatedBy: req.user.id },
  });

  await syncAttachmentFolder(before, updated, req);

  /**
   * Keeps the payroll structure in step with the master record.
   *
   * Run on every update rather than only when `salaryStructure` is in the
   * payload, because overtime eligibility and the joining date feed the
   * projection too, and a conditional here is one more place for the two to
   * drift apart.
   */
  await syncSalaryStructure(updated, req);

  /**
   * And keeps stored attendance in step with the overtime settings.
   *
   * Overtime is derived when a day is written, from the eligibility and duty
   * hours in force at that moment, so switching eligibility on afterwards left
   * every existing day at nil -- the grid showed 00:00 while the edit dialog,
   * which recomputes live, showed the real figure. Runs only when one of those
   * two settings actually moved.
   */
  await syncOvertimeAfterEmployeeChange(before, updated);

  /**
   * `depopulate` matters here.
   *
   * The repository returns the updated document with its references populated,
   * while `before` holds them as plain ObjectIds. Diffing the two as-is
   * compared an id against a whole sub-document and recorded the change as a
   * JSON blob -- `departmentId: 6a72... -> {"_id":"...","name":"Engineering"}`
   * -- which is unreadable and, worse, makes the entry impossible to resolve
   * back to a department. Both sides must be the same shape.
   */
  const changes = diffObjects(before, updated.toObject({ depopulate: true }));

  if (changes.length) {
    await recordAudit({
      req,
      entity: ENTITY,
      entityId: updated._id,
      entityLabel: `${updated.employeeCode} - ${updated.fullName}`,
      action: AUDIT_ACTIONS.UPDATE,
      changes,
    });
  }

  return maskSensitive(updated.toObject({ virtuals: true }), req.user);
};

/* -------------------------------------------------------------------------- */
/*                              Lifecycle change                              */
/* -------------------------------------------------------------------------- */

/**
 * Status changes go through here rather than `updateEmployee` because each
 * transition carries its own required dates and its own legality check.
 */
export const changeStatus = async (id, { status, effectiveDate, reason, ...details }, req) => {
  const employee = await employeeRepository.findById(id, { populate: false });
  if (!employee) throw ApiError.notFound('Employee not found');
  assertSameTenant(employee, req);

  const allowed = EMPLOYEE_STATUS_TRANSITIONS[employee.status] ?? [];
  if (!allowed.includes(status)) {
    throw ApiError.badRequest(
      `An employee cannot move from ${employee.status} to ${status}`,
      { from: employee.status, allowed },
    );
  }

  const lifecycle = { ...(employee.lifecycle?.toObject?.() ?? employee.lifecycle ?? {}) };
  const when = effectiveDate ? new Date(effectiveDate) : new Date();

  switch (status) {
    case EMPLOYEE_STATUS.NOTICE_PERIOD:
      lifecycle.noticeStartDate = when;
      lifecycle.resignationDate = details.resignationDate ?? when;
      lifecycle.noticePeriodDays = details.noticePeriodDays ?? lifecycle.noticePeriodDays;
      lifecycle.lastWorkingDate = details.lastWorkingDate ?? lifecycle.lastWorkingDate;
      lifecycle.exitReason = reason ?? lifecycle.exitReason;
      break;

    case EMPLOYEE_STATUS.RESIGNED:
      lifecycle.resignationDate = lifecycle.resignationDate ?? when;
      lifecycle.lastWorkingDate = details.lastWorkingDate ?? when;
      lifecycle.exitReason = reason ?? lifecycle.exitReason;
      break;

    case EMPLOYEE_STATUS.TERMINATED:
      lifecycle.terminationDate = when;
      lifecycle.lastWorkingDate = details.lastWorkingDate ?? when;
      lifecycle.exitReason = reason ?? lifecycle.exitReason;
      // Termination defaults to not rehireable; an explicit flag can override.
      lifecycle.rehireEligible = details.rehireEligible ?? false;
      break;

    case EMPLOYEE_STATUS.RETIRED:
      lifecycle.retirementDate = when;
      lifecycle.lastWorkingDate = details.lastWorkingDate ?? when;
      break;

    case EMPLOYEE_STATUS.ACTIVE:
      // Confirmation out of probation, or a withdrawn resignation: clear the
      // exit trail so a stale last-working-date cannot strand payroll.
      lifecycle.noticeStartDate = null;
      lifecycle.resignationDate = null;
      lifecycle.lastWorkingDate = null;
      lifecycle.exitReason = null;
      break;

    default:
      break;
  }

  const set = { status, lifecycle, updatedBy: req.user.id };
  if (status === EMPLOYEE_STATUS.ACTIVE && employee.status === EMPLOYEE_STATUS.PROBATION) {
    set.confirmationDate = when;
  }

  const updated = await employeeRepository.updateById(id, { $set: set });

  await recordAudit({
    req,
    entity: ENTITY,
    entityId: updated._id,
    entityLabel: `${updated.employeeCode} - ${updated.fullName}`,
    action: AUDIT_ACTIONS.STATUS_CHANGE,
    changes: [{ field: 'status', from: employee.status, to: status }],
    metadata: { effectiveDate: when, reason: reason ?? null },
  });

  logger.info('Employee status changed', {
    employeeId: String(id),
    from: employee.status,
    to: status,
  });

  return maskSensitive(updated.toObject({ virtuals: true }), req.user);
};

/* -------------------------------------------------------------------------- */
/*                            Soft delete / restore                           */
/* -------------------------------------------------------------------------- */

/**
 * Deletes an employee.
 *
 * The delete is soft and `restoreEmployee` undoes it, so the attachment folder
 * is NOT removed by default. Deleting the files would make a restore return an
 * employee whose documents had silently gone -- the record would come back and
 * the passport scan would not.
 *
 * `purgeAttachments` is the caller saying, explicitly, that the files should go
 * too. The screen asks for it as a separate confirmation and defaults it off,
 * and the audit entry records which of the two happened.
 */
export const deleteEmployee = async (id, reason, req, { purgeAttachments = false } = {}) => {
  const employee = await employeeRepository.findById(id, { populate: false });
  if (!employee) throw ApiError.notFound('Employee not found');
  assertSameTenant(employee, req);

  const documentCount = (employee.documents ?? []).length;

  const deleted = await employeeRepository.softDelete(id, { deletedBy: req.user.id, reason });

  let attachmentsRemoved = false;

  if (purgeAttachments) {
    attachmentsRemoved = await removeEmployeeFolder(employee.employeeCode);

    // The metadata goes with the files. Leaving it would list documents whose
    // download endpoint could only ever answer "the stored file is missing".
    await employeeRepository.updateById(id, { $set: { documents: [] } });
  }

  await recordAudit({
    req,
    entity: ENTITY,
    entityId: deleted._id,
    entityLabel: `${deleted.employeeCode} - ${deleted.fullName}`,
    action: AUDIT_ACTIONS.DELETE,
    changes: [{ field: 'deletedAt', from: null, to: deleted.deletedAt.toISOString() }],
    metadata: {
      reason: reason ?? null,
      purgeAttachments,
      attachmentsRemoved,
      documentsDiscarded: purgeAttachments ? documentCount : 0,
    },
  });

  return { id: String(deleted._id), deletedAt: deleted.deletedAt, attachmentsRemoved };
};

export const restoreEmployee = async (id, req) => {
  const employee = await employeeRepository.findById(id, { includeDeleted: true, populate: false });
  if (!employee) throw ApiError.notFound('Employee not found');
  assertSameTenant(employee, req);
  if (!employee.deletedAt) throw ApiError.badRequest('This employee is not deleted');

  // Uniqueness is scoped to live rows, so a code or email may have been taken
  // in the meantime. Restoring blindly would violate the index.
  await assertUniqueIdentifiers(req.user.tenantId ?? null, employee.toObject(), id);

  const restored = await employeeRepository.restore(id);

  await recordAudit({
    req,
    entity: ENTITY,
    entityId: restored._id,
    entityLabel: `${restored.employeeCode} - ${restored.fullName}`,
    action: AUDIT_ACTIONS.RESTORE,
    changes: [{ field: 'deletedAt', from: employee.deletedAt.toISOString(), to: null }],
  });

  return maskSensitive(restored.toObject({ virtuals: true }), req.user);
};

/* -------------------------------------------------------------------------- */
/*                          Attachments & audit trail                         */
/* -------------------------------------------------------------------------- */

export const attachPhoto = async (id, file, req) => {
  const employee = await employeeRepository.findById(id, { populate: false });
  if (!employee) throw ApiError.notFound('Employee not found');
  assertSameTenant(employee, req);

  const photo = {
    fileName: file.originalname,
    filePath: `/uploads/avatars/${file.filename}`,
    mimeType: file.mimetype,
    size: file.size,
    uploadedAt: new Date(),
  };

  const updated = await employeeRepository.updateById(id, {
    $set: { photo, updatedBy: req.user.id },
  });

  await recordAudit({
    req,
    entity: ENTITY,
    entityId: id,
    entityLabel: `${employee.employeeCode} - ${employee.fullName}`,
    action: AUDIT_ACTIONS.UPLOAD,
    metadata: { kind: 'photo', size: file.size },
  });

  return updated.photo;
};

export const attachDocuments = async (id, files, meta, req) => {
  const employee = await employeeRepository.findById(id, { populate: false });
  if (!employee) throw ApiError.notFound('Employee not found');
  assertSameTenant(employee, req);

  const documents = files.map((file, index) => ({
    type: meta?.types?.[index] ?? meta?.type ?? 'OTHER',
    title: meta?.titles?.[index] ?? file.originalname,
    fileName: file.originalname,
    filePath: `/uploads/documents/${file.filename}`,
    mimeType: file.mimetype,
    size: file.size,
    expiresAt: meta?.expiresAt?.[index] ?? null,
    uploadedBy: req.user.id,
    uploadedAt: new Date(),
  }));

  const updated = await employeeRepository.updateById(id, {
    $push: { documents: { $each: documents } },
    $set: { updatedBy: req.user.id },
  });

  await recordAudit({
    req,
    entity: ENTITY,
    entityId: id,
    entityLabel: `${employee.employeeCode} - ${employee.fullName}`,
    action: AUDIT_ACTIONS.UPLOAD,
    metadata: { kind: 'documents', count: documents.length },
  });

  return updated.documents;
};

export const removeDocument = async (id, documentId, req) => {
  const employee = await employeeRepository.findById(id, { populate: false });
  if (!employee) throw ApiError.notFound('Employee not found');
  assertSameTenant(employee, req);

  const updated = await employeeRepository.updateById(id, {
    $pull: { documents: { _id: documentId } },
    $set: { updatedBy: req.user.id },
  });

  await recordAudit({
    req,
    entity: ENTITY,
    entityId: id,
    action: AUDIT_ACTIONS.DELETE,
    metadata: { kind: 'document', documentId },
  });

  return updated.documents;
};

export const getAuditTrail = async (id, pagination, req) => {
  const employee = await employeeRepository.findById(id, { includeDeleted: true, populate: false });
  if (!employee) throw ApiError.notFound('Employee not found');
  assertSameTenant(employee, req);

  return auditLogRepository.findForEntity(ENTITY, employee._id, pagination);
};

export default {
  listEmployees,
  getStatusSummary,
  getEmployee,
  createEmployee,
  updateEmployee,
  changeStatus,
  deleteEmployee,
  restoreEmployee,
  attachPhoto,
  attachDocuments,
  removeDocument,
  getAuditTrail,
  maskSensitive,
  SORTABLE_FIELDS,
};
