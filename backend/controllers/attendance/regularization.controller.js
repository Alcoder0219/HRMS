import asyncHandler from '../../utils/asyncHandler.js';
import ApiResponse from '../../utils/ApiResponse.js';
import regularizationService from '../../services/attendance/regularization.service.js';

const query = (req) => req.validatedQuery ?? {};

export const list = asyncHandler(async (req, res) => {
  const result = await regularizationService.listRegularizations(query(req), req);

  return ApiResponse.paginated(res, result.items, {
    page: result.page,
    limit: result.limit,
    total: result.total,
  });
});

export const pendingCount = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await regularizationService.getPendingCount(req)),
);

export const create = asyncHandler(async (req, res) => {
  const request = await regularizationService.requestRegularization(req.body, req);
  return ApiResponse.created(res, request, 'Regularization submitted for approval');
});

export const decide = asyncHandler(async (req, res) => {
  const request = await regularizationService.decideRegularization(req.params.id, req.body, req);

  return ApiResponse.ok(
    res,
    request,
    `Request ${request.status.toLowerCase()}`,
  );
});

export const cancel = asyncHandler(async (req, res) => {
  const request = await regularizationService.cancelRegularization(req.params.id, req);
  return ApiResponse.ok(res, request, 'Request cancelled');
});

export default { list, pendingCount, create, decide, cancel };
