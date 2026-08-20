import Role from '../../models/auth/role.model.js';
import ApiError from '../../utils/ApiError.js';
import {
  ROLES,
  ROLE_RANK,
  ROLE_LABELS,
  CROSS_TENANT_ROLES,
  RESOURCES,
  ACTIONS,
  RESOURCE_VALUES,
  ACTION_VALUES,
  WILDCARD,
  SCOPES,
  AUDIT_ACTIONS,
} from '../../utils/constants.js';
import { PERMISSION_MATRIX } from '../../config/permissions.js';
import { toPermission } from '../../helpers/permission.helper.js';
import { loadRoleCache } from '../auth/roleCache.service.js';
import { recordAudit, diffObjects } from '../../helpers/audit.helper.js';
import roleRepository from '../../repositories/auth/role.repository.js';

/**
 * Role and permission administration.
 *
 * Roles used to be `PERMISSION_MATRIX`, a static object -- see that file's
 * comment for why. This is the module that took over as the write path once
 * the matrix moved into the `Role` collection: every mutation here ends with
 * `loadRoleCache()`, which is what lets `permission.helper.js` keep answering
 * `can()` synchronously without a database round trip per request.
 */

/* ------------------------------------------------------------ presentation */

/** Flattens a role's stored grants into `resource:action` strings, expanding wildcards. */
const flattenPermissions = (permissions = []) => {
  const granted = new Set();

  for (const { resource, actions = [] } of permissions) {
    const resources = resource === WILDCARD ? RESOURCE_VALUES : [resource];
    const resolvedActions = actions.includes(WILDCARD) ? ACTION_VALUES : actions;

    for (const res of resources) {
      for (const action of resolvedActions) granted.add(toPermission(res, action));
    }
  }

  return [...granted].sort();
};

/**
 * One row per RESOURCE, every time -- the editable matrix needs a complete,
 * deterministic grid regardless of whether a role's document happens to list
 * every resource, and Super Admin's `{'*': ['*']}` grant expands into the same
 * shape as everyone else's so the UI never has to special-case it.
 */
const expandPermissions = (permissions = []) => {
  const grants = new Map();

  for (const { resource, actions = [] } of permissions) {
    const resources = resource === WILDCARD ? RESOURCE_VALUES : [resource];
    const resolvedActions = actions.includes(WILDCARD) ? ACTION_VALUES : actions;

    for (const res of resources) {
      if (!grants.has(res)) grants.set(res, new Set());
      resolvedActions.forEach((action) => grants.get(res).add(action));
    }
  }

  return RESOURCE_VALUES.map((resource) => ({
    resource,
    actions: [...(grants.get(resource) ?? [])].sort(),
  }));
};

/** Shape kept identical to the pre-DB `describeRole()` output, for `/auth/roles` back-compat. */
export const describeRole = (role) => ({
  role: role.code,
  scope: role.scope,
  description: role.description ?? '',
  crossTenant: Boolean(role.isCrossTenant),
  permissions: flattenPermissions(role.permissions),
});

const presentRole = (role, userCount = 0) => ({
  ...describeRole(role),
  id: String(role._id),
  code: role.code,
  label: role.label,
  rank: role.rank,
  isSystem: role.isSystem,
  structuredPermissions: expandPermissions(role.permissions),
  userCount,
});

/* -------------------------------------------------------------------- seed */

/**
 * Creates the ten built-in roles from `PERMISSION_MATRIX` if they are not
 * already there. `$setOnInsert` is the point of this -- an admin's saved edit
 * to, say, HR's permissions must survive the next restart untouched, so this
 * only ever fills in what is missing, never overwrites what exists.
 */
export const ensureSystemRoles = async () => {
  await Promise.all(
    Object.values(ROLES).map((code) => {
      const entry = PERMISSION_MATRIX[code];
      if (!entry) return null;

      return Role.updateOne(
        { code },
        {
          $setOnInsert: {
            code,
            label: ROLE_LABELS[code] ?? code,
            description: entry.description ?? '',
            scope: entry.scope,
            rank: ROLE_RANK[code] ?? 10,
            isSystem: true,
            isCrossTenant: CROSS_TENANT_ROLES.includes(code),
            permissions: Object.entries(entry.permissions).map(([resource, actions]) => ({ resource, actions })),
          },
        },
        { upsert: true },
      );
    }),
  );
};

/* -------------------------------------------------------------------- read */

export const listRoleDefinitions = async () => (await roleRepository.findAll()).map(describeRole);

export const listRoles = async () => {
  const [roles, userCounts] = await Promise.all([roleRepository.findAll(), roleRepository.countUsersByRole()]);
  return roles.map((role) => presentRole(role, userCounts[role.code] ?? 0));
};

/* ------------------------------------------------------------------ create */

const generateUniqueCode = async (label) => {
  const base =
    label
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 34) || 'ROLE';

  let candidate = base;
  let suffix = 2;
  // eslint-disable-next-line no-await-in-loop
  while (await roleRepository.findByCode(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  return candidate;
};

export const createRole = async ({ label, description, cloneFromCode }, req) => {
  const trimmedLabel = label.trim();

  if (await roleRepository.findByLabel(trimmedLabel)) {
    throw ApiError.conflict('A role with that name already exists');
  }

  let permissions = [];
  let scope = SCOPES.SELF;
  let rank = 10;

  if (cloneFromCode) {
    const source = await roleRepository.findByCode(cloneFromCode.trim().toUpperCase());
    if (!source) throw ApiError.badRequest('The role to clone permissions from does not exist');

    permissions = expandPermissions(source.permissions).filter((entry) => entry.actions.length > 0);
    scope = source.scope;
    rank = source.rank;
  }

  const code = await generateUniqueCode(trimmedLabel);

  const role = await roleRepository.create({
    code,
    label: trimmedLabel,
    description: description?.trim() ?? '',
    scope,
    rank,
    isSystem: false,
    isCrossTenant: false,
    permissions,
    createdBy: req.user?.id ?? null,
  });

  await loadRoleCache();

  await recordAudit({
    req,
    entity: 'Role',
    entityId: role._id,
    entityLabel: role.label,
    action: AUDIT_ACTIONS.CREATE,
    changes: [
      { field: 'label', from: null, to: role.label },
      { field: 'clonedFrom', from: null, to: cloneFromCode ?? null },
    ],
  });

  return presentRole(role, 0);
};

/* ------------------------------------------------------------------ update */

export const updateRole = async (id, { label, description }, req) => {
  const role = await roleRepository.findById(id);
  if (!role) throw ApiError.notFound('No such role');

  // System-protected: the ten seeded roles are relied on by identity
  // elsewhere (User.role's default, rank comparisons, seed accounts), so
  // renaming one is refused the same way deleting one is.
  if (role.isSystem) throw ApiError.forbidden('Built-in roles cannot be renamed or re-described');

  if (label !== undefined && label.trim().toLowerCase() !== role.label.toLowerCase()) {
    const existing = await roleRepository.findByLabel(label.trim());
    if (existing && String(existing._id) !== String(role._id)) {
      throw ApiError.conflict('A role with that name already exists');
    }
  }

  const before = { label: role.label, description: role.description };
  if (label !== undefined) role.label = label.trim();
  if (description !== undefined) role.description = description?.trim() ?? '';
  role.updatedBy = req.user?.id ?? null;
  await role.save();

  await loadRoleCache();

  const changes = diffObjects(before, { label: role.label, description: role.description });
  if (changes.length) {
    await recordAudit({
      req,
      entity: 'Role',
      entityId: role._id,
      entityLabel: role.label,
      action: AUDIT_ACTIONS.UPDATE,
      changes,
    });
  }

  return presentRole(role, await roleRepository.countUsersForRole(role.code));
};

/**
 * Bulk permission save from the matrix screen -- one write per changed role,
 * one cache reload after all of them.
 */
export const updateRolePermissions = async ({ updates }, req) => {
  if (!updates?.length) throw ApiError.badRequest('No changes to save');

  const touched = [];

  for (const { roleId, permissions } of updates) {
    // eslint-disable-next-line no-await-in-loop
    const role = await roleRepository.findById(roleId);
    if (!role) throw ApiError.notFound('No such role');

    const nextPermissions = (permissions ?? []).map(({ resource, actions }) => ({
      resource,
      actions: [...new Set(actions ?? [])],
    }));

    // Super Admin's hard floor. Whatever was submitted, role:read and
    // role:update always survive the save -- the confirmation dialog warns
    // about editing Super Admin, but nothing submitted through this endpoint
    // can lock every administrator out of the permissions screen itself.
    if (role.code === ROLES.SUPER_ADMIN) {
      const floor = [ACTIONS.READ, ACTIONS.UPDATE];
      const roleEntry = nextPermissions.find((entry) => entry.resource === RESOURCES.ROLE);
      if (roleEntry) {
        floor.forEach((action) => {
          if (!roleEntry.actions.includes(action)) roleEntry.actions.push(action);
        });
      } else {
        nextPermissions.push({ resource: RESOURCES.ROLE, actions: [...floor] });
      }
    }

    const before = (role.permissions ?? []).map((entry) => ({ resource: entry.resource, actions: [...(entry.actions ?? [])] }));
    role.permissions = nextPermissions;
    role.updatedBy = req.user?.id ?? null;
    // eslint-disable-next-line no-await-in-loop
    await role.save();

    touched.push({ role, before, after: nextPermissions });
  }

  await loadRoleCache();

  await Promise.all(
    touched.map(({ role, before, after }) => {
      const changes = diffObjects({ permissions: before }, { permissions: after });
      if (!changes.length) return null;

      return recordAudit({
        req,
        entity: 'Role',
        entityId: role._id,
        entityLabel: role.label,
        action: AUDIT_ACTIONS.UPDATE,
        changes,
      });
    }),
  );

  const userCounts = await roleRepository.countUsersByRole();
  return touched.map(({ role }) => presentRole(role, userCounts[role.code] ?? 0));
};

/* ------------------------------------------------------------------ delete */

export const deleteRole = async (id, req) => {
  const role = await roleRepository.findById(id);
  if (!role) throw ApiError.notFound('No such role');

  if (role.isSystem) throw ApiError.forbidden('Built-in roles cannot be deleted');

  const userCount = await roleRepository.countUsersForRole(role.code);
  if (userCount > 0) {
    throw ApiError.conflict(`${userCount} user${userCount === 1 ? ' is' : 's are'} still assigned to this role`, {
      userCount,
    });
  }

  await roleRepository.deleteById(id);
  await loadRoleCache();

  await recordAudit({
    req,
    entity: 'Role',
    entityId: role._id,
    entityLabel: role.label,
    action: AUDIT_ACTIONS.DELETE,
    changes: [{ field: 'code', from: role.code, to: null }],
  });

  return { deleted: true };
};

export default {
  ensureSystemRoles,
  describeRole,
  listRoleDefinitions,
  listRoles,
  createRole,
  updateRole,
  updateRolePermissions,
  deleteRole,
};
