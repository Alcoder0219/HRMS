import asyncHandler from '../../utils/asyncHandler.js';
import ApiResponse from '../../utils/ApiResponse.js';
import ApiError from '../../utils/ApiError.js';
import attendanceService from '../../services/attendance/attendance.service.js';
import ingestService from '../../services/attendance/attendanceIngest.service.js';
import reportService from '../../services/attendance/attendanceReport.service.js';
import Holiday from '../../models/attendance/holiday.model.js';
import AttendancePolicy from '../../models/attendance/attendancePolicy.model.js';
import auditLogRepository from '../../repositories/audit/auditLog.repository.js';
import { recordAudit, diffObjects } from '../../helpers/audit.helper.js';
import { AUDIT_ACTIONS } from '../../utils/constants.js';

const query = (req) => req.validatedQuery ?? {};

/* ------------------------------------------------------------- punching -- */

export const punch = asyncHandler(async (req, res) => {
  const { record, direction, geofence } = await attendanceService.punch(req.body, req);

  return ApiResponse.ok(
    res,
    { record, direction, geofence },
    direction === 'IN' ? 'Checked in' : 'Checked out',
  );
});

export const markManual = asyncHandler(async (req, res) => {
  const record = await attendanceService.markManual(req.body, req);
  return ApiResponse.ok(res, record, 'Attendance recorded');
});

/* ---------------------------------------------------------------- reads -- */

export const list = asyncHandler(async (req, res) => {
  const result = await attendanceService.listAttendance(query(req), req);

  return ApiResponse.paginated(res, result.items, {
    page: result.page,
    limit: result.limit,
    total: result.total,
  });
});

export const dailySummary = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await attendanceService.getDailySummary(query(req).date, req)),
);

export const myToday = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await attendanceService.getMyToday(req)),
);

export const monthlyCalendar = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await attendanceService.getMonthlyCalendar(query(req), req)),
);

export const getOne = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await attendanceService.getAttendance(req.params.id, req)),
);

export const compOffLedger = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await attendanceService.getCompOffLedger(query(req).employeeId, req)),
);

export const lockPeriod = asyncHandler(async (req, res) => {
  const result = await attendanceService.lockPeriod(req.body, req);
  return ApiResponse.ok(res, result, `${result.locked} day(s) locked`);
});

/* --------------------------------------------------------------- ingest -- */

export const biometric = asyncHandler(async (req, res) => {
  const result = await ingestService.ingestBiometric(req.body, req);

  return ApiResponse.ok(
    res,
    result,
    `${result.daysUpdated} day(s) updated from ${result.received} punch(es)`,
  );
});

export const importFile = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('No file was uploaded');

  // Multipart fields arrive as strings; the validator never sees them because
  // Multer owns the body parse.
  const dryRun = req.body?.dryRun === 'true' || req.body?.dryRun === true;
  const result = await ingestService.importAttendanceFile(req.file.buffer, { dryRun }, req);

  return ApiResponse.ok(
    res,
    result,
    dryRun
      ? `Validation complete: ${result.valid} row(s) ready, ${result.failed} with errors`
      : `Imported ${result.imported} day(s), ${result.failed} row(s) rejected`,
  );
});

export const downloadTemplate = asyncHandler(async (_req, res) => {
  const buffer = await ingestService.buildImportTemplate();

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="attendance-import-template.xlsx"');
  return res.status(200).send(Buffer.from(buffer));
});

/* -------------------------------------------------------------- reports -- */

export const monthlyRegister = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await reportService.monthlyRegister(query(req), req), 'Monthly register'),
);

export const monthlySummary = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await reportService.monthlySummary(query(req), req), 'Monthly summary'),
);

export const overtimeTrend = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await reportService.overtimeTrend(query(req), req), 'Overtime trend'),
);

export const exceptions = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await reportService.exceptionReport(query(req), req), 'Attendance exceptions'),
);

export const exportMonthly = asyncHandler(async (req, res) => {
  const { year, month } = query(req);
  const { buffer, rowCount } = await reportService.exportMonthlySummary(query(req), req);

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="attendance-${year}-${String(month).padStart(2, '0')}.xlsx"`,
  );
  res.setHeader('X-Total-Count', String(rowCount));

  return res.status(200).send(Buffer.from(buffer));
});

/* ------------------------------------------------------------- holidays -- */

export const listHolidays = asyncHandler(async (req, res) => {
  const { year, status } = query(req);

  /**
   * Defaults to active only, which is what every existing caller expects --
   * the attendance grader and the calendar widget must not see a withdrawn
   * holiday. The management screen passes `status` explicitly, because a
   * deactivated row it cannot see is a row it can never restore.
   */
  const filter = { tenantId: req.user.tenantId ?? null, year };

  if (status === 'active' || status === undefined) filter.isActive = true;
  else if (status === 'inactive') filter.isActive = false;

  const holidays = await Holiday.find(filter).sort({ date: 1 }).lean();

  return ApiResponse.ok(res, holidays, 'Holiday calendar');
});

export const createHoliday = asyncHandler(async (req, res) => {
  const holiday = await Holiday.create({
    ...req.body,
    tenantId: req.user.tenantId ?? null,
    createdBy: req.user.id,
  });

  await recordAudit({
    req,
    entity: 'Holiday',
    entityId: holiday._id,
    entityLabel: holiday.name,
    action: AUDIT_ACTIONS.CREATE,
    changes: diffObjects({}, holiday.toObject()),
  });

  return ApiResponse.created(res, holiday, 'Holiday added');
});

export const updateHoliday = asyncHandler(async (req, res) => {
  const holiday = await Holiday.findOne({ _id: req.params.id, tenantId: req.user.tenantId ?? null });
  if (!holiday) throw ApiError.notFound('Holiday not found');

  const before = holiday.toObject();
  Object.assign(holiday, req.body);

  // Saved through the document so the pre-validate hook re-derives `year` when
  // the date moves into another one.
  await holiday.save();

  const changes = diffObjects(before, holiday.toObject());

  if (changes.length) {
    await recordAudit({
      req,
      entity: 'Holiday',
      entityId: holiday._id,
      entityLabel: holiday.name,
      action: AUDIT_ACTIONS.UPDATE,
      changes,
    });
  }

  return ApiResponse.ok(res, holiday.toObject(), 'Holiday updated');
});

export const setHolidayStatus = asyncHandler(async (req, res) => {
  const { isActive } = req.body;

  const holiday = await Holiday.findOneAndUpdate(
    { _id: req.params.id, tenantId: req.user.tenantId ?? null },
    { $set: { isActive } },
    { new: true },
  );

  if (!holiday) throw ApiError.notFound('Holiday not found');

  await recordAudit({
    req,
    entity: 'Holiday',
    entityId: holiday._id,
    entityLabel: holiday.name,
    action: AUDIT_ACTIONS.STATUS_CHANGE,
    changes: [{ field: 'isActive', from: String(!isActive), to: String(isActive) }],
  });

  return ApiResponse.ok(res, holiday.toObject(), isActive ? 'Holiday restored' : 'Holiday withdrawn');
});

export const holidayAudit = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = query(req);

  const result = await auditLogRepository.findForEntity('Holiday', req.params.id, {
    page: Number(page),
    limit: Number(limit),
  });

  return ApiResponse.paginated(res, result.items, {
    page: result.page,
    limit: result.limit,
    total: result.total,
  });
});

export const deleteHoliday = asyncHandler(async (req, res) => {
  // Soft-deactivated rather than removed: past attendance was computed against
  // this calendar, and deleting the row would make those days unexplainable.
  const holiday = await Holiday.findOneAndUpdate(
    { _id: req.params.id, tenantId: req.user.tenantId ?? null },
    { $set: { isActive: false } },
    { new: true },
  );

  if (!holiday) throw ApiError.notFound('Holiday not found');

  await recordAudit({
    req,
    entity: 'Holiday',
    entityId: holiday._id,
    entityLabel: holiday.name,
    action: AUDIT_ACTIONS.DELETE,
    changes: [{ field: 'isActive', from: 'true', to: 'false' }],
  });

  return ApiResponse.ok(res, { id: String(holiday._id) }, 'Holiday removed');
});

/* --------------------------------------------------------------- policy -- */

export const getPolicy = asyncHandler(async (req, res) => {
  const policy = await AttendancePolicy.findOne({
    tenantId: req.user.tenantId ?? null,
    departmentId: null,
    isActive: true,
  }).lean();

  return ApiResponse.ok(res, policy, policy ? 'Attendance policy' : 'No policy configured');
});

export const upsertPolicy = asyncHandler(async (req, res) => {
  const { departmentId = null, ...rest } = req.body;

  const policy = await AttendancePolicy.findOneAndUpdate(
    { tenantId: req.user.tenantId ?? null, departmentId: departmentId || null },
    {
      $set: { ...rest, departmentId: departmentId || null, isActive: true, updatedBy: req.user.id },
      $setOnInsert: { tenantId: req.user.tenantId ?? null, createdBy: req.user.id },
    },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
  );

  return ApiResponse.ok(res, policy, 'Attendance policy saved');
});

export default {
  punch,
  markManual,
  list,
  dailySummary,
  myToday,
  monthlyCalendar,
  getOne,
  compOffLedger,
  lockPeriod,
  biometric,
  importFile,
  downloadTemplate,
  monthlyRegister,
  monthlySummary,
  overtimeTrend,
  exceptions,
  exportMonthly,
  listHolidays,
  createHoliday,
  updateHoliday,
  setHolidayStatus,
  holidayAudit,
  deleteHoliday,
  getPolicy,
  upsertPolicy,
};
