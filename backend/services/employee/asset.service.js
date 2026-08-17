import logger from '../../config/logger.js';
import ApiError from '../../utils/ApiError.js';
import { ASSET_STATUS, ASSET_CONDITION, AUDIT_ACTIONS } from '../../utils/constants.js';
import { buildPagination, buildSort, buildSearch } from '../../utils/queryBuilder.js';
import Asset from '../../models/employee/asset.model.js';
import employeeRepository from '../../repositories/employee/employee.repository.js';
import { recordAudit } from '../../helpers/audit.helper.js';

const ENTITY = 'Asset';

export const SORTABLE_FIELDS = ['assetCode', 'name', 'category', 'status', 'createdAt'];

/**
 * Company asset register and assignment.
 *
 * Kept deliberately small: it exists so exit settlement can answer "what is
 * still out with this person" authoritatively. A full IT asset-management
 * module (procurement, warranty, depreciation schedules) is separate work.
 */

const nextAssetCode = async (tenantId) => {
  const latest = await Asset.findOne({ tenantId: tenantId ?? null, assetCode: /^AST\d+$/ })
    .sort({ assetCode: -1 })
    .select('assetCode')
    .lean();

  const current = latest ? Number(latest.assetCode.slice(3)) : 0;
  return `AST${String(current + 1).padStart(5, '0')}`;
};

export const createAsset = async (payload, req) => {
  const asset = await Asset.create({
    ...payload,
    tenantId: req.user.tenantId ?? null,
    assetCode: payload.assetCode ?? (await nextAssetCode(req.user.tenantId)),
    // Recovery defaults to the purchase cost only when nothing better is
    // known; charging the original price for a four-year-old laptop is the
    // usual over-recovery mistake, so it is meant to be set explicitly.
    recoveryValue: payload.recoveryValue ?? payload.purchaseCost ?? 0,
    createdBy: req.user.id,
  });

  await recordAudit({
    req,
    entity: ENTITY,
    entityId: asset._id,
    entityLabel: `${asset.assetCode} · ${asset.name}`,
    action: AUDIT_ACTIONS.CREATE,
  });

  return asset;
};

export const assignAsset = async (assetId, { employeeId, assignedOn, condition, remarks }, req) => {
  const asset = await Asset.findById(assetId);
  if (!asset) throw ApiError.notFound('Asset not found');

  if (asset.status === ASSET_STATUS.ASSIGNED) {
    throw ApiError.conflict('This asset is already assigned. Record its return first.');
  }
  if ([ASSET_STATUS.LOST, ASSET_STATUS.RETIRED].includes(asset.status)) {
    throw ApiError.badRequest(`A ${asset.status.toLowerCase()} asset cannot be assigned`);
  }

  const employee = await employeeRepository.findById(employeeId, { populate: false });
  if (!employee) throw ApiError.notFound('Employee not found');

  asset.assignments.push({
    employeeId: employee._id,
    assignedOn: assignedOn ? new Date(assignedOn) : new Date(),
    assignedBy: req.user.id,
    conditionOnIssue: condition ?? asset.condition ?? ASSET_CONDITION.GOOD,
    remarks: remarks ?? null,
  });

  asset.status = ASSET_STATUS.ASSIGNED;
  asset.currentHolderId = employee._id;
  await asset.save();

  await recordAudit({
    req,
    entity: ENTITY,
    entityId: asset._id,
    entityLabel: `${asset.assetCode} · ${asset.name}`,
    action: AUDIT_ACTIONS.UPDATE,
    metadata: { assignedTo: employee.employeeCode },
  });

  logger.info('Asset assigned', { assetCode: asset.assetCode, employee: employee.employeeCode });

  return asset;
};

/**
 * Records a return.
 *
 * A damaged or missing item stays chargeable: the recovery amount is carried
 * on the assignment so the settlement sheet can pick it up even though the
 * asset itself is no longer "assigned".
 */
export const returnAsset = async (assetId, { returnedOn, condition, recoveryAmount, remarks }, req) => {
  const asset = await Asset.findById(assetId);
  if (!asset) throw ApiError.notFound('Asset not found');

  const open = asset.assignments.find((entry) => !entry.returnedOn);
  if (!open) throw ApiError.badRequest('This asset is not currently assigned to anyone');

  open.returnedOn = returnedOn ? new Date(returnedOn) : new Date();
  open.returnedTo = req.user.id;
  open.conditionOnReturn = condition ?? ASSET_CONDITION.GOOD;
  open.recoveryAmount = recoveryAmount ?? 0;
  open.remarks = remarks ?? open.remarks;

  const damaged = [ASSET_CONDITION.DAMAGED, ASSET_CONDITION.UNUSABLE].includes(open.conditionOnReturn);

  asset.status = damaged ? ASSET_STATUS.DAMAGED : ASSET_STATUS.AVAILABLE;
  asset.condition = open.conditionOnReturn;
  asset.currentHolderId = null;
  await asset.save();

  await recordAudit({
    req,
    entity: ENTITY,
    entityId: asset._id,
    action: AUDIT_ACTIONS.UPDATE,
    metadata: { returned: true, condition: open.conditionOnReturn, recoveryAmount: open.recoveryAmount },
  });

  return asset;
};

/** Written off as lost; the full recovery value becomes chargeable. */
export const markAssetLost = async (assetId, { recoveryAmount, remarks }, req) => {
  const asset = await Asset.findById(assetId);
  if (!asset) throw ApiError.notFound('Asset not found');

  const open = asset.assignments.find((entry) => !entry.returnedOn);
  if (open) {
    open.returnedOn = new Date();
    open.conditionOnReturn = ASSET_CONDITION.UNUSABLE;
    open.recoveryAmount = recoveryAmount ?? asset.recoveryValue;
    open.remarks = remarks ?? 'Reported lost';
  }

  asset.status = ASSET_STATUS.LOST;
  asset.currentHolderId = null;
  await asset.save();

  await recordAudit({
    req,
    entity: ENTITY,
    entityId: asset._id,
    action: AUDIT_ACTIONS.UPDATE,
    metadata: { lost: true, recoveryAmount: recoveryAmount ?? asset.recoveryValue },
  });

  return asset;
};

/** Everything a person still holds -- the exit checklist. */
export const findHeldByEmployee = (employeeId) =>
  Asset.find({ currentHolderId: employeeId, status: ASSET_STATUS.ASSIGNED }).lean();

export const listAssets = async (query, req) => {
  const { page, limit, skip } = buildPagination(query);
  const sort = buildSort(query, SORTABLE_FIELDS, { assetCode: 1 });

  const filter = { tenantId: req.user.tenantId ?? null, isActive: true };
  if (query.status) filter.status = query.status;
  if (query.category) filter.category = query.category;
  if (query.employeeId) filter.currentHolderId = query.employeeId;

  const search = buildSearch(query.search, ['assetCode', 'name', 'serialNumber']);
  if (search) Object.assign(filter, search);

  const [items, total] = await Promise.all([
    Asset.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate({ path: 'currentHolderId', select: 'employeeCode employeeId firstName lastName' })
      .lean({ virtuals: true }),
    Asset.countDocuments(filter),
  ]);

  return { items, total, page, limit };
};

export const getAsset = async (assetId, req) => {
  const asset = await Asset.findById(assetId).populate([
    { path: 'currentHolderId', select: 'employeeCode employeeId firstName lastName' },
    { path: 'assignments.employeeId', select: 'employeeCode employeeId firstName lastName' },
  ]);

  if (!asset) throw ApiError.notFound('Asset not found');

  const callerTenant = req.user.tenantId ?? null;
  if (callerTenant !== null && String(asset.tenantId) !== callerTenant) {
    throw ApiError.notFound('Asset not found');
  }

  return asset.toObject({ virtuals: true });
};

export default {
  createAsset,
  assignAsset,
  returnAsset,
  markAssetLost,
  findHeldByEmployee,
  listAssets,
  getAsset,
  SORTABLE_FIELDS,
};
