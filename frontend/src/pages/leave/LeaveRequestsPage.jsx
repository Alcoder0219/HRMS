import { useCallback, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/AddOutlined';
import ClearIcon from '@mui/icons-material/ClearOutlined';
import BeachIcon from '@mui/icons-material/BeachAccessOutlined';
import PendingIcon from '@mui/icons-material/PendingActionsOutlined';
import CheckIcon from '@mui/icons-material/CheckCircleOutlined';

import PageHeader from '@components/common/PageHeader.jsx';
import DataTable from '@components/common/DataTable.jsx';
import StatCard from '@components/common/StatCard.jsx';
import ExportMenu from '@components/common/ExportMenu.jsx';
import EmployeePicker from '@components/common/EmployeePicker.jsx';
import ConfirmDialog from '@components/feedback/ConfirmDialog.jsx';
import LeaveApplyDialog from './components/LeaveApplyDialog.jsx';
import LeaveCalendar from './components/LeaveCalendar.jsx';
import useTableState from '@hooks/useTableState.js';
import usePermissions from '@hooks/usePermissions.js';
import useAuth from '@hooks/useAuth.js';
import { RESOURCES, ACTIONS } from '@utils/permissions.js';
import leaveService from '@services/modules/leave.service.js';
import { LEAVE_STATUS_COLOR } from './leaveConstants.js';
import { formatDate, humanize } from '@utils/format.js';
import { getRowId, displayName, employeeIdentifiers } from '@utils/dataGrid.js';
import { PATHS } from '@routes/paths.js';

const now = new Date();
const YEARS = Array.from({ length: 4 }, (_, index) => now.getFullYear() - 2 + index);

/**
 * Leave requests: your own, the team's, and the calendar of who is away.
 *
 * The self-service view is a separate tab rather than a filter, because "my
 * leave" and "everyone's leave" answer different questions and need different
 * columns -- an employee does not need a name column on their own history.
 */
const LeaveRequestsPage = () => {
  const { can } = usePermissions();
  const { user } = useAuth();

  const canApply = can(RESOURCES.LEAVE, ACTIONS.CREATE);
  const canApprove = can(RESOURCES.LEAVE, ACTIONS.APPROVE);
  const linked = Boolean(user?.employeeId);

  // Someone with no employee record has no "mine" to show.
  const [tab, setTab] = useState(linked ? 'mine' : 'all');

  const table = useTableState({ initialFilters: { status: '', leaveTypeId: '', year: '' }, initialSort: 'from' });

  const [employee, setEmployee] = useState(null);
  const [rows, setRows] = useState([]);
  const [types, setTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [applyOpen, setApplyOpen] = useState(false);
  const [pendingCancel, setPendingCancel] = useState(null);

  const { params, setTotal } = table;

  useEffect(() => {
    leaveService
      .listTypes({ status: 'active', limit: 100 })
      .then((response) => setTypes(response.data ?? []))
      .catch(() => setTypes([]));
  }, []);

  const load = useCallback(() => {
    if (tab === 'calendar') return;

    setLoading(true);
    setError(null);

    leaveService
      .listRequests({
        ...params,
        mine: tab === 'mine',
        employeeId: tab === 'all' && employee ? getRowId(employee) : undefined,
      })
      .then((response) => {
        setRows(response.data ?? []);
        setTotal(response.meta?.total ?? 0);
      })
      .catch((rejection) => {
        setRows([]);
        setError(rejection?.message ?? 'Could not load leave requests');
      })
      .finally(() => setLoading(false));
  }, [tab, params, employee, setTotal]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCancel = async (reason) => {
    const target = pendingCancel;
    setPendingCancel(null);

    try {
      await leaveService.cancel(getRowId(target), { reason: reason || undefined });
      setNotice({ severity: 'success', message: `${target.requestNumber} withdrawn` });
      load();
    } catch (rejection) {
      setNotice({ severity: 'error', message: rejection?.message ?? 'Could not withdraw the request' });
    }
  };

  const counts = {
    pending: rows.filter((row) => row.status === 'PENDING').length,
    approved: rows.filter((row) => row.status === 'APPROVED').length,
  };

  const columns = [
    { key: 'requestNumber', label: 'Request', width: 130, exportValue: (row) => row.requestNumber },
    ...(tab === 'mine'
      ? []
      : [
          {
            key: 'employee',
            label: 'Employee',
            exportValue: (row) => displayName(row.employeeId),
            render: (row) => (
              <Box>
                <Typography variant="body2">{displayName(row.employeeId) || '—'}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {employeeIdentifiers(row.employeeId)}
                </Typography>
              </Box>
            ),
          },
        ]),
    {
      key: 'leaveType',
      label: 'Type',
      exportValue: (row) => row.leaveTypeId?.name,
      render: (row) => (
        <Chip
          label={row.leaveTypeId?.name ?? '—'}
          size="small"
          variant="outlined"
          sx={row.leaveTypeId?.colour ? { borderColor: row.leaveTypeId.colour } : undefined}
        />
      ),
    },
    {
      key: 'dates',
      label: 'Dates',
      sortable: true,
      exportValue: (row) => `${formatDate(row.from)} - ${formatDate(row.to)}`,
      render: (row) => (
        <Box>
          <Typography variant="body2">
            {formatDate(row.from)}
            {row.from !== row.to ? ` → ${formatDate(row.to)}` : ''}
          </Typography>
          {row.isHalfDay && (
            <Typography variant="caption" color="text.secondary">
              {humanize(row.session)}
            </Typography>
          )}
        </Box>
      ),
    },
    {
      key: 'days',
      label: 'Days',
      align: 'right',
      sortable: true,
      exportValue: (row) => row.days,
      render: (row) => <strong>{row.days}</strong>,
    },
    {
      key: 'reason',
      label: 'Reason',
      exportValue: (row) => row.reason,
      render: (row) => (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', maxWidth: 260 }}>
          {row.reason}
        </Typography>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      exportValue: (row) => humanize(row.status),
      render: (row) => (
        <Box>
          <Chip
            label={humanize(row.status)}
            size="small"
            color={LEAVE_STATUS_COLOR[row.status] ?? 'default'}
            variant={row.status === 'PENDING' ? 'filled' : 'outlined'}
          />
          {row.decision?.comment && (
            <Typography variant="caption" display="block" color="text.secondary">
              {row.decision.comment}
            </Typography>
          )}
        </Box>
      ),
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      width: 110,
      render: (row) =>
        ['PENDING', 'APPROVED'].includes(row.status) && (canApply || canApprove) ? (
          <Button size="small" color="inherit" onClick={() => setPendingCancel(row)}>
            Withdraw
          </Button>
        ) : (
          '—'
        ),
    },
  ];

  const hasFilters = table.activeFilterCount > 0 || Boolean(employee);

  return (
    <Box>
      <PageHeader
        title="Leave Requests"
        subtitle="Apply for leave, and track what has been asked for"
        breadcrumbs={[{ label: 'Home', to: PATHS.dashboard }, { label: 'Leave' }, { label: 'Requests' }]}
        actions={
          <Stack direction="row" spacing={1} data-print="hide">
            {tab !== 'calendar' && (
              <ExportMenu
                columns={columns}
                rows={rows}
                filename="leave-requests"
                totalCount={table.total}
                onError={(message) => setNotice({ severity: 'error', message })}
              />
            )}
            {canApply && (
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => setApplyOpen(true)}>
                Apply for leave
              </Button>
            )}
          </Stack>
        }
      />

      {notice && (
        <Alert severity={notice.severity} sx={{ mb: 2 }} onClose={() => setNotice(null)}>
          {notice.message}
        </Alert>
      )}

      {!linked && tab === 'all' && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Your login is not linked to an employee record, so you have no personal leave history. Applications
          you raise are on behalf of someone else.
        </Alert>
      )}

      {tab !== 'calendar' && (
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid size={{ xs: 12, sm: 4 }}>
            <StatCard label="Requests" value={table.total} icon={BeachIcon} loading={loading} />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <StatCard label="Pending (this page)" value={counts.pending} icon={PendingIcon} color="warning" loading={loading} />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <StatCard label="Approved (this page)" value={counts.approved} icon={CheckIcon} color="success" loading={loading} />
          </Grid>
        </Grid>
      )}

      <Tabs value={tab} onChange={(_event, next) => setTab(next)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
        {linked && <Tab value="mine" label="My leave" />}
        <Tab value="all" label="All requests" />
        <Tab value="calendar" label="Calendar" />
      </Tabs>

      {tab === 'calendar' ? (
        <LeaveCalendar onError={(message) => setNotice({ severity: 'error', message })} />
      ) : (
        <>
          <Stack direction="row" spacing={1} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap data-print="hide">
            {tab === 'all' && (
              <EmployeePicker value={employee} onChange={setEmployee} sx={{ width: { xs: '100%', sm: 260 } }} />
            )}

            <TextField
              select
              size="small"
              label="Status"
              value={table.filters.status}
              onChange={(event) => table.setFilter('status', event.target.value)}
              sx={{ width: 160 }}
            >
              <MenuItem value="">All statuses</MenuItem>
              {Object.keys(LEAVE_STATUS_COLOR).map((status) => (
                <MenuItem key={status} value={status}>
                  {humanize(status)}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              select
              size="small"
              label="Leave type"
              value={table.filters.leaveTypeId}
              onChange={(event) => table.setFilter('leaveTypeId', event.target.value)}
              sx={{ width: 200 }}
            >
              <MenuItem value="">All types</MenuItem>
              {types.map((type) => (
                <MenuItem key={getRowId(type)} value={getRowId(type)}>
                  {type.name}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              select
              size="small"
              label="Year"
              value={table.filters.year}
              onChange={(event) => table.setFilter('year', event.target.value)}
              sx={{ width: 130 }}
            >
              <MenuItem value="">All years</MenuItem>
              {YEARS.map((year) => (
                <MenuItem key={year} value={year}>
                  {year}
                </MenuItem>
              ))}
            </TextField>

            {hasFilters && (
              <Button
                size="small"
                color="inherit"
                startIcon={<ClearIcon />}
                onClick={() => {
                  table.resetFilters();
                  setEmployee(null);
                }}
              >
                Clear
              </Button>
            )}
          </Stack>

          <DataTable
            columns={columns}
            rows={rows}
            loading={loading}
            error={error}
            onRetry={load}
            sortBy={table.sortBy}
            sortOrder={table.sortOrder}
            onSort={table.toggleSort}
            emptyTitle={hasFilters ? 'No requests match' : 'No leave requests'}
            emptyMessage={
              hasFilters ? 'Try clearing a filter.' : canApply ? 'Apply for leave to see it here.' : null
            }
            emptyAction={
              !hasFilters && canApply ? (
                <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={() => setApplyOpen(true)}>
                  Apply for leave
                </Button>
              ) : null
            }
            page={table.page}
            limit={table.limit}
            total={table.total}
            onPageChange={table.setPage}
            onLimitChange={table.setLimit}
          />
        </>
      )}

      <LeaveApplyDialog
        open={applyOpen}
        types={types}
        // Someone with no employee record can only apply for others.
        onBehalf={!linked || tab === 'all'}
        onClose={() => setApplyOpen(false)}
        onSaved={(message) => {
          setApplyOpen(false);
          setNotice({ severity: 'success', message });
          load();
        }}
      />

      <ConfirmDialog
        open={Boolean(pendingCancel)}
        title={`Withdraw ${pendingCancel?.requestNumber ?? 'this request'}?`}
        message={
          pendingCancel?.status === 'APPROVED'
            ? 'The days are returned to the balance and the attendance days are cleared.'
            : 'The held days are returned to the balance.'
        }
        confirmLabel="Withdraw"
        confirmColor="error"
        requireReason
        reasonLabel="Reason (optional)"
        onConfirm={handleCancel}
        onClose={() => setPendingCancel(null)}
      />
    </Box>
  );
};

export default LeaveRequestsPage;
