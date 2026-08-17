import crypto from 'node:crypto';
import logger from '../../config/logger.js';
import ApiError from '../../utils/ApiError.js';
import {
  ACTIVE_EMPLOYEE_STATUSES,
  ATTENDANCE_SOURCE,
  ATTENDANCE_STATUS,
  AUDIT_ACTIONS,
} from '../../utils/constants.js';

import Employee from '../../models/employee/employee.model.js';
import Shift from '../../models/organization/shift.model.js';
import Unit from '../../models/organization/unit.model.js';
import attendanceRepository from '../../repositories/attendance/attendance.repository.js';
import sheetRepository from '../../repositories/attendance/attendanceSheet.repository.js';

import { parseAttendanceWorkbook } from '../../helpers/attendanceSheet.helper.js';
import { startOfDay } from '../../helpers/attendanceRules.helper.js';
// Imported days are derived exactly as hand-entered days are. See the helper.
import { deriveManualDay, resolveWeeklyOffDays } from '../../helpers/manualAttendance.helper.js';
import { recordAudit } from '../../helpers/audit.helper.js';

/** How a month that already has data should be handled. */
export const DUPLICATE_STRATEGY = {
  REPLACE: 'REPLACE',
  MERGE: 'MERGE',
  SKIP: 'SKIP',
};

/* -------------------------------------------------------------------------- */
/*                              Employee lookup                               */
/* -------------------------------------------------------------------------- */

/**
 * Resolves uploaded identifiers to employees in one query.
 *
 * Matched on `employeeId` first -- the organisation's own number, which is what
 * the sheet is keyed by -- then on `employeeCode`, because in practice the two
 * are used interchangeably by whoever exports the biometric report. Names are
 * never matched on: they are not unique and the specification is explicit that
 * they are for display only.
 */
const resolveEmployees = async (tenantId, identifiers) => {
  const wanted = [...new Set(identifiers.filter(Boolean).map((value) => String(value).trim()))];
  if (!wanted.length) return new Map();

  const upper = wanted.map((value) => value.toUpperCase());

  const employees = await Employee.find({
    tenantId: tenantId ?? null,
    deletedAt: null,
    $or: [{ employeeId: { $in: wanted } }, { employeeCode: { $in: upper } }],
  })
    .select('employeeCode employeeId firstName middleName lastName status shiftId departmentId unitId overtime overtimeEligible standardDutyMinutes')
    .lean();

  const byIdentifier = new Map();
  employees.forEach((employee) => {
    if (employee.employeeId) byIdentifier.set(String(employee.employeeId).toUpperCase(), employee);
    // Registered under the code too, but never overwriting an employeeId match.
    if (employee.employeeCode && !byIdentifier.has(employee.employeeCode)) {
      byIdentifier.set(employee.employeeCode, employee);
    }
  });

  return byIdentifier;
};

/* -------------------------------------------------------------------------- */
/*                                 Validation                                 */
/* -------------------------------------------------------------------------- */

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Validates every row and classifies the problems.
 *
 * Returns the full picture in one pass so the preview screen can show counts
 * per category. Nothing is written here -- this is what the Preview step calls.
 */
export const validateWorkbook = async (buffer, { year, month, fileName }, req) => {
  const tenantId = req.user.tenantId ?? null;

  const { rows, truncated, dayColumns } = await parseAttendanceWorkbook(buffer);
  if (!rows.length) throw ApiError.badRequest('The uploaded file contains no employee rows');

  const employees = await resolveEmployees(tenantId, rows.map((row) => row.employeeId));

  const units = await Unit.find({ tenantId, isActive: true }).select('name code').lean();
  const unitByName = new Map(
    units.flatMap((unit) => [
      [unit.name.toLowerCase(), unit],
      [unit.code.toLowerCase(), unit],
    ]),
  );

  const daysInMonth = new Date(year, month, 0).getDate();

  const valid = [];
  const invalid = [];
  const buckets = {
    missingEmployeeId: [],
    unknownEmployee: [],
    duplicateRows: [],
    invalidTime: [],
    wrongMonth: [],
    inactiveEmployee: [],
    dayOutOfRange: [],
    unknownUnit: [],
  };

  const seen = new Map();

  for (const row of rows) {
    const errors = [];

    /* --- identity ------------------------------------------------------ */
    if (!row.employeeId) {
      errors.push('Employee ID is required');
      buckets.missingEmployeeId.push(row.rowNumber);
    }

    const employee = row.employeeId
      ? employees.get(String(row.employeeId).trim().toUpperCase())
      : null;

    if (row.employeeId && !employee) {
      errors.push(`Employee ID "${row.employeeId}" does not exist in the Employee Master`);
      buckets.unknownEmployee.push({ row: row.rowNumber, employeeId: row.employeeId, name: row.employeeName });
    }

    if (employee && !ACTIVE_EMPLOYEE_STATUSES.includes(employee.status)) {
      // Not fatal: a leaver still has a final month of attendance to import.
      buckets.inactiveEmployee.push({ row: row.rowNumber, employeeId: row.employeeId, status: employee.status });
    }

    /* --- duplicates within the file ------------------------------------ */
    if (employee) {
      const key = String(employee._id);
      if (seen.has(key)) {
        errors.push(`Duplicate of row ${seen.get(key)} — the same employee appears twice`);
        buckets.duplicateRows.push({ row: row.rowNumber, firstSeen: seen.get(key), employeeId: row.employeeId });
      } else {
        seen.set(key, row.rowNumber);
      }
    }

    /* --- month --------------------------------------------------------- */
    // The sheet carries a month but no year, so the period comes from the
    // upload form; the sheet's own month must agree with it.
    if (row.month !== undefined && row.month !== month) {
      errors.push(`Row month "${row.rawMonth}" does not match the selected period`);
      buckets.wrongMonth.push({ row: row.rowNumber, found: row.rawMonth });
    }
    if (row.rawMonth && row.month === undefined) {
      errors.push(`Month "${row.rawMonth}" is not a recognisable month`);
      buckets.wrongMonth.push({ row: row.rowNumber, found: row.rawMonth });
    }

    /* --- times --------------------------------------------------------- */
    if (row.timeErrors.length) {
      errors.push(`Unreadable time: ${row.timeErrors.slice(0, 3).join(', ')}`);
      buckets.invalidTime.push({ row: row.rowNumber, details: row.timeErrors });
    }

    const cleanDays = [];
    for (const entry of row.attendance) {
      if (entry.day > daysInMonth) {
        // February never has 31 days; silently importing one would produce a
        // record for a date that does not exist.
        buckets.dayOutOfRange.push({ row: row.rowNumber, day: entry.day });
        continue;
      }

      if (entry.inTime && !TIME_PATTERN.test(entry.inTime)) errors.push(`Day ${entry.day} in-time is not HH:mm`);
      if (entry.outTime && !TIME_PATTERN.test(entry.outTime)) errors.push(`Day ${entry.day} out-time is not HH:mm`);

      cleanDays.push(entry);
    }

    /* --- unit ---------------------------------------------------------- */
    const unit = row.unit ? unitByName.get(row.unit.toLowerCase()) : null;
    if (row.unit && !unit) {
      buckets.unknownUnit.push({ row: row.rowNumber, unit: row.unit });
    }

    if (errors.length) {
      invalid.push({
        row: row.rowNumber,
        employeeId: row.employeeId,
        employeeName: row.employeeName,
        errors,
      });
      continue;
    }

    valid.push({
      rowNumber: row.rowNumber,
      employee,
      employeeId: row.employeeId,
      employeeName: row.employeeName,
      unit: row.unit,
      unitId: unit?._id ?? null,
      attendance: cleanDays,
    });
  }

  /* --- months already uploaded ------------------------------------------ */
  const existing = await sheetRepository.findExistingKeys(
    valid.map((entry) => entry.employee._id),
    year,
    month,
  );

  return {
    fileName: fileName ?? null,
    year,
    month,
    dayColumns,
    truncated,
    totalRows: rows.length,
    validCount: valid.length,
    invalidCount: invalid.length,
    duplicateMonthCount: valid.filter((entry) => existing.has(String(entry.employee._id))).length,
    buckets: {
      missingEmployeeId: buckets.missingEmployeeId.length,
      unknownEmployee: buckets.unknownEmployee.length,
      duplicateRows: buckets.duplicateRows.length,
      invalidTime: buckets.invalidTime.length,
      wrongMonth: buckets.wrongMonth.length,
      inactiveEmployee: buckets.inactiveEmployee.length,
      dayOutOfRange: buckets.dayOutOfRange.length,
      unknownUnit: buckets.unknownUnit.length,
    },
    details: {
      unknownEmployee: buckets.unknownEmployee.slice(0, 100),
      duplicateRows: buckets.duplicateRows.slice(0, 100),
      invalidTime: buckets.invalidTime.slice(0, 100),
      wrongMonth: buckets.wrongMonth.slice(0, 100),
      inactiveEmployee: buckets.inactiveEmployee.slice(0, 100),
      unknownUnit: buckets.unknownUnit.slice(0, 100),
    },
    // Capped so a 10,000-row file does not return a 20MB preview payload.
    invalid: invalid.slice(0, 200),
    invalidTruncated: invalid.length > 200,
    preview: valid.slice(0, 25).map((entry) => ({
      employeeId: entry.employeeId,
      employeeCode: entry.employee.employeeCode,
      employeeName: [entry.employee.firstName, entry.employee.lastName].filter(Boolean).join(' '),
      unit: entry.unit,
      daysPresent: entry.attendance.length,
      alreadyUploaded: existing.has(String(entry.employee._id)),
    })),
    // Carried to the commit step so the file is parsed once, not twice.
    _valid: valid,
    _existing: existing,
  };
};

/* -------------------------------------------------------------------------- */
/*                                   Commit                                   */
/* -------------------------------------------------------------------------- */

const toDate = (year, month, day, time) => {
  const [hours, minutes] = time.split(':').map(Number);
  return new Date(year, month - 1, day, hours, minutes, 0, 0);
};

/**
 * Builds the daily records a sheet implies.
 *
 * The sheet is the authority. Working hours are the span between the two times
 * in the workbook and overtime is that span less the employee's own duty hours
 * -- the same two lines the manual edit dialog runs, so an imported day and a
 * hand-corrected day can never report different hours for the same times.
 *
 * The shift rules engine no longer runs here. It used to decide the status from
 * the roster and the holiday calendar, which meant a blank Sunday came back as
 * WEEKLY_OFF and a short day as HALF_DAY whatever the sheet said. Nothing in
 * the file format changes: the workbook is parsed and validated exactly as
 * before, and only the arithmetic applied afterwards is different.
 *
 * Still built in memory and written with a handful of bulkWrite calls, so a
 * 310,000 employee-day import stays a matter of seconds.
 */
const buildDayOperations = ({ entry, year, month, shift, weeklyOffDays = null, userId }) => {
  const operations = [];
  const summary = {
    present: 0, absent: 0, halfDay: 0, weeklyOff: 0, holiday: 0,
    lateComing: 0, earlyGoing: 0, missingPunch: 0,
    workedMinutes: 0, overtimeMinutes: 0, payableDays: 0,
  };

  const byDay = new Map(entry.attendance.map((day) => [day.day, day]));
  const daysInMonth = new Date(year, month, 0).getDate();

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = startOfDay(new Date(year, month - 1, day));
    const uploaded = byDay.get(day);

    const punches = [];
    if (uploaded?.inTime) {
      punches.push({ time: toDate(year, month, day, uploaded.inTime), source: ATTENDANCE_SOURCE.CSV, direction: 'IN' });
    }
    if (uploaded?.outTime) {
      punches.push({ time: toDate(year, month, day, uploaded.outTime), source: ATTENDANCE_SOURCE.CSV, direction: 'OUT' });
    }

    const evaluation = deriveManualDay({
      checkIn: punches.find((punch) => punch.direction === 'IN')?.time ?? null,
      checkOut: punches.find((punch) => punch.direction === 'OUT')?.time ?? null,
      status: null,
      employee: entry.employee,
      // A Sunday in the sheet comes through as PRESENT like any other worked
      // day, so the roster is what tells the arithmetic it was a rest day.
      date,
      weeklyOffDays,
    });

    /**
     * A day the sheet says nothing about does not overwrite what is already
     * stored.
     *
     * Blank cells carry no information, and the workbook has no status column,
     * so treating a blank day as a fresh ABSENT would erase an administrator's
     * hand-set Weekly Off every time the month was re-imported. Written on
     * insert only, so a first import still fills the month and a re-import
     * leaves corrections alone. Days that do carry times are authoritative and
     * always overwrite.
     */
    const blank = punches.length === 0;
    const dayFields = {
      punches,
      checkInAt: evaluation.checkInAt,
      checkOutAt: evaluation.checkOutAt,
      status: evaluation.status,
      workedMinutes: evaluation.workedMinutes,
      expectedMinutes: evaluation.expectedMinutes,
      lateMinutes: evaluation.lateMinutes,
      earlyGoingMinutes: evaluation.earlyGoingMinutes,
      overtimeMinutes: evaluation.overtimeMinutes,
      isHoliday: evaluation.isHoliday,
      isWeeklyOff: evaluation.isWeeklyOff,
    };

    operations.push({
      updateOne: {
        filter: { employeeId: entry.employee._id, date },
        update: {
          $set: {
            tenantId: entry.employee.tenantId ?? null,
            shiftId: shift?._id ?? null,
            shiftSnapshot: shift
              ? {
                  code: shift.code, name: shift.name, startTime: shift.startTime,
                  endTime: shift.endTime, breakMinutes: shift.breakMinutes, isNightShift: shift.isNightShift,
                }
              : null,
            source: ATTENDANCE_SOURCE.CSV,
            updatedBy: userId,
            ...(blank ? {} : dayFields),
          },
          $setOnInsert: { markedBy: userId, ...(blank ? dayFields : {}) },
        },
        upsert: true,
      },
    });

    /* --- roll-up ------------------------------------------------------- */
    summary.workedMinutes += evaluation.workedMinutes;
    summary.overtimeMinutes += evaluation.overtimeMinutes;

    switch (evaluation.status) {
      case ATTENDANCE_STATUS.PRESENT: summary.present += 1; summary.payableDays += 1; break;
      case ATTENDANCE_STATUS.HALF_DAY: summary.halfDay += 1; summary.payableDays += 0.5; break;
      case ATTENDANCE_STATUS.ABSENT: summary.absent += 1; break;
      case ATTENDANCE_STATUS.WEEKLY_OFF: summary.weeklyOff += 1; summary.payableDays += 1; break;
      case ATTENDANCE_STATUS.HOLIDAY: summary.holiday += 1; summary.payableDays += 1; break;
      case ATTENDANCE_STATUS.MISSING_PUNCH: summary.missingPunch += 1; break;
      default: break;
    }
  }

  return { operations, summary };
};

/**
 * Writes a validated workbook.
 *
 * The file is parsed and validated again rather than trusting a client-supplied
 * payload -- a preview response is not an authorisation to write whatever comes
 * back. Locked days are excluded so a paid month cannot be silently rewritten.
 */
export const commitImport = async (buffer, { year, month, fileName, duplicateStrategy }, req) => {
  const report = await validateWorkbook(buffer, { year, month, fileName }, req);

  if (!report._valid.length) {
    return { ...stripInternals(report), imported: 0, skipped: 0, importBatchId: null };
  }

  const tenantId = req.user.tenantId ?? null;
  const importBatchId = crypto.randomUUID();
  const from = new Date(year, month - 1, 1);
  const to = new Date(year, month, 0);

  const holidays = await attendanceRepository.findHolidays(tenantId, from, to);
  const policy = (await attendanceRepository.resolvePolicy(tenantId)) ?? {};

  // Shifts are loaded once for the whole import, not per employee.
  const shiftIds = [...new Set(report._valid.map((entry) => String(entry.employee.shiftId ?? '')).filter(Boolean))];
  const shifts = await Shift.find({ _id: { $in: shiftIds } }).lean();
  const shiftById = new Map(shifts.map((shift) => [String(shift._id), shift]));

  const sheetOperations = [];
  const dayOperations = [];
  let skipped = 0;

  for (const entry of report._valid) {
    const alreadyExists = report._existing.has(String(entry.employee._id));

    if (alreadyExists && duplicateStrategy === DUPLICATE_STRATEGY.SKIP) {
      skipped += 1;
      continue;
    }

    let attendance = entry.attendance;

    if (alreadyExists && duplicateStrategy === DUPLICATE_STRATEGY.MERGE) {
      // Merge keeps days already on file and adds only those the sheet
      // supplies, so a partial upload cannot wipe the rest of the month.
      const current = await sheetRepository.findSheet(entry.employee._id, year, month);
      const merged = new Map((current?.attendance ?? []).map((day) => [day.day, day]));
      attendance.forEach((day) => merged.set(day.day, day));
      attendance = [...merged.values()].sort((a, b) => a.day - b.day);
    }

    const shift = shiftById.get(String(entry.employee.shiftId ?? '')) ?? null;
    const { operations, summary } = buildDayOperations({
      entry: { ...entry, attendance },
      year, month, shift,
      // The tenant policy is already loaded above; the shift's own weekly offs
      // still win where it defines them.
      weeklyOffDays: resolveWeeklyOffDays(shift, policy),
      userId: req.user.id,
    });

    dayOperations.push(...operations);

    sheetOperations.push({
      updateOne: {
        filter: { employeeRef: entry.employee._id, year, month },
        update: {
          $set: {
            tenantId,
            employeeId: entry.employeeId,
            employeeName: entry.employeeName,
            unit: entry.unit,
            unitId: entry.unitId,
            attendance,
            summary,
            source: ATTENDANCE_SOURCE.CSV,
            importBatchId,
            fileName: fileName ?? null,
            updatedBy: req.user.id,
          },
          $setOnInsert: { uploadedBy: req.user.id, uploadedAt: new Date() },
        },
        upsert: true,
      },
    });
  }

  const sheetResult = await sheetRepository.bulkUpsertSheets(sheetOperations);
  const dayResult = await sheetRepository.bulkUpsertDays(dayOperations);

  await recordAudit({
    req,
    entity: 'AttendanceSheet',
    entityId: report._valid[0].employee._id,
    entityLabel: `${String(month).padStart(2, '0')}-${year}`,
    action: AUDIT_ACTIONS.IMPORT,
    metadata: {
      importBatchId,
      fileName,
      totalRows: report.totalRows,
      imported: sheetOperations.length,
      skipped,
      invalid: report.invalidCount,
      duplicateStrategy,
      daysWritten: dayOperations.length,
    },
  });

  logger.info('Attendance sheet import completed', {
    importBatchId,
    period: `${month}-${year}`,
    sheets: sheetOperations.length,
    days: dayOperations.length,
    skipped,
    invalid: report.invalidCount,
  });

  return {
    ...stripInternals(report),
    importBatchId,
    imported: sheetOperations.length,
    skipped,
    daysWritten: dayOperations.length,
    sheetWrites: { upserted: sheetResult.upserted, modified: sheetResult.modified },
    writeErrors: [...sheetResult.errors, ...dayResult.errors].slice(0, 20),
  };
};

/** Drops the internal carriers before the report crosses the API boundary. */
const stripInternals = (report) => {
  const { _valid, _existing, ...rest } = report;
  return rest;
};

export const previewImport = async (buffer, options, req) =>
  stripInternals(await validateWorkbook(buffer, options, req));

export default { previewImport, commitImport, validateWorkbook, DUPLICATE_STRATEGY };
