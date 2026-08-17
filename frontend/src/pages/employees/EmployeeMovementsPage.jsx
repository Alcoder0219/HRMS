import { useCallback, useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import Link from '@mui/material/Link';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/AddOutlined';
import ClearIcon from '@mui/icons-material/ClearOutlined';
import ArrowIcon from '@mui/icons-material/ArrowForwardOutlined';
import SwapIcon from '@mui/icons-material/SwapHorizOutlined';
import TrendingUpIcon from '@mui/icons-material/TrendingUpOutlined';
import PaidIcon from '@mui/icons-material/PaidOutlined';

import PageHeader from '@components/common/PageHeader.jsx';
import DataTable from '@components/common/DataTable.jsx';
import StatCard from '@components/common/StatCard.jsx';
import ExportMenu from '@components/common/ExportMenu.jsx';
import EmployeePicker from '@components/common/EmployeePicker.jsx';
import MovementDialog from './components/MovementDialog.jsx';
import usePermissions from '@hooks/usePermissions.js';
import { RESOURCES, ACTIONS } from '@utils/permissions.js';
import { useAppDispatch, useAppSelector } from '@hooks/useRedux.js';
import { fetchMasters, selectMasters } from '@redux/slices/employeeSlice.js';
import employeeService from '@services/modules/employee.service.js';
import payrollService from '@services/modules/payroll.service.js';
import { formatCurrency, formatDate, formatDateTime, humanize } from '@utils/format.js';
import { getRowId } from '@utils/dataGrid.js';
import { PATHS } from '@routes/paths.js';

const TYPE_LABEL = {
  UNIT_TRANSFER: 'Unit',
  DEPARTMENT_TRANSFER: 'Department',
  DESIGNATION_CHANGE: 'Designation',
  GRADE_CHANGE: 'Grade',
  REPORTING_CHANGE: 'Reporting line',
};

/**
 * Transfer and promotion history.
 *
 * Both are the same screen in two modes, because they are the same underlying
 * event: a change to where an employee sits. Whether that reads as a transfer
 * or a promotion is decided by the designation levels involved, which the
 * server works out -- see backend/services/employee/employeeMovement.service.js.
 *
 * There is no transfers collection and no promotions collection. The history is
 * derived from the audit trail that `PATCH /employees/:id` already writes, so
 * a placement changed through any route -- this screen, the employee form, an
 * import -- appears here without anything extra having to remember to log it.
 */
const EmployeeMovementsPage = ({ mode = 'transfer' }) => {
  const isPromotion = mode === 'promotion';

  const dispatch = useAppDispatch();
  const masters = useAppSelector(selectMasters);
  const { can } = usePermissions();

  const canRecord = can(RESOURCES.EMPLOYEE, ACTIONS.UPDATE);
  const seesPayroll = can(RESOURCES.PAYROLL, ACTIONS.READ);

  const [employee, setEmployee] = useState(null);
  const [range, setRange] = useState({ from: '', to: '' });
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ page: 1, limit: 25, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const [revisions, setRevisions] = useState([]);
  const [revisionsLoading, setRevisionsLoading] = useState(false);

  useEffect(() => {
    dispatch(fetchMasters());
  }, [dispatch]);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);

    const params = { type: mode, page: meta.page, limit: meta.limit };

    const request = employee
      ? employeeService.movements(getRowId(employee), params)
      : employeeService.allMovements({ ...params, from: range.from, to: range.to });

    request
      .then((response) => {
        setRows(response.data ?? []);
        setMeta((previous) => ({ ...previous, total: response.meta?.total ?? 0 }));
      })
      .catch((rejection) => {
        setRows([]);
        setError(rejection?.message ?? 'Could not load the history');
      })
      .finally(() => setLoading(false));
  }, [mode, employee, range.from, range.to, meta.page, meta.limit]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Salary revisions come from the payroll module, not the audit trail.
   *
   * Fetched only for a chosen employee and only when the caller holds
   * `payroll:read` -- an HR user who can see a promotion has no automatic right
   * to see what it paid.
   */
  useEffect(() => {
    if (!isPromotion || !employee || !seesPayroll) {
      setRevisions([]);
      return;
    }

    setRevisionsLoading(true);

    payrollService
      .structureHistory(getRowId(employee))
      .then((response) => setRevisions(response.data ?? []))
      .catch(() => setRevisions([]))
      .finally(() => setRevisionsLoading(false));
  }, [isPromotion, employee, seesPayroll]);

  const columns = [
    {
      key: 'occurredAt',
      label: 'When',
      width: 170,
      exportValue: (row) => formatDateTime(row.occurredAt),
      render: (row) => formatDateTime(row.occurredAt),
    },
    ...(employee
      ? []
      : [
          {
            key: 'employeeLabel',
            label: 'Employee',
            exportValue: (row) => row.employeeLabel,
            render: (row) =>
              row.employeeId ? (
                <Link component={RouterLink} to={PATHS.employeeDetail(row.employeeId)} variant="body2" underline="hover">
                  {row.employeeLabel ?? 'Employee'}
                </Link>
              ) : (
                (row.employeeLabel ?? '—')
              ),
          },
        ]),
    {
      key: 'label',
      label: 'Changed',
      exportValue: (row) => row.label,
      render: (row) => <Chip label={TYPE_LABEL[row.type] ?? row.label} size="small" variant="outlined" />,
    },
    {
      key: 'movement',
      label: 'Movement',
      exportValue: (row) => `${row.from ?? '—'} -> ${row.to ?? '—'}`,
      render: (row) => (
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography variant="body2" color="text.secondary">
            {row.from ?? '—'}
          </Typography>
          <ArrowIcon fontSize="inherit" />
          <Typography variant="body2" fontWeight={500}>
            {row.to ?? '—'}
          </Typography>
          {row.unresolved && (
            <Tooltip title="This entry predates a fix to the audit format; the record it points at could not be resolved to a name.">
              <Chip label="legacy" size="small" variant="outlined" color="warning" />
            </Tooltip>
          )}
        </Stack>
      ),
    },
    {
      key: 'kind',
      label: 'Type',
      exportValue: (row) => humanize(row.kind),
      render: (row) => (
        <Chip
          label={humanize(row.kind)}
          size="small"
          color={row.kind === 'PROMOTION' ? 'success' : 'default'}
          variant={row.kind === 'PROMOTION' ? 'filled' : 'outlined'}
        />
      ),
    },
    {
      key: 'actorEmail',
      label: 'By',
      exportValue: (row) => row.actorEmail,
      render: (row) => (
        <Typography variant="caption" color="text.secondary">
          {row.actorEmail ?? 'System'}
        </Typography>
      ),
    },
  ];

  const revisionColumns = [
    { key: 'effectiveFrom', label: 'Effective from', render: (row) => formatDate(row.effectiveFrom) },
    {
      key: 'effectiveTo',
      label: 'Until',
      render: (row) => (row.effectiveTo ? formatDate(row.effectiveTo) : <Chip label="Current" size="small" color="success" />),
    },
    { key: 'annualCtc', label: 'Annual CTC', align: 'right', render: (row) => formatCurrency(row.annualCtc) },
    { key: 'basic', label: 'Basic', align: 'right', render: (row) => formatCurrency(row.basic) },
    {
      key: 'revisionReason',
      label: 'Reason',
      render: (row) => (
        <Typography variant="caption" color="text.secondary">
          {row.revisionReason || '—'}
        </Typography>
      ),
    },
  ];

  const promotions = rows.filter((row) => row.kind === 'PROMOTION').length;
  const hasFilters = Boolean(employee) || Boolean(range.from) || Boolean(range.to);

  const title = isPromotion ? 'Employee Promotions' : 'Employee Transfers';

  return (
    <Box>
      <PageHeader
        title={title}
        subtitle={
          isPromotion
            ? 'Moves up a designation or grade, with the salary revisions behind them'
            : 'Movement between units, departments, roles and reporting lines'
        }
        breadcrumbs={[
          { label: 'Home', to: PATHS.dashboard },
          { label: 'Employee Management' },
          { label: isPromotion ? 'Promotions' : 'Transfers' },
        ]}
        actions={
          <Stack direction="row" spacing={1} data-print="hide">
            <ExportMenu
              columns={columns}
              rows={rows}
              filename={isPromotion ? 'promotions' : 'transfers'}
              totalCount={meta.total}
              onError={(message) => setNotice({ severity: 'error', message })}
            />
            {canRecord && (
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialogOpen(true)}>
                {isPromotion ? 'Record promotion' : 'Record transfer'}
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

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard
            label={isPromotion ? 'Promotions' : 'Movements'}
            value={meta.total}
            caption={employee ? 'For this employee' : 'Across the organisation'}
            icon={isPromotion ? TrendingUpIcon : SwapIcon}
            color={isPromotion ? 'success' : 'primary'}
            loading={loading}
          />
        </Grid>

        {!isPromotion && (
          <Grid size={{ xs: 12, sm: 4 }}>
            <StatCard label="Promotions (this page)" value={promotions} icon={TrendingUpIcon} color="success" loading={loading} />
          </Grid>
        )}

        {isPromotion && seesPayroll && (
          <Grid size={{ xs: 12, sm: 4 }}>
            <StatCard
              label="Salary revisions"
              value={employee ? revisions.length : '—'}
              caption={employee ? 'For this employee' : 'Pick an employee'}
              icon={PaidIcon}
              loading={revisionsLoading}
            />
          </Grid>
        )}
      </Grid>

      <Stack direction="row" spacing={1} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap data-print="hide">
        <EmployeePicker
          value={employee}
          onChange={(next) => {
            setEmployee(next);
            setMeta((previous) => ({ ...previous, page: 1 }));
          }}
          label="Employee"
          sx={{ width: { xs: '100%', sm: 300 } }}
        />

        {!employee && (
          <>
            <TextField
              size="small"
              type="date"
              label="From"
              value={range.from}
              onChange={(event) => {
                setRange((previous) => ({ ...previous, from: event.target.value }));
                setMeta((previous) => ({ ...previous, page: 1 }));
              }}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              size="small"
              type="date"
              label="To"
              value={range.to}
              onChange={(event) => {
                setRange((previous) => ({ ...previous, to: event.target.value }));
                setMeta((previous) => ({ ...previous, page: 1 }));
              }}
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </>
        )}

        {hasFilters && (
          <Button
            size="small"
            color="inherit"
            startIcon={<ClearIcon />}
            onClick={() => {
              setEmployee(null);
              setRange({ from: '', to: '' });
              setMeta((previous) => ({ ...previous, page: 1 }));
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
        getKey={(row) => `${row.auditId}-${row.field}`}
        emptyTitle={isPromotion ? 'No promotions recorded' : 'No transfers recorded'}
        emptyMessage={
          hasFilters
            ? 'Try widening the date range, or clearing the employee filter.'
            : `A ${mode} appears here as soon as an employee's placement changes — however that change is made.`
        }
        emptyAction={
          canRecord ? (
            <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={() => setDialogOpen(true)}>
              {isPromotion ? 'Record promotion' : 'Record transfer'}
            </Button>
          ) : null
        }
        page={meta.page}
        limit={meta.limit}
        total={meta.total}
        onPageChange={(page) => setMeta((previous) => ({ ...previous, page }))}
        onLimitChange={(limit) => setMeta((previous) => ({ ...previous, limit, page: 1 }))}
      />

      {isPromotion && (
        <Box sx={{ mt: 4 }}>
          <Typography variant="h6" sx={{ mb: 1 }}>
            Salary revisions
          </Typography>

          {!seesPayroll ? (
            <Alert severity="info">
              Salary history needs payroll read access. Promotions above are shown without it.
            </Alert>
          ) : !employee ? (
            <Alert severity="info">
              Pick an employee to see their salary revisions alongside their promotions.
            </Alert>
          ) : (
            <DataTable
              columns={revisionColumns}
              rows={revisions}
              loading={revisionsLoading}
              emptyTitle="No salary revisions"
              emptyMessage="Pay changes recorded against this employee will appear here."
            />
          )}
        </Box>
      )}

      <MovementDialog
        open={dialogOpen}
        mode={mode}
        masters={masters}
        onClose={() => setDialogOpen(false)}
        onSaved={(message) => {
          setDialogOpen(false);
          setNotice({ severity: 'success', message });
          load();
        }}
      />
    </Box>
  );
};

export default EmployeeMovementsPage;
