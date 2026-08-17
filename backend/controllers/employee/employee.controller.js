import asyncHandler from '../../utils/asyncHandler.js';
import ApiResponse from '../../utils/ApiResponse.js';
import ApiError from '../../utils/ApiError.js';
import employeeService from '../../services/employee/employee.service.js';
// Excel import/export. Named for data transfer, not employee transfers -- those
// live in employeeMovement.service.js.
import transferService from '../../services/employee/employeeTransfer.service.js';
import movementService from '../../services/employee/employeeMovement.service.js';

const query = (req) => req.validatedQuery ?? {};

export const list = asyncHandler(async (req, res) => {
  const result = await employeeService.listEmployees(query(req), req);

  return ApiResponse.paginated(res, result.items, {
    page: result.page,
    limit: result.limit,
    total: result.total,
  });
});

export const summary = asyncHandler(async (req, res) => {
  return ApiResponse.ok(res, await employeeService.getStatusSummary(req), 'Headcount by status');
});

export const getOne = asyncHandler(async (req, res) => {
  return ApiResponse.ok(res, await employeeService.getEmployee(req.params.id, req));
});

export const create = asyncHandler(async (req, res) => {
  const employee = await employeeService.createEmployee(req.body, req);
  return ApiResponse.created(res, employee, 'Employee created successfully');
});

export const update = asyncHandler(async (req, res) => {
  const employee = await employeeService.updateEmployee(req.params.id, req.body, req);
  return ApiResponse.ok(res, employee, 'Employee updated successfully');
});

export const changeStatus = asyncHandler(async (req, res) => {
  const employee = await employeeService.changeStatus(req.params.id, req.body, req);
  return ApiResponse.ok(res, employee, `Employee moved to ${req.body.status}`);
});

export const remove = asyncHandler(async (req, res) => {
  const result = await employeeService.deleteEmployee(req.params.id, req.body?.reason, req, {
    purgeAttachments: req.body?.purgeAttachments === true,
  });

  // The message tells the truth about what just happened: a soft delete alone
  // is reversible, and one that took the documents with it is not.
  const message = result.attachmentsRemoved
    ? 'Employee deleted. The record can be restored, but its documents were permanently removed.'
    : 'Employee deleted. The record and its documents can be restored.';

  return ApiResponse.ok(res, result, message);
});

export const restore = asyncHandler(async (req, res) => {
  const employee = await employeeService.restoreEmployee(req.params.id, req);
  return ApiResponse.ok(res, employee, 'Employee restored successfully');
});

export const auditTrail = asyncHandler(async (req, res) => {
  const { page, limit } = query(req);
  const result = await employeeService.getAuditTrail(req.params.id, { page, limit }, req);

  return ApiResponse.paginated(res, result.items, {
    page: result.page,
    limit: result.limit,
    total: result.total,
  });
});

/* ------------------------------------------------------------ attachments */

export const uploadPhoto = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('No photo was uploaded');

  const photo = await employeeService.attachPhoto(req.params.id, req.file, req);
  return ApiResponse.ok(res, photo, 'Photo uploaded successfully');
});

export const uploadDocuments = asyncHandler(async (req, res) => {
  if (!req.files?.length) throw ApiError.badRequest('No documents were uploaded');

  const documents = await employeeService.attachDocuments(req.params.id, req.files, req.body, req);
  return ApiResponse.created(res, documents, `${req.files.length} document(s) uploaded`);
});

export const deleteDocument = asyncHandler(async (req, res) => {
  const documents = await employeeService.removeDocument(req.params.id, req.params.documentId, req);
  return ApiResponse.ok(res, documents, 'Document removed');
});

/* --------------------------------------------------------- import / export */

/**
 * Streams a workbook. Content-Disposition carries a dated filename so a user
 * downloading the same report twice does not end up with `employees (3).xlsx`.
 */
export const exportExcel = asyncHandler(async (req, res) => {
  const { buffer, rowCount } = await transferService.exportEmployees(query(req), req);
  const stamp = new Date().toISOString().slice(0, 10);

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader('Content-Disposition', `attachment; filename="employees-${stamp}.xlsx"`);
  // Exposed so the browser client can report "1,240 rows exported".
  res.setHeader('X-Total-Count', String(rowCount));

  return res.status(200).send(Buffer.from(buffer));
});

export const downloadTemplate = asyncHandler(async (_req, res) => {
  const buffer = await transferService.buildImportTemplate();

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader('Content-Disposition', 'attachment; filename="employee-import-template.xlsx"');

  return res.status(200).send(Buffer.from(buffer));
});

export const importExcel = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('No file was uploaded');

  // Multipart form fields arrive as strings; the validator never sees them
  // because the body is parsed by Multer, so coerce explicitly here.
  const dryRun = req.body?.dryRun === 'true' || req.body?.dryRun === true;

  const result = await transferService.importEmployees(req.file.buffer, { dryRun }, req);

  return ApiResponse.ok(
    res,
    result,
    dryRun
      ? `Validation complete: ${result.valid} row(s) ready, ${result.failed} with errors`
      : `Imported ${result.imported} employee(s), ${result.failed} row(s) rejected`,
  );
});

/* -------------------------------------------------------------------------- */
/*                          Transfers and promotions                          */
/* -------------------------------------------------------------------------- */

/**
 * Both are read-only views over the audit trail. Executing a transfer or a
 * promotion is `PATCH /employees/:id` -- the movement is the change itself, and
 * recording it twice would let the two disagree.
 */

export const movements = asyncHandler(async (req, res) => {
  const { type, page, limit } = query(req);
  const result = await movementService.getEmployeeMovements(req.params.id, { type, page, limit }, req);

  return ApiResponse.paginated(res, result.items, {
    page: result.page,
    limit: result.limit,
    total: result.total,
  });
});

export const allMovements = asyncHandler(async (req, res) => {
  const { type, from, to, page, limit } = query(req);
  const result = await movementService.listMovements({ type, from, to, page, limit }, req);

  return ApiResponse.paginated(res, result.items, {
    page: result.page,
    limit: result.limit,
    total: result.total,
  });
});

export default {
  list,
  summary,
  getOne,
  create,
  update,
  changeStatus,
  remove,
  restore,
  auditTrail,
  movements,
  allMovements,
  uploadPhoto,
  uploadDocuments,
  deleteDocument,
  exportExcel,
  downloadTemplate,
  importExcel,
};
