import asyncHandler from '../../utils/asyncHandler.js';
import ApiResponse from '../../utils/ApiResponse.js';
import organizationService from '../../services/organization/organization.service.js';

export const departments = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await organizationService.listDepartments(req.user.tenantId)),
);

export const designations = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await organizationService.listDesignations(req.user.tenantId)),
);

export const shifts = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await organizationService.listShifts(req.user.tenantId)),
);

export const units = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await organizationService.listUnits(req.user.tenantId)),
);

export const grades = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await organizationService.listGrades(req.user.tenantId)),
);

export const salaryTemplates = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await organizationService.listSalaryTemplates(req.user.tenantId)),
);

export const reportingManagers = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await organizationService.listReportingManagers(req.user.tenantId)),
);

/** Everything a form needs, in one request instead of seven. */
export const masters = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await organizationService.listAllMasters(req.user.tenantId), 'Organization masters'),
);

export default {
  departments,
  designations,
  shifts,
  units,
  grades,
  salaryTemplates,
  reportingManagers,
  masters,
};
