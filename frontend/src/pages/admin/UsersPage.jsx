import { useCallback, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import AddIcon from '@mui/icons-material/AddOutlined';
import MoreIcon from '@mui/icons-material/MoreVertOutlined';
import EditIcon from '@mui/icons-material/EditOutlined';
import KeyIcon from '@mui/icons-material/VpnKeyOutlined';
import LockOpenIcon from '@mui/icons-material/LockOpenOutlined';
import BlockIcon from '@mui/icons-material/BlockOutlined';
import CheckIcon from '@mui/icons-material/CheckCircleOutlined';
import LogoutIcon from '@mui/icons-material/LogoutOutlined';
import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import PeopleIcon from '@mui/icons-material/PeopleAltOutlined';
import LinkOffIcon from '@mui/icons-material/LinkOffOutlined';

import PageHeader from '@components/common/PageHeader.jsx';
import DataTable from '@components/common/DataTable.jsx';
import StatCard from '@components/common/StatCard.jsx';
import StatusChip from '@components/common/StatusChip.jsx';
import ExportMenu from '@components/common/ExportMenu.jsx';
import ConfirmDialog from '@components/feedback/ConfirmDialog.jsx';
import { FormTextField, FormSelect } from '@components/form/FormFields.jsx';
import useTableState from '@hooks/useTableState.js';
import { useToast } from '@contexts/ToastContext.jsx';
import { useAppSelector } from '@hooks/useRedux.js';
import { selectUserRole } from '@redux/slices/authSlice.js';
import adminService from '@services/modules/admin.service.js';
import { UserFormDialog, ResetPasswordDialog, UserDetailDialog, ROLES, ACCOUNT_STATUSES } from './UserDialogs.jsx';
import { formatDateTime, humanize } from '@utils/format.js';
import { employeeIdentifiers } from '@utils/dataGrid.js';
import { PATHS } from '@routes/paths.js';

/**
 * Login accounts.
 *
 * The destructive actions live behind a per-row menu rather than as buttons on
 * the row: "suspend" and "delete" one click apart from "edit" in a dense table
 * is how the wrong account gets disabled.
 */
const UsersPage = () => {
  const table = useTableState({ initialSort: 'createdAt', initialFilters: { role: '', status: '', linked: '' } });
  const myRole = useAppSelector(selectUserRole);
  const toast = useToast();

  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [menu, setMenu] = useState({ anchor: null, user: null });
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [resetting, setResetting] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);

    adminService
      .listUsers({
        page: table.page,
        limit: table.limit,
        search: table.search,
        sortBy: table.sortBy,
        sortOrder: table.sortOrder,
        ...table.filters,
      })
      .then((response) => {
        setRows(response.data ?? []);
        table.setTotal(response.meta?.total ?? 0);
      })
      .catch((rejection) => setError(rejection?.message ?? 'Could not load users'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table.page, table.limit, table.search, table.sortBy, table.sortOrder, table.filters]);

  const loadSummary = useCallback(() => {
    adminService
      .userSummary()
      .then((response) => setSummary(response.data))
      .catch(() => setSummary(null));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  const refresh = () => {
    load();
    loadSummary();
  };

  const closeMenu = () => setMenu({ anchor: null, user: null });

  const run = async (action, successMessage) => {
    const { user } = menu;
    closeMenu();

    try {
      const response = await action(user);
      toast.success(typeof successMessage === 'function' ? successMessage(response) : successMessage);
      refresh();
    } catch (rejection) {
      toast.error(rejection?.message ?? 'That action failed');
    }
  };

  const confirmDelete = async () => {
    setDeleting(true);

    try {
      await adminService.deleteUser(pendingDelete._id);
      toast.success(`${pendingDelete.email} deleted`);
      setPendingDelete(null);
      refresh();
    } catch (rejection) {
      toast.error(rejection?.message ?? 'The account could not be deleted');
    } finally {
      setDeleting(false);
    }
  };

  const columns = [
    { key: 'email', label: 'Email', sortable: true },
    { key: 'fullName', label: 'Name', sortable: true, render: (row) => row.fullName || '—' },
    {
      key: 'role',
      label: 'Role',
      sortable: true,
      render: (row) => <Chip label={humanize(row.role)} size="small" variant="outlined" />,
    },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      render: (row) => (
        <Stack direction="row" spacing={0.5} alignItems="center">
          <StatusChip status={row.status} />
          {row.isLocked && (
            <Tooltip title={`Locked until ${formatDateTime(row.lockUntil)}`}>
              <Chip label="Locked" size="small" color="error" />
            </Tooltip>
          )}
        </Stack>
      ),
    },
    {
      key: 'employee',
      label: 'Employee',
      render: (row) =>
        row.employee ? (
          `${employeeIdentifiers(row.employee)}`
        ) : (
          <Tooltip title="This account is not linked to an employee record">
            <LinkOffIcon fontSize="small" color="disabled" />
          </Tooltip>
        ),
    },
    {
      key: 'lastLoginAt',
      label: 'Last sign-in',
      sortable: true,
      render: (row) => (row.lastLoginAt ? formatDateTime(row.lastLoginAt) : 'Never'),
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      render: (row) => (
        <IconButton
          size="small"
          aria-label={`Actions for ${row.email}`}
          onClick={(event) => {
            event.stopPropagation();
            setMenu({ anchor: event.currentTarget, user: row });
          }}
        >
          <MoreIcon fontSize="small" />
        </IconButton>
      ),
    },
  ];

  const setFilter = (field) => (value) => table.setFilters({ ...table.filters, [field]: value });

  const active = menu.user;
  const suspended = active?.status === 'SUSPENDED' || active?.status === 'DEACTIVATED';

  return (
    <Box>
      <PageHeader
        title="Users"
        subtitle="Login accounts, their roles and their access"
        breadcrumbs={[{ label: 'Home', to: PATHS.dashboard }, { label: 'Administration' }, { label: 'Users' }]}
        actions={
          <Stack direction="row" spacing={1}>
            <ExportMenu
              columns={columns.filter((column) => column.key !== 'actions')}
              rows={rows}
              filename="users"
              totalCount={table.total}
              onExcel={() => adminService.exportUsers({ ...table.filters, search: table.search })}
              onError={(message) => toast.error(message)}
            />
            <Button
              size="small"
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              New user
            </Button>
          </Stack>
        }
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 6, sm: 3 }}>
          <StatCard label="Accounts" value={summary?.total ?? 0} icon={PeopleIcon} loading={!summary} />
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <StatCard label="Active" value={summary?.byStatus?.ACTIVE ?? 0} color="success" loading={!summary} />
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <StatCard label="Locked out" value={summary?.locked ?? 0} color="error" loading={!summary} />
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <StatCard
            label="Never signed in"
            value={summary?.neverSignedIn ?? 0}
            caption="Handed over but unused"
            color="warning"
            loading={!summary}
          />
        </Grid>
      </Grid>

      <Stack direction="row" spacing={1} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap data-print="hide">
        <Box sx={{ width: 240 }}>
          <FormTextField
            label="Search"
            placeholder="Email or name"
            value={table.search}
            onChange={table.setSearch}
          />
        </Box>

        <Box sx={{ width: 180 }}>
          <FormSelect
            label="Role"
            value={table.filters.role}
            onChange={setFilter('role')}
            options={ROLES.map((role) => ({ value: role, label: humanize(role) }))}
            emptyLabel="All roles"
          />
        </Box>

        <Box sx={{ width: 170 }}>
          <FormSelect
            label="Status"
            value={table.filters.status}
            onChange={setFilter('status')}
            options={ACCOUNT_STATUSES.map((status) => ({ value: status, label: humanize(status) }))}
            emptyLabel="All statuses"
          />
        </Box>

        <Box sx={{ width: 170 }}>
          <FormSelect
            label="Employee link"
            value={table.filters.linked}
            onChange={setFilter('linked')}
            options={[
              { value: 'true', label: 'Linked' },
              { value: 'false', label: 'Not linked' },
            ]}
            emptyLabel="Any"
          />
        </Box>
      </Stack>

      <DataTable
        columns={columns}
        rows={rows}
        loading={loading}
        error={error}
        onRetry={load}
        onRowClick={(row) => setDetailId(row._id)}
        emptyTitle="No accounts match these filters"
        emptyMessage="Try widening the role or status filter."
        sortBy={table.sortBy}
        sortOrder={table.sortOrder}
        onSort={table.toggleSort}
        page={table.page}
        limit={table.limit}
        total={table.total}
        onPageChange={table.setPage}
        onLimitChange={table.setLimit}
      />

      <Menu anchorEl={menu.anchor} open={Boolean(menu.anchor)} onClose={closeMenu}>
        <MenuItem
          onClick={() => {
            setEditing(active);
            setFormOpen(true);
            closeMenu();
          }}
        >
          <ListItemIcon>
            <EditIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Edit" />
        </MenuItem>

        <MenuItem
          onClick={() => {
            setResetting(active);
            closeMenu();
          }}
        >
          <ListItemIcon>
            <KeyIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Reset password" secondary="Signs the account out everywhere" />
        </MenuItem>

        {active?.isLocked && (
          <MenuItem onClick={() => run((user) => adminService.unlockUser(user._id), 'Account unlocked')}>
            <ListItemIcon>
              <LockOpenIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary="Unlock" secondary="Clears the failed sign-in lockout" />
          </MenuItem>
        )}

        <MenuItem
          onClick={() =>
            run(
              (user) => adminService.revokeUserSessions(user._id),
              (response) => `${response.data?.sessionsRevoked ?? 0} session(s) signed out`,
            )
          }
        >
          <ListItemIcon>
            <LogoutIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Sign out everywhere" />
        </MenuItem>

        {suspended ? (
          <MenuItem
            onClick={() => run((user) => adminService.setUserStatus(user._id, { status: 'ACTIVE' }), 'Account reinstated')}
          >
            <ListItemIcon>
              <CheckIcon fontSize="small" color="success" />
            </ListItemIcon>
            <ListItemText primary="Reinstate" />
          </MenuItem>
        ) : (
          <MenuItem
            onClick={() =>
              run(
                (user) => adminService.setUserStatus(user._id, { status: 'SUSPENDED' }),
                (response) => `Account suspended, ${response.data?.sessionsRevoked ?? 0} session(s) signed out`,
              )
            }
          >
            <ListItemIcon>
              <BlockIcon fontSize="small" color="warning" />
            </ListItemIcon>
            <ListItemText primary="Suspend" secondary="Signs out and blocks sign-in" />
          </MenuItem>
        )}

        <MenuItem
          onClick={() => {
            setPendingDelete(active);
            closeMenu();
          }}
        >
          <ListItemIcon>
            <DeleteIcon fontSize="small" color="error" />
          </ListItemIcon>
          <ListItemText primary="Delete" />
        </MenuItem>
      </Menu>

      <UserFormDialog
        open={formOpen}
        user={editing}
        myRole={myRole}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          toast.success(editing ? 'Account updated' : 'Account created');
          refresh();
        }}
      />

      <ResetPasswordDialog
        open={Boolean(resetting)}
        user={resetting}
        onClose={() => setResetting(null)}
        onDone={(message) => {
          toast.success(message);
          refresh();
        }}
      />

      <UserDetailDialog open={Boolean(detailId)} userId={detailId} onClose={() => setDetailId(null)} />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={`Delete ${pendingDelete?.email ?? 'this account'}?`}
        message="The account is removed permanently and every session it holds is ended. What it did stays in the audit trail, which keeps the address as plain text."
        confirmLabel="Delete account"
        loading={deleting}
        onConfirm={confirmDelete}
        onClose={() => setPendingDelete(null)}
      />
    </Box>
  );
};

export default UsersPage;
