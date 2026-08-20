import asyncHandler from '../../utils/asyncHandler.js';
import ApiResponse from '../../utils/ApiResponse.js';
import roleService from '../../services/admin/role.service.js';

export const listRoles = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await roleService.listRoles(), 'Roles'),
);

export const createRole = asyncHandler(async (req, res) =>
  ApiResponse.created(res, await roleService.createRole(req.body, req), 'Role created'),
);

export const updateRole = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await roleService.updateRole(req.params.id, req.body, req), 'Role updated'),
);

export const updateRolePermissions = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await roleService.updateRolePermissions(req.body, req), 'Permissions updated'),
);

export const deleteRole = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await roleService.deleteRole(req.params.id, req), 'Role deleted'),
);

export default { listRoles, createRole, updateRole, updateRolePermissions, deleteRole };
