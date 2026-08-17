import { Router } from 'express';

import controller from '../../controllers/attendance/attendance.controller.js';
import regularizationController from '../../controllers/attendance/regularization.controller.js';
import sheetController from '../../controllers/attendance/attendanceSheet.controller.js';
import validate from '../../middlewares/validate.js';
import { requirePermission } from '../../middlewares/authorize.js';
import { spreadsheetUpload } from '../../config/multer.js';
import { ACTIONS } from '../../utils/constants.js';
import schemas from '../../validators/attendance/attendance.validator.js';

const router = Router();

/**
 * Attendance: punches, shifts, regularization and monthly reporting.
 *
 * RBAC resource: RESOURCES.ATTENDANCE
 *
 * Mounted in routes/index.js behind authenticate and bound to its resource.
 * Literal paths precede `/:id` -- Express matches in order, and `/summary`
 * would otherwise be captured as a record id.
 */

/* ---------------------------------------------------------- self service -- */

// Gated on CREATE rather than a role list: every role that may punch has it,
// while AUDITOR and ACCOUNTS (read-only on attendance) do not.
router.post('/punch', requirePermission(ACTIONS.CREATE), validate(schemas.punchSchema), controller.punch);

router.get('/me/today', requirePermission(ACTIONS.READ), controller.myToday);

router.get(
  '/me/calendar',
  requirePermission(ACTIONS.READ),
  validate(schemas.monthlyCalendarSchema),
  controller.monthlyCalendar,
);

// Validated so `employeeId` actually reaches the controller -- without a
// schema the sanitized query is never populated and the parameter is dropped.
router.get(
  '/comp-off',
  requirePermission(ACTIONS.READ),
  validate(schemas.compOffSchema),
  controller.compOffLedger,
);

/* -------------------------------------------------------------- register -- */

router.get('/', requirePermission(ACTIONS.READ), validate(schemas.listAttendanceSchema), controller.list);

router.get(
  '/summary',
  requirePermission(ACTIONS.READ),
  validate(schemas.dailySummarySchema),
  controller.dailySummary,
);

router.post(
  '/manual',
  // Marking someone else's attendance is an approval-grade act: it changes a
  // figure payroll will pay against.
  requirePermission(ACTIONS.APPROVE),
  validate(schemas.markManualSchema),
  controller.markManual,
);

/* ---------------------------------------------------------------- ingest -- */

router.post(
  '/biometric',
  requirePermission(ACTIONS.CREATE),
  validate(schemas.biometricSchema),
  controller.biometric,
);

router.post(
  '/import',
  requirePermission(ACTIONS.CREATE),
  spreadsheetUpload.single('file'),
  controller.importFile,
);

router.get('/import/template', requirePermission(ACTIONS.CREATE), controller.downloadTemplate);

/* ----------------------------------------------- monthly sheet import ---- */

/**
 * Monthly workbook import.
 *
 * One endpoint serves both steps: without `commit` it validates and returns a
 * preview, with `commit=true` it writes. Splitting them into two routes would
 * mean the file is uploaded twice, and a preview that is not re-validated on
 * commit is an invitation to post a doctored payload.
 */
router.post(
  '/import/sheet',
  /**
   * APPROVE, not CREATE.
   *
   * `attendance:create` is held by every employee so they can punch their own
   * card -- gating an import on it would let anyone upload a month of
   * attendance for the entire organisation. Writing attendance for other
   * people is the same authority as marking it manually.
   */
  requirePermission(ACTIONS.APPROVE),
  spreadsheetUpload.single('file'),
  sheetController.importSheet,
);

router.get(
  '/import/sheet/template',
  requirePermission(ACTIONS.CREATE),
  validate(schemas.templateQuerySchema),
  sheetController.downloadTemplate,
);

router.get(
  '/sheets',
  requirePermission(ACTIONS.READ),
  validate(schemas.listSheetsSchema),
  sheetController.listSheets,
);

router.get(
  '/month',
  requirePermission(ACTIONS.READ),
  validate(schemas.monthQuerySchema),
  sheetController.getMonth,
);

router.put(
  '/sheets/:id',
  // Editing an uploaded sheet changes the record payroll is derived from.
  requirePermission(ACTIONS.APPROVE),
  validate(schemas.updateSheetSchema),
  sheetController.updateSheet,
);

router.delete(
  '/sheets/:id',
  requirePermission(ACTIONS.DELETE),
  validate(schemas.idParamSchema),
  sheetController.deleteSheet,
);

/* --------------------------------------------------------------- reports -- */

router.get(
  '/reports/monthly',
  requirePermission(ACTIONS.READ),
  validate(schemas.monthlyReportSchema),
  controller.monthlyRegister,
);

router.get(
  '/reports/summary',
  requirePermission(ACTIONS.DASHBOARD),
  validate(schemas.monthlyReportSchema),
  controller.monthlySummary,
);

// Dashboard-grade: a year of overtime totals, no per-employee detail.
router.get(
  '/reports/overtime-trend',
  requirePermission(ACTIONS.DASHBOARD),
  validate(schemas.overtimeTrendSchema),
  controller.overtimeTrend,
);

router.get(
  '/reports/exceptions',
  requirePermission(ACTIONS.READ),
  validate(schemas.exceptionReportSchema),
  controller.exceptions,
);

router.get(
  '/reports/export',
  // Bulk extraction is a separate privilege from reading one register.
  requirePermission(ACTIONS.EXPORT),
  validate(schemas.monthlyReportSchema),
  controller.exportMonthly,
);

/* Late coming, early going, overtime and absent all share one endpoint,
   selected by `type` -- they differ only in the predicate. */
router.get(
  '/reports/days',
  requirePermission(ACTIONS.READ),
  validate(schemas.dayReportSchema),
  sheetController.dayReport,
);

router.get(
  '/reports/days/export',
  requirePermission(ACTIONS.EXPORT),
  validate(schemas.dayReportSchema),
  sheetController.exportDayReport,
);

router.get(
  '/reports/grouped',
  requirePermission(ACTIONS.DASHBOARD),
  validate(schemas.groupedReportSchema),
  sheetController.groupedReport,
);

router.get(
  '/reports/summary/pdf',
  requirePermission(ACTIONS.EXPORT),
  validate(schemas.monthlyReportSchema),
  sheetController.exportSummaryPdf,
);

/* -------------------------------------------------------- regularization -- */

router.get(
  '/regularizations',
  requirePermission(ACTIONS.READ),
  validate(schemas.listRegularizationsSchema),
  regularizationController.list,
);

router.get(
  '/regularizations/pending-count',
  requirePermission(ACTIONS.READ),
  regularizationController.pendingCount,
);

router.post(
  '/regularizations',
  requirePermission(ACTIONS.CREATE),
  validate(schemas.requestRegularizationSchema),
  regularizationController.create,
);

router.patch(
  '/regularizations/:id/decision',
  requirePermission(ACTIONS.APPROVE),
  validate(schemas.decideRegularizationSchema),
  regularizationController.decide,
);

router.post(
  '/regularizations/:id/cancel',
  requirePermission(ACTIONS.CREATE),
  validate(schemas.idParamSchema),
  regularizationController.cancel,
);

/* -------------------------------------------------------------- holidays -- */

router.get(
  '/holidays',
  requirePermission(ACTIONS.READ),
  validate(schemas.listHolidaysSchema),
  controller.listHolidays,
);

router.post(
  '/holidays',
  requirePermission(ACTIONS.CREATE),
  validate(schemas.createHolidaySchema),
  controller.createHoliday,
);

// Literal segments before `/:id`, so "audit" is never captured as a holiday id.
router.get(
  '/holidays/:id/audit',
  requirePermission(ACTIONS.READ),
  validate(schemas.holidayAuditSchema),
  controller.holidayAudit,
);

router.patch(
  '/holidays/:id/status',
  requirePermission(ACTIONS.UPDATE),
  validate(schemas.holidayStatusSchema),
  controller.setHolidayStatus,
);

router.patch(
  '/holidays/:id',
  requirePermission(ACTIONS.UPDATE),
  validate(schemas.updateHolidaySchema),
  controller.updateHoliday,
);

router.delete(
  '/holidays/:id',
  requirePermission(ACTIONS.DELETE),
  validate(schemas.idParamSchema),
  controller.deleteHoliday,
);

/* ---------------------------------------------------------------- policy -- */

router.get('/policy', requirePermission(ACTIONS.READ), controller.getPolicy);

router.put(
  '/policy',
  // Policy decides how every day is graded; changing it is an approval act.
  requirePermission(ACTIONS.APPROVE),
  validate(schemas.upsertPolicySchema),
  controller.upsertPolicy,
);

router.post(
  '/lock',
  requirePermission(ACTIONS.APPROVE),
  validate(schemas.lockPeriodSchema),
  controller.lockPeriod,
);

/* ------------------------------------------------------------ single row -- */

router.get('/:id', requirePermission(ACTIONS.READ), validate(schemas.idParamSchema), controller.getOne);

export default router;
