import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/AddOutlined';
import ClearIcon from '@mui/icons-material/ClearOutlined';

import PageHeader from '@components/common/PageHeader.jsx';
import DataTable from '@components/common/DataTable.jsx';
import EmployeePicker from '@components/common/EmployeePicker.jsx';
import ExportMenu from '@components/common/ExportMenu.jsx';
import ConfirmDialog from '@components/feedback/ConfirmDialog.jsx';
import useTableState from '@hooks/useTableState.js';
import usePermissions from '@hooks/usePermissions.js';
import { RESOURCES, ACTIONS } from '@utils/permissions.js';
import payrollService from '@services/modules/payroll.service.js';
import LoanFormDialog, { LOAN_TYPES } from './components/LoanFormDialog.jsx';
import { formatCurrency, formatDate, humanize } from '@utils/format.js';
import { getRowId, displayName, employeeIdentifiers } from '@utils/dataGrid.js';
import { PATHS } from '@routes/paths.js';

const STATUS_COLOR = {
  PENDING: 'warning',
  APPROVED: 'info',
  DISBURSED: 'info',
  ACTIVE: 'primary',
  CLOSED: 'success',
  REJECTED: 'error',
  CANCELLED: 'default',
};

/**
 * Loans and salary advances recovered through payroll.
 *
 * The decision buttons are gated on APPROVE, matching the API: raising a
 * request and agreeing to lend against future salary are deliberately separate
 * rights.
 */
const LoansPage = () => {
  const navigate = useNavigate();
  const { can } = usePermissions();

  const canCreate = can(RESOURCES.PAYROLL, ACTIONS.CREATE);
  const canDecide = can(RESOURCES.PAYROLL, ACTIONS.APPROVE);

  const table = useTableState({ initialFilters: { status: '', type: '' }, initialSort: 'createdAt' });

  const [employee, setEmployee] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [decision, setDecision] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const { params, setTotal } = table;

  const load = useCallback(() => {
    setLoading(true);
    setError(null);

    payrollService
      .listLoans({ ...params, employeeId: employee ? getRowId(employee) : undefined })
      .then((response) => {
        setRows(response.data ?? []);
        setTotal(response.meta?.total ?? 0);
      })
      .catch((rejection) => {
        setRows([]);
        setError(rejection?.message ?? 'Could not load loans');
      })
      .finally(() => setLoading(false));
  }, [params, employee, setTotal]);

  useEffect(() => {
    load();
  }, [load]);

  const handleDecision = async (reason) => {
    const target = decision;
    setDecision(null);
    setBusy(true);

    try {
      await payrollService.decideLoan(target.id, {
        decision: target.approve ? 'APPROVED' : 'REJECTED',
        // The validator calls this `reason`, and requires it on a rejection.
        // It was previously sent as `rejectionReason`, which the schema does
        // not allow -- every rejection failed validation.
        ...(target.approve ? {} : { reason: reason || undefined }),
      });

      setNotice({ severity: 'success', message: `Loan ${target.approve ? 'approved' : 'rejected'}` });
      load();
    } catch (rejection) {
      setNotice({ severity: 'error', message: rejection?.message ?? 'The decision could not be saved' });
    } finally {
      setBusy(false);
    }
  };

  const columns = [
    { key: 'loanNumber', label: 'Loan', width: 130, sortable: true },
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
    { key: 'type', label: 'Type', exportValue: (row) => humanize(row.type), render: (row) => humanize(row.type) },
    {
      key: 'principal',
      label: 'Principal',
      align: 'right',
      sortable: true,
      exportValue: (row) => row.principal,
      render: (row) => formatCurrency(row.principal),
    },
    {
      key: 'emi',
      label: 'EMI',
      align: 'right',
      exportValue: (row) => row.emi,
      render: (row) => (
        <Box>
          <Typography variant="body2">{formatCurrency(row.emi)}</Typography>
          <Typography variant="caption" color="text.secondary">
            {row.tenureMonths} months
          </Typography>
        </Box>
      ),
    },
    {
      key: 'recovery',
      label: 'Recovered',
      width: 160,
      exportValue: (row) => row.recoveredAmount,
      render: (row) => {
        const share = row.totalPayable ? Math.min(100, (row.recoveredAmount / row.totalPayable) * 100) : 0;

        return (
          <Box sx={{ minWidth: 130 }}>
            <Typography variant="caption">
              {formatCurrency(row.recoveredAmount)} of {formatCurrency(row.totalPayable)}
            </Typography>
            <LinearProgress
              variant="determinate"
              value={share}
              sx={{ mt: 0.5, height: 5, borderRadius: 3 }}
              color={share >= 100 ? 'success' : 'primary'}
            />
          </Box>
        );
      },
    },
    {
      key: 'outstanding',
      label: 'Outstanding',
      align: 'right',
      sortable: true,
      exportValue: (row) => row.outstanding,
      render: (row) => <strong>{formatCurrency(row.outstanding)}</strong>,
    },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      exportValue: (row) => humanize(row.status),
      render: (row) => (
        <Box>
          <Chip label={humanize(row.status)} size="small" color={STATUS_COLOR[row.status] ?? 'default'} variant="outlined" />
          {row.isOnHold && <Chip label="On hold" size="small" color="warning" sx={{ ml: 0.5 }} />}
          {row.disbursedOn && (
            <Typography variant="caption" display="block" color="text.secondary">
              {formatDate(row.disbursedOn)}
            </Typography>
          )}
        </Box>
      ),
    },
    ...(canDecide
      ? [
          {
            key: 'actions',
            label: '',
            align: 'right',
            width: 150,
            render: (row) =>
              row.status === 'PENDING' ? (
                <Stack direction="row" spacing={0.5} justifyContent="flex-end" onClick={(event) => event.stopPropagation()}>
                  <Button size="small" color="success" disabled={busy} onClick={() => setDecision({ id: getRowId(row), approve: true })}>
                    Approve
                  </Button>
                  <Button size="small" color="error" disabled={busy} onClick={() => setDecision({ id: getRowId(row), approve: false })}>
                    Reject
                  </Button>
                </Stack>
              ) : (
                '—'
              ),
          },
        ]
      : []),
  ];

  const hasFilters = table.activeFilterCount > 0 || Boolean(employee);

  return (
    <Box>
      <PageHeader
        title="Loans"
        subtitle="Loans and salary advances recovered through payroll"
        breadcrumbs={[{ label: 'Home', to: PATHS.dashboard }, { label: 'Payroll' }, { label: 'Loans' }]}
        actions={
          <Stack direction="row" spacing={1} data-print="hide">
            <ExportMenu
              columns={columns}
              rows={rows}
              filename="loans"
              totalCount={table.total}
              onError={(message) => setNotice({ severity: 'error', message })}
            />
            {canCreate && (
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}>
                Raise loan
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

      <Stack direction="row" spacing={1} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap data-print="hide">
        <EmployeePicker value={employee} onChange={setEmployee} sx={{ width: { xs: '100%', sm: 280 } }} />

        <TextField
          select
          size="small"
          label="Status"
          value={table.filters.status}
          onChange={(event) => table.setFilter('status', event.target.value)}
          sx={{ width: 170 }}
        >
          <MenuItem value="">All statuses</MenuItem>
          {Object.keys(STATUS_COLOR).map((status) => (
            <MenuItem key={status} value={status}>
              {humanize(status)}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          select
          size="small"
          label="Type"
          value={table.filters.type}
          onChange={(event) => table.setFilter('type', event.target.value)}
          sx={{ width: 190 }}
        >
          <MenuItem value="">All types</MenuItem>
          {LOAN_TYPES.map((type) => (
            <MenuItem key={type} value={type}>
              {humanize(type)}
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
        onRowClick={(row) => navigate(`/payroll/loans/${getRowId(row)}`)}
        emptyTitle={hasFilters ? 'No loans match these filters' : 'No loans yet'}
        emptyMessage={
          hasFilters ? 'Try clearing a filter.' : canCreate ? 'Raise the first loan or salary advance.' : null
        }
        emptyAction={
          !hasFilters && canCreate ? (
            <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}>
              Raise loan
            </Button>
          ) : null
        }
        page={table.page}
        limit={table.limit}
        total={table.total}
        onPageChange={table.setPage}
        onLimitChange={table.setLimit}
      />

      <LoanFormDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={(message) => {
          setCreateOpen(false);
          setNotice({ severity: 'success', message });
          load();
        }}
      />

      <ConfirmDialog
        open={Boolean(decision)}
        title={decision?.approve ? 'Approve this loan?' : 'Reject this loan?'}
        message={
          decision?.approve
            ? 'Approving schedules the instalments. Recovery starts from the month set on the request.'
            : 'The employee sees your reason. A rejection needs one.'
        }
        confirmLabel={decision?.approve ? 'Approve' : 'Reject'}
        confirmColor={decision?.approve ? 'success' : 'error'}
        requireReason={!decision?.approve}
        reasonLabel="Reason for rejection"
        loading={busy}
        onConfirm={handleDecision}
        onClose={() => setDecision(null)}
      />
    </Box>
  );
};

export default LoansPage;
