import asyncHandler from '../../utils/asyncHandler.js';
import ApiResponse from '../../utils/ApiResponse.js';
import ApiError from '../../utils/ApiError.js';
import importService, { DUPLICATE_STRATEGY } from '../../services/attendance/attendanceImport.service.js';
import sheetService from '../../services/attendance/attendanceSheet.service.js';
import reportService from '../../services/attendance/attendanceReport.service.js';
import { buildAttendanceTemplate } from '../../helpers/attendanceSheet.helper.js';

const query = (req) => req.validatedQuery ?? {};

/**
 * Multipart fields arrive as strings because Multer owns the body parse, so
 * they are coerced here rather than in the validator, which never sees them.
 */
const readImportOptions = (req) => {
  const year = Number(req.body?.year);
  const month = Number(req.body?.month);

  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    // The workbook carries a month name but no year, so the period cannot be
    // determined from the file alone.
    throw ApiError.badRequest('A valid year is required — the workbook does not carry one');
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw ApiError.badRequest('A valid month (1-12) is required');
  }

  const strategy = String(req.body?.duplicateStrategy ?? DUPLICATE_STRATEGY.REPLACE).toUpperCase();
  if (!Object.values(DUPLICATE_STRATEGY).includes(strategy)) {
    throw ApiError.badRequest('duplicateStrategy must be REPLACE, MERGE or SKIP');
  }

  return {
    year,
    month,
    duplicateStrategy: strategy,
    fileName: req.file?.originalname ?? null,
    // The preview step is the default: nothing is written unless the caller
    // explicitly commits.
    commit: req.body?.commit === 'true' || req.body?.commit === true,
  };
};

/* ---------------------------------------------------------------- import -- */

export const importSheet = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('No file was uploaded');

  const options = readImportOptions(req);

  if (!options.commit) {
    const report = await importService.previewImport(req.file.buffer, options, req);

    return ApiResponse.ok(
      res,
      { ...report, committed: false },
      `Validated ${report.totalRows} row(s): ${report.validCount} ready, ${report.invalidCount} with errors`,
    );
  }

  const result = await importService.commitImport(req.file.buffer, options, req);

  return ApiResponse.ok(
    res,
    { ...result, committed: true },
    `Imported ${result.imported} employee month(s), ${result.skipped} skipped, ${result.invalidCount} rejected`,
  );
});

export const downloadTemplate = asyncHandler(async (req, res) => {
  const now = new Date();
  const buffer = await buildAttendanceTemplate({
    month: Number(query(req).month) || now.getMonth() + 1,
    year: Number(query(req).year) || now.getFullYear(),
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="attendance-monthly-template.xlsx"');
  return res.status(200).send(Buffer.from(buffer));
});

/* ---------------------------------------------------------------- sheets -- */

export const listSheets = asyncHandler(async (req, res) => {
  const result = await sheetService.listSheets(query(req), req);

  return ApiResponse.paginated(res, result.items, {
    page: result.page,
    limit: result.limit,
    total: result.total,
  });
});

export const getMonth = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await sheetService.getMonth(query(req), req), 'Monthly attendance'),
);

export const updateSheet = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await sheetService.updateSheet(req.params.id, req.body, req), 'Attendance sheet updated'),
);

export const deleteSheet = asyncHandler(async (req, res) => {
  const result = await sheetService.deleteSheet(req.params.id, req);

  return ApiResponse.ok(
    res,
    result,
    `Sheet deleted along with ${result.dailyRecordsRemoved} daily record(s). Locked days were kept.`,
  );
});

/* --------------------------------------------------------------- reports -- */

export const dayReport = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await reportService.dayReport(query(req), req), 'Attendance report'),
);

export const groupedReport = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await reportService.groupedReport(query(req), req), 'Grouped attendance'),
);

export const exportDayReport = asyncHandler(async (req, res) => {
  const { buffer, rowCount } = await reportService.exportDayReport(query(req), req);

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="attendance-${query(req).type.toLowerCase()}.xlsx"`);
  res.setHeader('X-Total-Count', String(rowCount));

  return res.status(200).send(Buffer.from(buffer));
});

export const exportSummaryPdf = asyncHandler(async (req, res) => {
  const { year, month } = query(req);
  const { buffer, rowCount } = await reportService.exportMonthlySummaryPdf(query(req), req);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="attendance-summary-${year}-${String(month).padStart(2, '0')}.pdf"`,
  );
  res.setHeader('X-Total-Count', String(rowCount));

  return res.status(200).send(buffer);
});

export default {
  importSheet,
  downloadTemplate,
  listSheets,
  getMonth,
  updateSheet,
  deleteSheet,
  dayReport,
  groupedReport,
  exportDayReport,
  exportSummaryPdf,
};
