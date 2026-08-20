import { useCallback, useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CheckIcon from '@mui/icons-material/CheckOutlined';
import AddIcon from '@mui/icons-material/AddOutlined';
import EditIcon from '@mui/icons-material/EditOutlined';
import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import MoreVertIcon from '@mui/icons-material/MoreVertOutlined';
import DoneAllIcon from '@mui/icons-material/DoneAllOutlined';
import ClearAllIcon from '@mui/icons-material/ClearAllOutlined';
import LockIcon from '@mui/icons-material/LockOutlined';

import PageHeader from '@components/common/PageHeader.jsx';
import ConfirmDialog from '@components/feedback/ConfirmDialog.jsx';
import RoleFormDialog from './RoleFormDialog.jsx';
import usePermissions from '@hooks/usePermissions.js';
import { useToast } from '@contexts/ToastContext.jsx';
import adminService from '@services/modules/admin.service.js';
import { ACTIONS, ACTION_LABELS, RESOURCES, toPermission } from '@utils/permissions.js';
import { ROLES } from '@utils/roles.js';
import { humanize } from '@utils/format.js';
import { PATHS } from '@routes/paths.js';

const RESOURCE_LIST = Object.values(RESOURCES);
const ACTION_LIST = Object.values(ACTIONS);

/** A working copy keyed by role id, then resource, then a sorted actions array. */
const toDraft = (roleList) =>
  Object.fromEntries(
    roleList.map((role) => [
      role.id,
      Object.fromEntries((role.structuredPermissions ?? []).map((entry) => [entry.resource, [...entry.actions].sort()])),
    ]),
  );

const sameGrant = (a = [], b = []) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Super Admin always keeps role:read and role:update, whatever the draft
 * says. It is the floor that keeps the matrix from being editable into
 * locking every administrator out of this screen -- see the confirmation
 * dialog below, and `role.service.js#updateRolePermissions` on the server,
 * which enforces the same thing regardless of what is submitted here.
 */
const isFloorCell = (role, resource, action) =>
  role.code === ROLES.SUPER_ADMIN && resource === RESOURCES.ROLE && (action === ACTIONS.READ || action === ACTIONS.UPDATE);

/**
 * The permission matrix: every resource against every action, for every role.
 *
 * Editable when the caller holds `role:update` (or is Super Admin): edits are
 * kept in local state and only reach the server on "Save changes", and a
 * sensitive save -- Super Admin, or a role users currently hold -- is
 * confirmed first. Everyone else sees the same read-only grid this page has
 * always shown.
 */
const PermissionsPage = () => {
  const permissions = usePermissions();
  const toast = useToast();

  const canEdit = permissions.can(RESOURCES.ROLE, ACTIONS.UPDATE);
  const canCreateRole = permissions.can(RESOURCES.ROLE, ACTIONS.CREATE);
  const canDeleteRole = permissions.can(RESOURCES.ROLE, ACTIONS.DELETE);

  const [roles, setRoles] = useState([]);
  const [draft, setDraft] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [onlyMine, setOnlyMine] = useState(false);

  const [confirmSaveOpen, setConfirmSaveOpen] = useState(false);
  const [roleDialog, setRoleDialog] = useState({ open: false, role: null });
  const [colMenu, setColMenu] = useState({ anchor: null, role: null });
  const [pendingDeleteRole, setPendingDeleteRole] = useState(null);
  const [deletingRole, setDeletingRole] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);

    adminService
      .listRoles()
      .then((response) => {
        const data = response.data ?? [];
        setRoles(data);
        setDraft(toDraft(data));
      })
      .catch((rejection) => setError(rejection?.message ?? 'Could not load the permission matrix'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // A Set per role, so the read-only render (and the "Only mine" column) is
  // lookups rather than scans -- unchanged from the page's original shape.
  const held = useMemo(() => new Map(roles.map((role) => [role.code, new Set(role.permissions)])), [roles]);

  const editable = canEdit && !onlyMine;
  const columns = onlyMine ? [] : roles;

  const originalDraft = useMemo(() => toDraft(roles), [roles]);

  const dirtyRoleIds = useMemo(
    () =>
      roles
        .filter((role) => RESOURCE_LIST.some((resource) => !sameGrant(originalDraft[role.id]?.[resource], draft[role.id]?.[resource])))
        .map((role) => role.id),
    [roles, originalDraft, draft],
  );

  const isDirty = dirtyRoleIds.length > 0;

  const sensitiveRoles = useMemo(
    () =>
      dirtyRoleIds
        .map((id) => roles.find((role) => role.id === id))
        .filter((role) => role && (role.code === ROLES.SUPER_ADMIN || role.userCount > 0)),
    [dirtyRoleIds, roles],
  );

  const isChecked = (roleId, resource, action) => (draft[roleId]?.[resource] ?? []).includes(action);

  const toggleCell = (roleId, resource, action) => {
    setDraft((previous) => {
      const current = new Set(previous[roleId]?.[resource] ?? []);
      if (current.has(action)) current.delete(action);
      else current.add(action);
      return { ...previous, [roleId]: { ...(previous[roleId] ?? {}), [resource]: [...current].sort() } };
    });
  };

  const setResourceForAllRoles = (resource, checked) => {
    setDraft((previous) => {
      const next = { ...previous };
      roles.forEach((role) => {
        next[role.id] = { ...(next[role.id] ?? {}), [resource]: checked ? [...ACTION_LIST] : [] };
      });
      return next;
    });
  };

  const setAllForRole = (roleId, checked) => {
    setDraft((previous) => ({
      ...previous,
      [roleId]: Object.fromEntries(RESOURCE_LIST.map((resource) => [resource, checked ? [...ACTION_LIST] : []])),
    }));
  };

  const discard = () => setDraft(originalDraft);

  const doSave = async () => {
    setSaving(true);

    try {
      const updates = dirtyRoleIds.map((roleId) => ({
        roleId,
        permissions: RESOURCE_LIST.map((resource) => ({ resource, actions: draft[roleId]?.[resource] ?? [] })),
      }));

      await adminService.updateRolePermissions(updates);
      toast.success('Permissions updated');
      setConfirmSaveOpen(false);
      load();
    } catch (rejection) {
      toast.error(rejection?.message ?? 'Could not save permissions');
    } finally {
      setSaving(false);
    }
  };

  const requestSave = () => {
    if (sensitiveRoles.length > 0) setConfirmSaveOpen(true);
    else doSave();
  };

  const closeColMenu = () => setColMenu({ anchor: null, role: null });

  const confirmDeleteRole = async () => {
    setDeletingRole(true);

    try {
      await adminService.deleteRole(pendingDeleteRole.id);
      toast.success(`${pendingDeleteRole.label} deleted`);
      setPendingDeleteRole(null);
      load();
    } catch (rejection) {
      toast.error(rejection?.message ?? 'The role could not be deleted');
    } finally {
      setDeletingRole(false);
    }
  };

  return (
    <Box>
      <PageHeader
        title="Permissions"
        subtitle="Every resource and action, against every role"
        breadcrumbs={[{ label: 'Home', to: PATHS.dashboard }, { label: 'Administration' }, { label: 'Permissions' }]}
        actions={
          <Stack direction="row" spacing={1} alignItems="center">
            <FormControlLabel
              control={<Switch checked={onlyMine} onChange={(event) => setOnlyMine(event.target.checked)} />}
              label="Only mine"
            />
            {canCreateRole && (
              <Button
                size="small"
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => setRoleDialog({ open: true, role: null })}
                disabled={saving}
              >
                New role
              </Button>
            )}
          </Stack>
        }
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {loading && <Typography variant="body2">Loading matrix…</Typography>}

      <Paper variant="outlined" sx={{ overflowX: 'auto' }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell sx={{ minWidth: 140 }}>Resource</TableCell>
              <TableCell sx={{ minWidth: 130 }}>Action</TableCell>
              {onlyMine ? (
                <TableCell align="center">You</TableCell>
              ) : (
                columns.map((role) => (
                  <TableCell key={role.id} align="center" sx={{ whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                    <Stack spacing={0.25} alignItems="center">
                      <Stack direction="row" spacing={0.25} alignItems="center">
                        <Tooltip title={role.description ?? ''}>
                          <Typography variant="caption" fontWeight={600}>
                            {role.label}
                          </Typography>
                        </Tooltip>
                        {role.isSystem ? (
                          <Tooltip title="Built-in role — cannot be renamed or deleted">
                            <LockIcon sx={{ fontSize: 14 }} color="disabled" />
                          </Tooltip>
                        ) : (
                          canEdit && (
                            <IconButton
                              size="small"
                              sx={{ p: 0.25 }}
                              onClick={(event) => setColMenu({ anchor: event.currentTarget, role })}
                              aria-label={`Manage ${role.label}`}
                            >
                              <MoreVertIcon sx={{ fontSize: 14 }} />
                            </IconButton>
                          )
                        )}
                      </Stack>

                      {editable && (
                        <Stack direction="row" spacing={0.25}>
                          <Tooltip title={`Select all for ${role.label}`}>
                            <IconButton size="small" sx={{ p: 0.25 }} onClick={() => setAllForRole(role.id, true)} disabled={saving}>
                              <DoneAllIcon sx={{ fontSize: 14 }} />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title={`Clear all for ${role.label}`}>
                            <IconButton size="small" sx={{ p: 0.25 }} onClick={() => setAllForRole(role.id, false)} disabled={saving}>
                              <ClearAllIcon sx={{ fontSize: 14 }} />
                            </IconButton>
                          </Tooltip>
                        </Stack>
                      )}
                    </Stack>
                  </TableCell>
                ))
              )}
            </TableRow>
          </TableHead>

          <TableBody>
            {RESOURCE_LIST.flatMap((resource) =>
              ACTION_LIST.map((action, actionIndex) => {
                const permission = toPermission(resource, action);

                return (
                  <TableRow key={permission} hover>
                    {actionIndex === 0 && (
                      <TableCell
                        rowSpan={ACTION_LIST.length}
                        sx={{ verticalAlign: 'top', fontWeight: 600, borderRight: 1, borderColor: 'divider' }}
                      >
                        <Stack spacing={0.25}>
                          <Typography variant="body2" fontWeight={600}>
                            {humanize(resource)}
                          </Typography>
                          {editable && (
                            <Stack direction="row" spacing={0.25}>
                              <Tooltip title={`Select all ${humanize(resource)} for every role`}>
                                <IconButton
                                  size="small"
                                  sx={{ p: 0.25 }}
                                  onClick={() => setResourceForAllRoles(resource, true)}
                                  disabled={saving}
                                >
                                  <DoneAllIcon sx={{ fontSize: 14 }} />
                                </IconButton>
                              </Tooltip>
                              <Tooltip title={`Clear all ${humanize(resource)} for every role`}>
                                <IconButton
                                  size="small"
                                  sx={{ p: 0.25 }}
                                  onClick={() => setResourceForAllRoles(resource, false)}
                                  disabled={saving}
                                >
                                  <ClearAllIcon sx={{ fontSize: 14 }} />
                                </IconButton>
                              </Tooltip>
                            </Stack>
                          )}
                        </Stack>
                      </TableCell>
                    )}

                    <TableCell>
                      <Typography variant="caption">{ACTION_LABELS[action] ?? humanize(action)}</Typography>
                    </TableCell>

                    {onlyMine ? (
                      <TableCell align="center">
                        {permissions.permissions.has(permission) ? <CheckIcon fontSize="small" color="success" /> : '—'}
                      </TableCell>
                    ) : (
                      columns.map((role) => {
                        const floor = isFloorCell(role, resource, action);
                        const checked = floor || isChecked(role.id, resource, action);

                        if (editable) {
                          const box = (
                            <Checkbox
                              size="small"
                              checked={checked}
                              disabled={saving || floor}
                              onChange={() => toggleCell(role.id, resource, action)}
                              sx={{ p: 0.25 }}
                            />
                          );

                          return (
                            <TableCell key={role.id} align="center">
                              {floor ? (
                                <Tooltip title="Super Admin always keeps this, so the permissions screen can never be edited into locking every administrator out of it">
                                  <span>{box}</span>
                                </Tooltip>
                              ) : (
                                box
                              )}
                            </TableCell>
                          );
                        }

                        return (
                          <TableCell key={role.id} align="center">
                            {held.get(role.code)?.has(permission) ? (
                              <CheckIcon fontSize="small" color="success" />
                            ) : (
                              <Typography variant="caption" color="text.disabled">
                                —
                              </Typography>
                            )}
                          </TableCell>
                        );
                      })
                    )}
                  </TableRow>
                );
              }),
            )}
          </TableBody>
        </Table>
      </Paper>

      <Stack direction="row" spacing={1} sx={{ mt: 2 }} alignItems="center">
        <Chip label={`${RESOURCE_LIST.length} resources`} size="small" variant="outlined" />
        <Chip label={`${ACTION_LIST.length} actions`} size="small" variant="outlined" />
        <Chip label={`${roles.length} roles`} size="small" variant="outlined" />
        <Typography variant="caption" color="text.secondary">
          A tick here is what the API checks on every request — it is not a display rule.
        </Typography>
      </Stack>

      {editable && isDirty && (
        <Paper
          elevation={4}
          sx={{
            position: 'sticky',
            bottom: 0,
            mt: 2,
            p: 1.5,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 2,
            zIndex: 1,
          }}
        >
          <Typography variant="body2">
            {dirtyRoleIds.length} role{dirtyRoleIds.length === 1 ? '' : 's'} changed
          </Typography>
          <Stack direction="row" spacing={1}>
            <Button size="small" color="inherit" onClick={discard} disabled={saving}>
              Discard changes
            </Button>
            <Button
              size="small"
              variant="contained"
              onClick={requestSave}
              disabled={saving}
              startIcon={saving ? <CircularProgress size={14} color="inherit" /> : null}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </Stack>
        </Paper>
      )}

      <Menu anchorEl={colMenu.anchor} open={Boolean(colMenu.anchor)} onClose={closeColMenu}>
        <MenuItem
          onClick={() => {
            setRoleDialog({ open: true, role: colMenu.role });
            closeColMenu();
          }}
        >
          <ListItemIcon>
            <EditIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Edit" />
        </MenuItem>

        {canDeleteRole && (
          <Tooltip title={colMenu.role?.userCount > 0 ? `${colMenu.role.userCount} user(s) are assigned to this role` : ''}>
            <span>
              <MenuItem
                disabled={Boolean(colMenu.role?.userCount > 0)}
                onClick={() => {
                  setPendingDeleteRole(colMenu.role);
                  closeColMenu();
                }}
              >
                <ListItemIcon>
                  <DeleteIcon fontSize="small" color="error" />
                </ListItemIcon>
                <ListItemText primary="Delete" />
              </MenuItem>
            </span>
          </Tooltip>
        )}
      </Menu>

      <RoleFormDialog
        open={roleDialog.open}
        role={roleDialog.role}
        roles={roles}
        onClose={() => setRoleDialog({ open: false, role: null })}
        onSaved={() => {
          toast.success(roleDialog.role ? 'Role updated' : 'Role created');
          load();
        }}
      />

      <ConfirmDialog
        open={confirmSaveOpen}
        title="Save changes to sensitive roles?"
        message={
          sensitiveRoles.length
            ? `This changes permissions for ${sensitiveRoles.map((role) => role.label).join(', ')}. Double check before continuing — a role in this list is either Super Admin or currently held by at least one user.`
            : ''
        }
        confirmLabel="Save changes"
        confirmColor="warning"
        loading={saving}
        onConfirm={doSave}
        onClose={() => setConfirmSaveOpen(false)}
      />

      <ConfirmDialog
        open={Boolean(pendingDeleteRole)}
        title={`Delete ${pendingDeleteRole?.label ?? 'this role'}?`}
        message="This role is removed permanently and its permissions cannot be recovered."
        confirmLabel="Delete role"
        loading={deletingRole}
        onConfirm={confirmDeleteRole}
        onClose={() => setPendingDeleteRole(null)}
      />
    </Box>
  );
};

export default PermissionsPage;
