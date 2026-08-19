import logger from '../../config/logger.js';
import ApiError from '../../utils/ApiError.js';
import { ATTENDANCE_SOURCE, AUDIT_ACTIONS } from '../../utils/constants.js';
import attendanceRepository from '../../repositories/attendance/attendance.repository.js';
import employeeRepository from '../../repositories/employee/employee.repository.js';
import Employee from '../../models/employee/employee.model.js';
import { startOfDay } from '../../helpers/attendanceRules.helper.js';
import { parseWorkbook, buildWorkbook } from '../../helpers/excel.helper.js';
import { recordAudit } from '../../helpers/audit.helper.js';
import { recomputeDay, loadDayContext } from './attendance.service.js';

/**
 * Bulk ingestion: biometric device pushes and spreadsheet uploads.
 *
 * Both share one shape -- resolve employees by code, group punches by
 * employee-day, append, then recompute each affected day exactly once. The
 * grouping matters: a device sending eight punches for one person would
 * otherwise trigger eight recomputes of the same day.
 */

export const IMPORT_COLUMNS = [
  { header: 'Employee Code', key: 'employeeCode', width: 16, required: true },
  { header: 'Date', key: 'date', width: 14, required: true },
  { header: 'Check In', key: 'checkIn', width: 14 },
  { header: 'Check Out', key: 'checkOut', width: 14 },
  { header: 'Status', key: 'status', width: 16 },
  { header: 'Remarks', key: 'remarks', width: 28 },
];

/**
 * Accepts a Date, an Excel serial, `YYYY-MM-DD HH:mm`, or a bare `HH:mm`
 * against a known day. Spreadsheets are inconsistent about which they produce,
 * and rejecting all but one shape makes the importer unusable in practice.
 */
const parseDateTime = (value, dayHint = null) => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;

  const text = String(value).trim();

  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(text) && dayHint) {
    const [hours, minutes] = text.split(':').map(Number);
    const result = new Date(dayHint);
    result.setHours(hours, minutes, 0, 0);
    return result;
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

/** Resolves employee codes to records in one query rather than per row. */
const loadEmployeeMap = async (tenantId, codes) => {
  const unique = [...new Set(codes.filter(Boolean).map((code) => String(code).toUpperCase()))];
  if (!unique.length) return new Map();

  const employees = await Employee.find({
    tenantId: tenantId ?? null,
    employeeCode: { $in: unique },
    deletedAt: null,
  })
    .populate([{ path: 'departmentId', select: '_id' }])
    .lean();

  return new Map(employees.map((employee) => [employee.employeeCode, employee]));
};

/**
 * Applies grouped punches and recomputes each affected day once.
 *
 * The day context (shift, policy, holidays) is loaded per employee-day; a
 * shared holiday list is passed down so a 5,000-punch batch does not re-query
 * the calendar for every row.
 */
const applyGroups = async (groups, { source, req }) => {
  let applied = 0;
  const failures = [];

  for (const [key, group] of groups) {
    try {
      await attendanceRepository.upsertDay(group.employee._id, group.day, {
        set: { tenantId: group.employee.tenantId ?? null },
        setOnInsert: { markedBy: req?.user?.id ?? null, source },
        push: { punches: { $each: group.punches } },
      });

      const context = await loadDayContext(group.employee, group.day, {
        holidays: group.holidays,
      });

      await recomputeDay(group.employee, group.day, { context, req, source });
      applied += 1;
    } catch (error) {
      logger.error('Failed to apply attendance batch entry', { key, error: error.message });
      failures.push({ key, error: error.message });
    }
  }

  return { applied, failures };
};

/* -------------------------------------------------------------------------- */
/*                              Biometric ingest                              */
/* -------------------------------------------------------------------------- */

/**
 * Device push endpoint, and the one path every biometric punch takes.
 *
 * Deliberately tolerant of unknown employee codes and duplicate timestamps:
 * a turnstile pushes what it read, and rejecting an entire batch because one
 * badge is unrecognised would lose a day of real attendance for everyone else.
 * Unknown codes are reported back so the device roster can be reconciled.
 *
 * `auditEntityId` names what the audit entry points at. It defaults to the
 * calling user, which is right for a push made through the API, but a scheduled
 * device sync has no user behind it -- and `entityId` is required on an audit
 * log, so without this the entry for every automatic sync would fail
 * validation and be dropped. Those callers pass the device instead.
 */
export const ingestBiometric = async ({ deviceId, punches = [], auditEntityId = null }, req) => {
  if (!punches.length) throw ApiError.badRequest('No punches were supplied');

  const tenantId = req.user.tenantId ?? null;
  const employees = await loadEmployeeMap(tenantId, punches.map((punch) => punch.employeeCode));

  const unknownCodes = new Set();
  const invalidRows = [];
  const groups = new Map();

  // One calendar fetch for the whole batch window.
  const times = punches.map((punch) => new Date(punch.timestamp)).filter((date) => !Number.isNaN(date));
  const holidays = times.length
    ? await attendanceRepository.findHolidays(
        tenantId,
        new Date(Math.min(...times)),
        new Date(Math.max(...times)),
      )
    : [];

  punches.forEach((punch, index) => {
    const code = String(punch.employeeCode ?? '').toUpperCase();
    const employee = employees.get(code);

    if (!employee) {
      unknownCodes.add(code || `(row ${index + 1})`);
      return;
    }

    const time = new Date(punch.timestamp);
    if (Number.isNaN(time.getTime())) {
      invalidRows.push({ index, reason: 'Unreadable timestamp' });
      return;
    }

    const day = startOfDay(time);
    const key = `${employee._id}-${day.getTime()}`;

    if (!groups.has(key)) {
      groups.set(key, { employee, day, punches: [], holidays });
    }

    groups.get(key).punches.push({
      time,
      source: ATTENDANCE_SOURCE.BIOMETRIC,
      direction: punch.direction ?? 'UNKNOWN',
      deviceId: deviceId ?? punch.deviceId ?? null,
      note: punch.note ?? null,
    });
  });

  const { applied, failures } = await applyGroups(groups, {
    source: ATTENDANCE_SOURCE.BIOMETRIC,
    req,
  });

  await recordAudit({
    req,
    entity: 'Attendance',
    entityId: auditEntityId ?? employeeRepository.toObjectId(req.user.id),
    action: AUDIT_ACTIONS.IMPORT,
    metadata: {
      source: 'BIOMETRIC',
      deviceId,
      received: punches.length,
      daysUpdated: applied,
      unknownCodes: [...unknownCodes],
    },
  });

  logger.info('Biometric batch ingested', {
    deviceId,
    received: punches.length,
    daysUpdated: applied,
    unknown: unknownCodes.size,
  });

  return {
    received: punches.length,
    daysUpdated: applied,
    unknownEmployeeCodes: [...unknownCodes],
    invalidRows,
    failures,
  };
};

/* -------------------------------------------------------------------------- */
/*                               File ingest                                  */
/* -------------------------------------------------------------------------- */

export const buildImportTemplate = () =>
  buildWorkbook({ sheetName: 'Attendance Import', columns: IMPORT_COLUMNS, rows: [] });

/**
 * Spreadsheet upload.
 *
 * Validates every row before writing any, and `dryRun` writes nothing at all --
 * the same two-step contract as the employee importer, for the same reason: a
 * month of attendance for a few hundred people always contains bad rows, and
 * discovering them one request at a time is unusable.
 */
export const importAttendanceFile = async (buffer, { dryRun = false } = {}, req) => {
  const tenantId = req.user.tenantId ?? null;

  const { rows, truncated } = await parseWorkbook(buffer, { columns: IMPORT_COLUMNS });
  if (!rows.length) throw ApiError.badRequest('The uploaded file contains no data rows');

  const employees = await loadEmployeeMap(tenantId, rows.map(({ data }) => data.employeeCode));

  const valid = [];
  const failed = [];
  const seen = new Set();

  for (const { rowNumber, data } of rows) {
    const errors = [];
    const code = String(data.employeeCode ?? '').toUpperCase();
    const employee = employees.get(code);

    if (!code) errors.push('Employee Code is required');
    else if (!employee) errors.push(`Unknown employee code: ${data.employeeCode}`);

    const date = parseDateTime(data.date);
    if (!data.date) errors.push('Date is required');
    else if (date === undefined) errors.push('Date is not a valid date');

    const day = date ? startOfDay(date) : null;

    const checkIn = parseDateTime(data.checkIn, day);
    if (data.checkIn && checkIn === undefined) errors.push('Check In is not a valid time');

    const checkOut = parseDateTime(data.checkOut, day);
    if (data.checkOut && checkOut === undefined) errors.push('Check Out is not a valid time');

    if (checkIn && checkOut && checkOut < checkIn) {
      // Legitimate for a night shift, but only when the sheet says so; a
      // same-day pair in this order is a data-entry error.
      errors.push('Check Out is before Check In on the same date');
    }

    if (employee && day) {
      const key = `${employee._id}-${day.getTime()}`;
      if (seen.has(key)) errors.push('This employee and date appear more than once in the file');
      else seen.add(key);
    }

    if (errors.length) failed.push({ row: rowNumber, errors, data });
    else valid.push({ rowNumber, employee, day, checkIn, checkOut, status: data.status ?? null, remarks: data.remarks ?? null });
  }

  const summary = {
    totalRows: rows.length,
    valid: valid.length,
    failed: failed.length,
    truncated,
    dryRun,
    errors: failed.slice(0, 100),
    errorsTruncated: failed.length > 100,
    imported: 0,
  };

  if (dryRun || !valid.length) return summary;

  /* --- write pass -------------------------------------------------------- */
  const dates = valid.map((entry) => entry.day);
  const holidays = await attendanceRepository.findHolidays(
    tenantId,
    new Date(Math.min(...dates)),
    new Date(Math.max(...dates)),
  );

  let imported = 0;

  for (const entry of valid) {
    try {
      const punches = [];
      if (entry.checkIn) {
        punches.push({ time: entry.checkIn, source: ATTENDANCE_SOURCE.CSV, direction: 'IN', recordedBy: req.user.id });
      }
      if (entry.checkOut) {
        punches.push({ time: entry.checkOut, source: ATTENDANCE_SOURCE.CSV, direction: 'OUT', recordedBy: req.user.id });
      }

      await attendanceRepository.upsertDay(entry.employee._id, entry.day, {
        set: {
          tenantId,
          // An uploaded row is the authority for that day, so its punches
          // replace rather than accumulate on re-upload.
          ...(punches.length ? { punches } : {}),
          overrideStatus: entry.status ?? null,
          remarks: entry.remarks,
          source: ATTENDANCE_SOURCE.CSV,
          updatedBy: req.user.id,
        },
        setOnInsert: { markedBy: req.user.id },
      });

      const context = await loadDayContext(entry.employee, entry.day, { holidays });
      await recomputeDay(entry.employee, entry.day, { context, req, source: ATTENDANCE_SOURCE.CSV });
      imported += 1;
    } catch (error) {
      failed.push({ row: entry.rowNumber, errors: [error.message] });
    }
  }

  summary.imported = imported;
  summary.failed = failed.length;
  summary.errors = failed.slice(0, 100);

  await recordAudit({
    req,
    entity: 'Attendance',
    entityId: employeeRepository.toObjectId(req.user.id),
    action: AUDIT_ACTIONS.IMPORT,
    metadata: { source: 'FILE', totalRows: rows.length, imported, failed: summary.failed },
  });

  logger.info('Attendance file imported', { totalRows: rows.length, imported, failed: summary.failed });

  return summary;
};

export default { ingestBiometric, importAttendanceFile, buildImportTemplate, IMPORT_COLUMNS };
