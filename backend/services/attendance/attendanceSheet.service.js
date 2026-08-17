import mongoose from 'mongoose';
import ApiError from '../../utils/ApiError.js';
import { AUDIT_ACTIONS, RESOURCES } from '../../utils/constants.js';
import { buildPagination, buildSort } from '../../utils/queryBuilder.js';
import Employee from '../../models/employee/employee.model.js';
import sheetRepository from '../../repositories/attendance/attendanceSheet.repository.js';
import { recordAudit } from '../../helpers/audit.helper.js';
import { buildScopeFilter } from '../../helpers/permission.helper.js';

export const SORTABLE_FIELDS = ['year', 'month', 'employeeId', 'uploadedAt', 'createdAt'];

/**
 * Read, update and delete monthly attendance sheets.
 *
 * The sheet is the uploaded artifact; the daily records it produced are the
 * operational store. Anything that changes a sheet therefore has to keep the
 * two in step, which is why edits and deletes both touch the daily collection.
 */

const assertTenant = (sheet, req) => {
  const callerTenant = req.user.tenantId ?? null;
  if (callerTenant !== null && String(sheet.tenantId) !== callerTenant) {
    throw ApiError.notFound('Attendance sheet not found');
  }
};

/** Restricts a query to the employees the caller may see. */
const scopedEmployeeFilter = async (req) => {
  const scope = buildScopeFilter(req, {
    ownerField: '_id',
    managerField: 'reportingManagerId',
    departmentField: 'departmentId',
    resource: RESOURCES.ATTENDANCE,
  });

  if (scope._id === undefined && scope.reportingManagerId === undefined && scope.departmentId === undefined) {
    return null;
  }

  const employees = await Employee.find({ ...scope, deletedAt: null }).select('_id').lean();
  return employees.map((employee) => employee._id);
};

export const listSheets = async (query, req) => {
  const { page, limit, skip } = buildPagination(query);
  const sort = buildSort(query, SORTABLE_FIELDS, { year: -1, month: -1 });

  const filter = { tenantId: req.user.tenantId ?? null };
  if (query.year) filter.year = query.year;
  if (query.month) filter.month = query.month;
  if (query.employeeId) filter.employeeId = query.employeeId;
  if (query.importBatchId) filter.importBatchId = query.importBatchId;

  const allowed = await scopedEmployeeFilter(req);
  if (allowed) filter.employeeRef = { $in: allowed };

  const { items, total } = await sheetRepository.listSheets({ filter, sort, skip, limit });
  return { items, total, page, limit };
};

/**
 * One employee's month.
 *
 * Serves the "Employee Monthly Attendance" report directly from the sheet, so
 * it costs one document read rather than an aggregation over 31 daily rows.
 */
export const getMonth = async ({ employeeId, year, month }, req) => {
  const tenantId = req.user.tenantId ?? null;

  /**
   * The identifier may be an ObjectId, an employee ID or an employee code.
   *
   * `_id` is only included when the value actually looks like an ObjectId --
   * Mongoose throws on a failed cast, which would take down the whole `$or`
   * and turn every lookup by employee ID into "not found".
   */
  const conditions = [
    { employeeId },
    { employeeCode: String(employeeId).toUpperCase() },
  ];
  if (mongoose.Types.ObjectId.isValid(employeeId)) conditions.unshift({ _id: employeeId });

  const employee = await Employee.findOne({ tenantId, deletedAt: null, $or: conditions })
    .select('_id employeeCode employeeId firstName lastName')
    .lean();

  if (!employee) throw ApiError.notFound('Employee not found');

  const allowed = await scopedEmployeeFilter(req);
  if (allowed && !allowed.some((id) => String(id) === String(employee._id))) {
    throw ApiError.forbidden('You can only view your own attendance');
  }

  const sheet = await sheetRepository.findSheet(employee._id, year, month);
  if (!sheet) throw ApiError.notFound('No attendance has been uploaded for this employee and month');

  return sheet.toObject({ virtuals: true });
};

/**
 * Corrects one or more days on a sheet.
 *
 * The daily records are NOT rewritten here. Re-running the rules engine from a
 * service that only holds a sheet would duplicate the import's projection
 * logic; instead the caller re-imports, or corrects the day through the
 * existing manual-marking endpoint which already recomputes properly. The sheet
 * edit exists so the uploaded artifact can be corrected for the audit record.
 */
export const updateSheet = async (id, { attendance, unit, remarks }, req) => {
  const target = await sheetRepository.findSheetById(id);
  if (!target) throw ApiError.notFound('Attendance sheet not found');
  assertTenant(target, req);

  const merged = new Map((target.attendance ?? []).map((day) => [day.day, day]));
  (attendance ?? []).forEach((day) => merged.set(day.day, day));

  const updated = await sheetRepository.updateSheet(id, {
    $set: {
      attendance: [...merged.values()].sort((a, b) => a.day - b.day),
      ...(unit !== undefined ? { unit } : {}),
      ...(remarks !== undefined ? { remarks } : {}),
      updatedBy: req.user.id,
    },
  });

  await recordAudit({
    req,
    entity: 'AttendanceSheet',
    entityId: id,
    entityLabel: `${target.employeeId} ${target.month}-${target.year}`,
    action: AUDIT_ACTIONS.UPDATE,
    metadata: { daysChanged: (attendance ?? []).length },
  });

  return updated;
};

/**
 * Deletes a sheet and the daily records it produced.
 *
 * Locked days survive: payroll has been paid against them, and removing an
 * upload must not silently change a paid figure.
 */
export const deleteSheet = async (id, req) => {
  const target = await sheetRepository.findSheetById(id);
  if (!target) throw ApiError.notFound('Attendance sheet not found');
  assertTenant(target, req);

  const removedDays = await sheetRepository.deleteDaysForSheet(
    target.employeeRef?._id ?? target.employeeRef,
    target.year,
    target.month,
  );
  await sheetRepository.deleteSheet(id);

  await recordAudit({
    req,
    entity: 'AttendanceSheet',
    entityId: id,
    entityLabel: `${target.employeeId} ${target.month}-${target.year}`,
    action: AUDIT_ACTIONS.DELETE,
    metadata: { dailyRecordsRemoved: removedDays.deletedCount ?? 0 },
  });

  return { id, dailyRecordsRemoved: removedDays.deletedCount ?? 0 };
};

export default { listSheets, getMonth, updateSheet, deleteSheet, SORTABLE_FIELDS };
