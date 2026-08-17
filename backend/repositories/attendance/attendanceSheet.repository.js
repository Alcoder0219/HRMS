import AttendanceSheet from '../../models/attendance/attendanceSheet.model.js';
import Attendance from '../../models/attendance/attendance.model.js';

/**
 * Monthly attendance sheets, plus the bulk projection onto daily records.
 *
 * Every write here is a `bulkWrite`. A standalone MongoDB deployment has no
 * multi-document transactions, and a 10,000-row import issued as individual
 * upserts would be 10,000 round trips -- bulkWrite is both the fast path and
 * the only atomicity available (per document, which is the granularity that
 * actually matters here since each sheet is independent).
 */

const BATCH_SIZE = 500;

/** Splits a list so one enormous import cannot exceed the 16MB command limit. */
const inBatches = (items, size = BATCH_SIZE) => {
  const batches = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
};

/* ---------------------------------------------------------------- sheets -- */

export const findSheet = (employeeRef, year, month) =>
  AttendanceSheet.findOne({ employeeRef, year, month });

export const findSheetById = (id) =>
  AttendanceSheet.findById(id).populate({
    path: 'employeeRef',
    select: 'employeeCode employeeId firstName lastName departmentId',
  });

export const findSheetsForPeriod = (tenantId, year, month, extra = {}) =>
  AttendanceSheet.find({ tenantId: tenantId ?? null, year, month, ...extra })
    .populate({ path: 'employeeRef', select: 'employeeCode employeeId firstName lastName departmentId' })
    .lean();

export const findExistingKeys = async (employeeRefs, year, month) => {
  const rows = await AttendanceSheet.find({ employeeRef: { $in: employeeRefs }, year, month })
    .select('employeeRef')
    .lean();

  return new Set(rows.map((row) => String(row.employeeRef)));
};

/**
 * Upserts sheets in bulk.
 *
 * `ordered: false` lets a batch continue past one rejected document, so a
 * single bad row cannot abandon the other 9,999.
 */
export const bulkUpsertSheets = async (operations) => {
  const result = { matched: 0, upserted: 0, modified: 0, errors: [] };

  for (const batch of inBatches(operations)) {
    try {
      const outcome = await AttendanceSheet.bulkWrite(batch, { ordered: false });
      result.matched += outcome.matchedCount ?? 0;
      result.upserted += outcome.upsertedCount ?? 0;
      result.modified += outcome.modifiedCount ?? 0;
    } catch (error) {
      // A bulk error still applies the successful operations; the counts live
      // on the error's result, so they are salvaged rather than lost.
      result.matched += error.result?.nMatched ?? 0;
      result.upserted += error.result?.nUpserted ?? 0;
      result.modified += error.result?.nModified ?? 0;
      (error.writeErrors ?? []).forEach((writeError) =>
        result.errors.push(writeError.errmsg ?? String(writeError)),
      );
    }
  }

  return result;
};

/** Projects computed days onto the operational daily collection, in bulk. */
export const bulkUpsertDays = async (operations) => {
  const result = { upserted: 0, modified: 0, errors: [] };

  for (const batch of inBatches(operations)) {
    try {
      const outcome = await Attendance.bulkWrite(batch, { ordered: false });
      result.upserted += outcome.upsertedCount ?? 0;
      result.modified += outcome.modifiedCount ?? 0;
    } catch (error) {
      result.upserted += error.result?.nUpserted ?? 0;
      result.modified += error.result?.nModified ?? 0;
      (error.writeErrors ?? []).forEach((writeError) =>
        result.errors.push(writeError.errmsg ?? String(writeError)),
      );
    }
  }

  return result;
};

export const updateSheet = (id, update) =>
  AttendanceSheet.findByIdAndUpdate(id, update, { new: true, runValidators: true });

export const deleteSheet = (id) => AttendanceSheet.findByIdAndDelete(id);

/**
 * Removes the daily records a sheet produced.
 *
 * Locked days are left alone: payroll has already been paid against them, and
 * deleting an uploaded sheet must not silently change a paid figure.
 */
export const deleteDaysForSheet = (employeeRef, year, month) => {
  const from = new Date(year, month - 1, 1);
  const to = new Date(year, month, 0, 23, 59, 59, 999);

  return Attendance.deleteMany({ employeeId: employeeRef, date: { $gte: from, $lte: to }, isLocked: false });
};

export const listSheets = async ({ filter, sort, skip, limit }) => {
  const [items, total] = await Promise.all([
    AttendanceSheet.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate({ path: 'employeeRef', select: 'employeeCode employeeId firstName lastName departmentId' })
      .lean({ virtuals: true }),
    AttendanceSheet.countDocuments(filter),
  ]);

  return { items, total };
};

/** Every sheet written by one upload -- the unit a bad import is reversed by. */
export const findByBatch = (importBatchId) => AttendanceSheet.find({ importBatchId }).lean();

export default {
  findSheet,
  findSheetById,
  findSheetsForPeriod,
  findExistingKeys,
  bulkUpsertSheets,
  bulkUpsertDays,
  updateSheet,
  deleteSheet,
  deleteDaysForSheet,
  listSheets,
  findByBatch,
};
