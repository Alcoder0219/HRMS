import { useCallback, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CheckIcon from '@mui/icons-material/CheckOutlined';
import CloseIcon from '@mui/icons-material/CloseOutlined';
import PendingIcon from '@mui/icons-material/PendingActionsOutlined';

import PageHeader from '@components/common/PageHeader.jsx';
import DataTable from '@components/common/DataTable.jsx';
import StatCard from '@components/common/StatCard.jsx';
import ExportMenu from '@components/common/ExportMenu.jsx';
import ConfirmDialog from '@components/feedback/ConfirmDialog.jsx';
import useTableState from '@hooks/useTableState.js';
import useAuth from '@hooks/useAuth.js';
import leaveService from '@services/modules/leave.service.js';
import { formatDate, humanize } from '@utils/format.js';
import { getRowId, displayName, employeeIdentifiers } from '@utils/dataGrid.js';
import { PATHS } from '@routes/paths.js';

/**
 * The approval queue.
 *
 * Deliberately only pending requests: an inbox that also shows what has already
 * been decided stops being a to-do list. Everything else lives on the Requests
 * screen.
 */
const LeaveApprovalPage = () => {
  const { user } = useAuth();
  const table = useTableState({ initialFilters: { status: 'PENDING' }, initialSort: 'from', initialSortOrder: 'asc' });

  const [rows, setRows] = useState([]);
  const [pending, setPending] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [decision, setDecision] = useState(null);
  const [busy, setBusy] = useState(false);

  const { params, setTotal } = table;

  const load = useCallback(() => {
    setLoading(true);
    setError(null);

    leaveService
      .listRequests(params)
      .then((response) => {
        setRows(response.data ?? []);
        setTotal(response.meta?.total ?? 0);
      })
      .catch((rejection) => {
        setRows([]);
        setError(rejection?.message ?? 'Could not load the approval queue');
      })
      .finally(() => setLoading(false));

    leaveService
      .pendingCount()
      .then((response) => setPending(response.data?.pending ?? 0))
      .catch(() => setPending(0));
  }, [params, setTotal]);

  useEffect(() => {
    load();
  }, [load]);

  const decide = async (comment) => {
    const target = decision;
    setDecision(null);
    setBusy(true);

    try {
      await leaveService.decide(target.id, {
        decision: target.approve ? 'APPROVED' : 'REJECTED',
        ...(comment ? { comment } : {}),
      });

      setNotice({
        severity: 'success',
        message: `${target.number} ${target.approve ? 'approved' : 'rejected'}`,
      });
      load();
    } catch (rejection) {
      setNotice({ severity: 'error', message: rejection?.message ?? 'The decision could not be saved' });
    } finally {
      setBusy(false);
    }
  };

  const columns = [
    { key: 'requestNumber', label: 'Request', width: 130 },
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
    {
      key: 'leaveType',
      label: 'Type',
      exportValue: (row) => row.leaveTypeId?.name,
      render: (row) => <Chip label={row.leaveTypeId?.name ?? '—'} size="small" variant="outlined" />,
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
    { key: 'days', label: 'Days', align: 'right', render: (row) => <strong>{row.days}</strong> },
    {
      key: 'reason',
      label: 'Reason',
      exportValue: (row) => row.reason,
      render: (row) => (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', maxWidth: 280 }}>
          {row.reason}
        </Typography>
      ),
    },
    {
      key: 'appliedAt',
      label: 'Applied',
      exportValue: (row) => formatDate(row.createdAt),
      render: (row) => (
        <Typography variant="caption" color="text.secondary">
          {formatDate(row.createdAt)}
        </Typography>
      ),
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      width: 170,
      render: (row) => {
        // The server refuses self-approval; offering the button would only
        // produce a guaranteed 403.
        const isOwn = String(row.employeeId?._id ?? row.employeeId) === String(user?.employeeId ?? '');

        if (isOwn) {
          return (
            <Typography variant="caption" color="text.secondary">
              Your own request
            </Typography>
          );
        }

        return (
          <Stack direction="row" spacing={0.5} justifyContent="flex-end">
            <Button
              size="small"
              color="success"
              startIcon={<CheckIcon />}
              disabled={busy}
              onClick={() => setDecision({ id: getRowId(row), number: row.requestNumber, approve: true })}
            >
              Approve
            </Button>
            <Button
              size="small"
              color="error"
              startIcon={<CloseIcon />}
              disabled={busy}
              onClick={() => setDecision({ id: getRowId(row), number: row.requestNumber, approve: false })}
            >
              Reject
            </Button>
          </Stack>
        );
      },
    },
  ];

  return (
    <Box>
      <PageHeader
        title="Leave Approval"
        subtitle="Requests waiting on a decision"
        breadcrumbs={[{ label: 'Home', to: PATHS.dashboard }, { label: 'Leave' }, { label: 'Approval' }]}
        actions={
          <ExportMenu
            columns={columns}
            rows={rows}
            filename="leave-approvals"
            totalCount={table.total}
            onError={(message) => setNotice({ severity: 'error', message })}
          />
        }
      />

      {notice && (
        <Alert severity={notice.severity} sx={{ mb: 2 }} onClose={() => setNotice(null)}>
          {notice.message}
        </Alert>
      )}

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 6 }}>
          <StatCard
            label="Awaiting your decision"
            value={pending}
            caption="Across everyone you can approve for"
            icon={PendingIcon}
            color={pending ? 'warning' : 'success'}
            loading={loading}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <StatCard
            label="Days requested"
            value={rows.reduce((sum, row) => sum + (row.days ?? 0), 0)}
            caption="On this page"
            loading={loading}
          />
        </Grid>
      </Grid>

      <DataTable
        columns={columns}
        rows={rows}
        loading={loading}
        error={error}
        onRetry={load}
        sortBy={table.sortBy}
        sortOrder={table.sortOrder}
        onSort={table.toggleSort}
        emptyTitle="Nothing awaiting approval"
        emptyMessage="Requests appear here the moment they are raised."
        page={table.page}
        limit={table.limit}
        total={table.total}
        onPageChange={table.setPage}
        onLimitChange={table.setLimit}
      />

      <ConfirmDialog
        open={Boolean(decision)}
        title={decision?.approve ? `Approve ${decision.number}?` : `Reject ${decision?.number}?`}
        message={
          decision?.approve
            ? 'The days are deducted from the balance and the attendance days are marked as leave.'
            : 'The held days are returned to the balance. The employee sees your reason, so one is required.'
        }
        confirmLabel={decision?.approve ? 'Approve' : 'Reject'}
        confirmColor={decision?.approve ? 'success' : 'error'}
        requireReason={!decision?.approve}
        reasonLabel="Reason for rejection"
        loading={busy}
        onConfirm={decide}
        onClose={() => setDecision(null)}
      />
    </Box>
  );
};

export default LeaveApprovalPage;
