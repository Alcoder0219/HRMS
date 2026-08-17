import asyncHandler from '../../utils/asyncHandler.js';
import ApiResponse from '../../utils/ApiResponse.js';
import settlementService from '../../services/payroll/settlement.service.js';
import assetService from '../../services/employee/asset.service.js';
import payrollRepository from '../../repositories/payroll/payroll.repository.js';
import { buildSettlementPdf } from '../../helpers/pdf.helper.js';

const query = (req) => req.validatedQuery ?? {};

/* ---------------------------------------------------------- settlements -- */

export const create = asyncHandler(async (req, res) => {
  const settlement = await settlementService.createSettlement(req.body, req);

  return ApiResponse.created(
    res,
    settlement,
    settlement.pendingAssetCount > 0
      ? `Settlement ${settlement.settlementNumber} created. ${settlement.pendingAssetCount} asset(s) still held.`
      : `Settlement ${settlement.settlementNumber} created`,
  );
});

export const recalculate = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await settlementService.recalculateSettlement(req.params.id, req.body, req), 'Settlement recalculated'),
);

export const list = asyncHandler(async (req, res) => {
  const result = await settlementService.listSettlements(query(req), req);

  return ApiResponse.paginated(res, result.items, {
    page: result.page,
    limit: result.limit,
    total: result.total,
  });
});

export const getOne = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await settlementService.getSettlement(req.params.id, req)),
);

export const submit = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await settlementService.submitSettlement(req.params.id, req), 'Submitted for HR approval'),
);

export const hrDecision = asyncHandler(async (req, res) => {
  const settlement = await settlementService.hrDecision(req.params.id, req.body, req);

  return ApiResponse.ok(
    res,
    settlement,
    req.body.decision === 'APPROVED' ? 'HR approved. Sent to finance.' : 'Returned for correction',
  );
});

export const financeDecision = asyncHandler(async (req, res) => {
  const settlement = await settlementService.financeDecision(req.params.id, req.body, req);

  return ApiResponse.ok(
    res,
    settlement,
    req.body.decision === 'APPROVED' ? 'Finance approved. Ready for payment.' : 'Returned to HR',
  );
});

export const markPaid = asyncHandler(async (req, res) => {
  const settlement = await settlementService.markSettlementPaid(req.params.id, req.body, req);
  return ApiResponse.ok(res, settlement, 'Settlement marked as paid and outstanding loans closed');
});

export const hold = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await settlementService.holdSettlement(req.params.id, req.body, req), 'Settlement held'),
);

export const release = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await settlementService.releaseSettlement(req.params.id, req.body, req), 'Hold released'),
);

export const cancel = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await settlementService.cancelSettlement(req.params.id, req.body, req), 'Settlement cancelled'),
);

export const dashboard = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await settlementService.dashboard(req), 'Settlement dashboard'),
);

/** Streams the settlement sheet as a PDF. */
export const pdf = asyncHandler(async (req, res) => {
  const settlement = await settlementService.getSettlement(req.params.id, req);
  const settings = await payrollRepository.findSettings(req.user.tenantId ?? null);

  const buffer = await buildSettlementPdf(settlement, {
    name: settings?.bank?.companyName ?? 'HRMS',
    currency: settings?.currency ?? 'INR',
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="settlement-${settlement.settlementNumber}.pdf"`,
  );
  res.setHeader('Content-Length', buffer.length);

  return res.status(200).send(buffer);
});

/* --------------------------------------------------------------- assets -- */

export const createAsset = asyncHandler(async (req, res) =>
  ApiResponse.created(res, await assetService.createAsset(req.body, req), 'Asset added to the register'),
);

export const listAssets = asyncHandler(async (req, res) => {
  const result = await assetService.listAssets(query(req), req);

  return ApiResponse.paginated(res, result.items, {
    page: result.page,
    limit: result.limit,
    total: result.total,
  });
});

export const getAsset = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await assetService.getAsset(req.params.id, req)),
);

export const assignAsset = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await assetService.assignAsset(req.params.id, req.body, req), 'Asset assigned'),
);

export const returnAsset = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await assetService.returnAsset(req.params.id, req.body, req), 'Return recorded'),
);

export const markAssetLost = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await assetService.markAssetLost(req.params.id, req.body, req), 'Asset marked as lost'),
);

export default {
  create,
  recalculate,
  list,
  getOne,
  submit,
  hrDecision,
  financeDecision,
  markPaid,
  hold,
  release,
  cancel,
  dashboard,
  pdf,
  createAsset,
  listAssets,
  getAsset,
  assignAsset,
  returnAsset,
  markAssetLost,
};
