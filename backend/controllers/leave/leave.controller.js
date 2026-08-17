import asyncHandler from '../../utils/asyncHandler.js';
import ApiResponse from '../../utils/ApiResponse.js';
import leaveService from '../../services/leave/leave.service.js';
import { buildWorkbook } from '../../helpers/excel.helper.js';
import { buildTablePdf } from '../../helpers/pdf.helper.js';

const query = (req) => req.validatedQuery ?? req.query ?? {};

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/* ------------------------------------------------------------ leave types -- */

export const listTypes = asyncHandler(async (req, res) => {
  const result = await leaveService.listTypes(query(req), req);

  return ApiResponse.paginated(res, result.items, {
    page: result.page,
    limit: result.limit,
    total: result.total,
  });
});

export const getType = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await leaveService.getType(req.params.id, req)),
);

export const createType = asyncHandler(async (req, res) =>
  ApiResponse.created(res, await leaveService.createType(req.body, req), 'Leave type created'),
);

export const updateType = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await leaveService.updateType(req.params.id, req.body, req), 'Leave type updated'),
);

export const setTypeStatus = asyncHandler(async (req, res) => {
  const type = await leaveService.setTypeStatus(req.params.id, req.body.isActive, req);
  return ApiResponse.ok(res, type, req.body.isActive ? 'Activated' : 'Deactivated');
});

export const deleteType = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await leaveService.deleteType(req.params.id, req), 'Leave type deleted'),
);

/* --------------------------------------------------------------- balances -- */

export const listBalances = asyncHandler(async (req, res) => {
  const result = await leaveService.listBalances(query(req), req);

  return ApiResponse.paginated(res, result.items, {
    page: result.page,
    limit: result.limit,
    total: result.total,
  });
});

export const employeeBalances = asyncHandler(async (req, res) => {
  const { employeeId, year } = query(req);
  return ApiResponse.ok(res, await leaveService.getEmployeeBalances({ employeeId, year, req }));
});

export const carryForward = asyncHandler(async (req, res) => {
  const result = await leaveService.runCarryForward(req.body, req);

  return ApiResponse.ok(
    res,
    result,
    `${result.processed} balance(s) carried forward, ${result.skipped} already done, ${result.lapsed} day(s) lapsed`,
  );
});

export const encash = asyncHandler(async (req, res) => {
  const balance = await leaveService.encashBalance(
    { balanceId: req.params.id, days: req.body.days, note: req.body.note },
    req,
  );

  return ApiResponse.ok(res, balance, `${req.body.days} day(s) encashed`);
});

export const adjust = asyncHandler(async (req, res) => {
  const balance = await leaveService.adjustBalance(
    { balanceId: req.params.id, days: req.body.days, note: req.body.note },
    req,
  );

  return ApiResponse.ok(res, balance, 'Balance adjusted');
});

/* --------------------------------------------------------------- requests -- */

export const preview = asyncHandler(async (req, res) => {
  const result = await leaveService.previewRequest(req.body, req);

  return ApiResponse.ok(res, result, result.problems.length ? 'This request cannot be submitted' : 'Ready to submit');
});

export const apply = asyncHandler(async (req, res) =>
  ApiResponse.created(res, await leaveService.applyForLeave(req.body, req), 'Leave applied for'),
);

export const listRequests = asyncHandler(async (req, res) => {
  const result = await leaveService.listRequests(query(req), req);

  return ApiResponse.paginated(res, result.items, {
    page: result.page,
    limit: result.limit,
    total: result.total,
  });
});

export const getRequest = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await leaveService.getRequest(req.params.id, req)),
);

export const decide = asyncHandler(async (req, res) => {
  const request = await leaveService.decideRequest(req.params.id, req.body, req);
  return ApiResponse.ok(res, request, `Leave ${request.status.toLowerCase()}`);
});

export const cancel = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await leaveService.cancelRequest(req.params.id, req.body, req), 'Leave cancelled'),
);

export const pendingCount = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await leaveService.pendingCount(req)),
);

export const calendar = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await leaveService.leaveCalendar(query(req), req), 'Leave calendar'),
);

/* ---------------------------------------------------------------- reports -- */

const REPORT_COLUMNS = [
  { header: 'Code', key: 'employeeCode', width: 14 },
  { header: 'Employee', key: 'fullName', width: 28 },
  { header: 'Leave Type', key: 'leaveType', width: 22 },
  { header: 'Entitled', key: 'entitled', width: 12 },
  { header: 'Carried Forward', key: 'carriedForward', width: 16 },
  { header: 'Adjusted', key: 'adjusted', width: 12 },
  { header: 'Taken', key: 'taken', width: 12 },
  { header: 'Pending', key: 'pending', width: 12 },
  { header: 'Encashed', key: 'encashed', width: 12 },
  { header: 'Lapsed', key: 'lapsed', width: 12 },
  { header: 'Available', key: 'available', width: 12 },
];

export const report = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await leaveService.leaveReport(query(req), req), 'Leave report'),
);

export const exportReport = asyncHandler(async (req, res) => {
  const { year, rows } = await leaveService.leaveReport(query(req), req);

  const buffer = await buildWorkbook({
    sheetName: `Leave ${year}`,
    columns: REPORT_COLUMNS,
    rows,
  });

  res.setHeader('Content-Type', XLSX_MIME);
  res.setHeader('Content-Disposition', `attachment; filename="leave-balances-${year}.xlsx"`);
  res.setHeader('X-Total-Count', String(rows.length));

  return res.status(200).send(Buffer.from(buffer));
});

export const exportReportPdf = asyncHandler(async (req, res) => {
  const { year, rows } = await leaveService.leaveReport(query(req), req);

  // Landscape A4 stops being legible past about eight columns, so the PDF
  // carries the figures a reader actually scans for rather than all eleven.
  const columns = [
    { header: 'Code', key: 'employeeCode', width: 70 },
    { header: 'Employee', key: 'fullName', width: 150 },
    { header: 'Leave Type', key: 'leaveType', width: 120 },
    { header: 'Entitled', key: 'entitled', width: 70, align: 'right' },
    { header: 'Taken', key: 'taken', width: 70, align: 'right' },
    { header: 'Encashed', key: 'encashed', width: 70, align: 'right' },
    { header: 'Available', key: 'available', width: 80, align: 'right' },
  ];

  const buffer = await buildTablePdf({
    title: `Leave balances ${year}`,
    subtitle: `${rows.length} record(s)`,
    columns,
    rows,
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="leave-balances-${year}.pdf"`);

  return res.status(200).send(buffer);
});

export default {
  listTypes,
  getType,
  createType,
  updateType,
  setTypeStatus,
  deleteType,
  listBalances,
  employeeBalances,
  carryForward,
  encash,
  adjust,
  preview,
  apply,
  listRequests,
  getRequest,
  decide,
  cancel,
  pendingCount,
  calendar,
  report,
  exportReport,
  exportReportPdf,
};
