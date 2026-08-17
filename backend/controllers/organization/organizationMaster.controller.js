import asyncHandler from '../../utils/asyncHandler.js';
import ApiError from '../../utils/ApiError.js';
import ApiResponse from '../../utils/ApiResponse.js';
import masterService from '../../services/organization/organizationMaster.service.js';

/**
 * Management endpoints for the organization masters.
 *
 * The read-only picker endpoints in organization.controller.js are untouched --
 * other modules depend on their exact shape. These are the additional
 * operations the Organization screens need, all routed through one generic
 * service keyed by the `:master` path segment.
 */

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Validated query, falling back to the raw one for routes without a schema. */
const query = (req) => req.validatedQuery ?? req.query ?? {};

const stamp = () => new Date().toISOString().slice(0, 10);

export const list = asyncHandler(async (req, res) => {
  const result = await masterService.listMaster(req.params.master, query(req), req);

  return ApiResponse.paginated(res, result.items, {
    page: result.page,
    limit: result.limit,
    total: result.total,
  });
});

export const getOne = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await masterService.getMaster(req.params.master, req.params.id, req)),
);

export const create = asyncHandler(async (req, res) => {
  const document = await masterService.createMaster(req.params.master, req.body, req);
  const { label } = masterService.resolveMaster(req.params.master);

  return ApiResponse.created(res, document, `${label} created`);
});

export const update = asyncHandler(async (req, res) => {
  const document = await masterService.updateMaster(req.params.master, req.params.id, req.body, req);
  const { label } = masterService.resolveMaster(req.params.master);

  return ApiResponse.ok(res, document, `${label} updated`);
});

export const setStatus = asyncHandler(async (req, res) => {
  const document = await masterService.setMasterStatus(
    req.params.master,
    req.params.id,
    req.body.isActive,
    req,
  );

  return ApiResponse.ok(res, document, req.body.isActive ? 'Activated' : 'Deactivated');
});

export const remove = asyncHandler(async (req, res) => {
  const result = await masterService.deleteMaster(req.params.master, req.params.id, req);
  const { label } = masterService.resolveMaster(req.params.master);

  return ApiResponse.ok(res, result, `${label} deleted`);
});

export const auditTrail = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = query(req);

  const result = await masterService.getMasterAudit(req.params.master, req.params.id, {
    page: Number(page),
    limit: Number(limit),
  });

  return ApiResponse.paginated(res, result.items, {
    page: result.page,
    limit: result.limit,
    total: result.total,
  });
});

/* -------------------------------------------------------------------------- */
/*                                  Transfer                                  */
/* -------------------------------------------------------------------------- */

export const exportExcel = asyncHandler(async (req, res) => {
  const { buffer, rowCount } = await masterService.exportMasterExcel(req.params.master, query(req), req);

  res.setHeader('Content-Type', XLSX_MIME);
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.master}-${stamp()}.xlsx"`);
  // Exposed by the CORS config so the client can report "57 rows exported".
  res.setHeader('X-Total-Count', String(rowCount));

  return res.status(200).send(Buffer.from(buffer));
});

export const exportPdf = asyncHandler(async (req, res) => {
  const { buffer, rowCount } = await masterService.exportMasterPdf(req.params.master, query(req), req);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.master}-${stamp()}.pdf"`);
  res.setHeader('X-Total-Count', String(rowCount));

  return res.status(200).send(buffer);
});

export const downloadTemplate = asyncHandler(async (req, res) => {
  const buffer = await masterService.buildMasterTemplate(req.params.master);

  res.setHeader('Content-Type', XLSX_MIME);
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.master}-import-template.xlsx"`);

  return res.status(200).send(Buffer.from(buffer));
});

export const importExcel = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('No file was uploaded');

  // Multipart fields arrive as strings and bypass the validator, because Multer
  // parses the body -- so the flag is coerced explicitly here.
  const dryRun = req.body?.dryRun === 'true' || req.body?.dryRun === true;

  const result = await masterService.importMaster(req.params.master, req.file.buffer, { dryRun }, req);

  return ApiResponse.ok(
    res,
    result,
    dryRun
      ? `Preview: ${result.valid} row(s) ready (${result.toCreate} new, ${result.toUpdate} updates), ${result.failed} with errors`
      : `Imported ${result.created} new and updated ${result.updated} record(s), ${result.failed} row(s) rejected`,
  );
});

export default {
  list,
  getOne,
  create,
  update,
  setStatus,
  remove,
  auditTrail,
  exportExcel,
  exportPdf,
  downloadTemplate,
  importExcel,
};
