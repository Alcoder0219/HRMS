import { useCallback, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import InputAdornment from '@mui/material/InputAdornment';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import PaidIcon from '@mui/icons-material/PaidOutlined';
import TuneIcon from '@mui/icons-material/TuneOutlined';
import ForwardIcon from '@mui/icons-material/ForwardOutlined';

import PageHeader from '@components/common/PageHeader.jsx';
import DataTable from '@components/common/DataTable.jsx';
import ExportMenu from '@components/common/ExportMenu.jsx';
import FormDialog from '@components/common/FormDialog.jsx';
import EmployeePicker from '@components/common/EmployeePicker.jsx';
import { EmptyState } from '@components/common/StateBlock.jsx';
import useTableState from '@hooks/useTableState.js';
import usePermissions from '@hooks/usePermissions.js';
import { RESOURCES, ACTIONS } from '@utils/permissions.js';
import leaveService from '@services/modules/leave.service.js';
import { LEDGER_LABELS, LEDGER_COLOR } from './leaveConstants.js';
import { formatDateTime, humanize } from '@utils/format.js';
import { getRowId, displayName, employeeIdentifiers } from '@utils/dataGrid.js';
import { PATHS } from '@routes/paths.js';

const now = new Date();
const YEARS = Array.from({ length: 4 }, (_, index) => now.getFullYear() - 2 + index);

/**
 * Leave balances: what everyone has, and the ledger that explains it.
 *
 * Nothing is computed here. Entitlement, accrual and every limit come from the
 * server -- a balance derived in the browser would be a second opinion about
 * how many days someone has, and the wrong one to act on.
 */
const LeaveBalancePage = () => {
  const { can } = usePermissions();
  const canManage = can(RESOURCES.LEAVE, ACTIONS.APPROVE);

  const [tab, setTab] = useState('org');
  const table = useTableState({ initialFilters: { year: now.getFullYear(), leaveTypeId: '' } });

  const [rows, setRows] = useState([]);
  const [types, setTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [employee, setEmployee] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [action, setAction] = useState(null); // { type: 'encash'|'adjust'|'carry', balance }
  const [actionForm, setActionForm] = useState({ days: '', note: '', fromYear: now.getFullYear() });
  const [saving, setSaving] = useState(false);

  const { params, setTotal } = table;

  useEffect(() => {
    leaveService
      .listTypes({ status: 'active', limit: 100 })
      .then((response) => setTypes(response.data ?? []))
      .catch(() => setTypes([]));
  }, []);

  const load = useCallback(() => {
    if (tab !== 'org') return;

    setLoading(true);
    setError(null);

    leaveService
      .listBalances(params)
      .then((response) => {
        setRows(response.data ?? []);
        setTotal(response.meta?.total ?? 0);
      })
      .catch((rejection) => {
        setRows([]);
        setError(rejection?.message ?? 'Could not load balances');
      })
      .finally(() => setLoading(false));
  }, [tab, params, setTotal]);

  useEffect(() => {
    load();
  }, [load]);

  /** Materialises and returns every active type's balance for one employee. */
  const loadEmployee = useCallback(() => {
    if (!employee) {
      setDetail(null);
      return;
    }

    setDetailLoading(true);

    leaveService
      .myBalances({ employeeId: getRowId(employee), year: table.filters.year })
      .then((response) => setDetail(response.data))
      .catch((rejection) => {
        setDetail(null);
        setNotice({ severity: 'error', message: rejection?.message ?? 'Could not load the balances' });
      })
      .finally(() => setDetailLoading(false));
  }, [employee, table.filters.year]);

  useEffect(() => {
    loadEmployee();
  }, [loadEmployee]);

  const openAction = (type, balance) => {
    setAction({ type, balance });
    setActionForm({ days: '', note: '', fromYear: now.getFullYear() });
  };

  const runAction = async () => {
    setSaving(true);

    try {
      if (action.type === 'encash') {
        await leaveService.encash(getRowId(action.balance), {
          days: Number(actionForm.days),
          note: actionForm.note.trim() || undefined,
        });
        setNotice({ severity: 'success', message: `${actionForm.days} day(s) encashed` });
      }

      if (action.type === 'adjust') {
        await leaveService.adjust(getRowId(action.balance), {
          days: Number(actionForm.days),
          note: actionForm.note.trim(),
        });
        setNotice({ severity: 'success', message: 'Balance adjusted' });
      }

      if (action.type === 'carry') {
        const result = await leaveService.carryForward({
          fromYear: Number(actionForm.fromYear),
          toYear: Number(actionForm.fromYear) + 1,
        });
        setNotice({ severity: 'success', message: result.message ?? 'Carry forward complete' });
      }

      setAction(null);
      load();
      loadEmployee();
    } catch (rejection) {
      setNotice({ severity: 'error', message: rejection?.message ?? 'The action failed' });
    } finally {
      setSaving(false);
    }
  };

  const columns = [
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
      label: 'Leave type',
      exportValue: (row) => row.leaveTypeId?.name,
      render: (row) => row.leaveTypeId?.name ?? '—',
    },
    { key: 'entitled', label: 'Entitled', align: 'right' },
    { key: 'carriedForward', label: 'Carried', align: 'right' },
    { key: 'adjusted', label: 'Adjusted', align: 'right' },
    { key: 'taken', label: 'Taken', align: 'right' },
    {
      key: 'pending',
      label: 'Pending',
      align: 'right',
      render: (row) => (row.pending ? <Chip label={row.pending} size="small" color="warning" variant="outlined" /> : '—'),
    },
    { key: 'encashed', label: 'Encashed', align: 'right' },
    { key: 'lapsed', label: 'Lapsed', align: 'right' },
    {
      key: 'available',
      label: 'Available',
      align: 'right',
      render: (row) => (
        <Typography variant="body2" fontWeight={700} color={row.available < 0 ? 'error.main' : 'success.main'}>
          {row.available}
        </Typography>
      ),
    },
    ...(canManage
      ? [
          {
            key: 'actions',
            label: '',
            align: 'right',
            width: 150,
            render: (row) => (
              <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                <Button size="small" onClick={() => openAction('encash', row)}>
                  Encash
                </Button>
                <Button size="small" color="inherit" onClick={() => openAction('adjust', row)}>
                  Adjust
                </Button>
              </Stack>
            ),
          },
        ]
      : []),
  ];

  return (
    <Box>
      <PageHeader
        title="Leave Balance"
        subtitle="Entitlement, what has been used, and what remains"
        breadcrumbs={[{ label: 'Home', to: PATHS.dashboard }, { label: 'Leave' }, { label: 'Balance' }]}
        actions={
          <Stack direction="row" spacing={1} data-print="hide">
            <ExportMenu
              columns={columns}
              rows={rows}
              filename={`leave-balances-${table.filters.year}`}
              totalCount={table.total}
              onExcel={() => leaveService.exportReport({ year: table.filters.year, leaveTypeId: table.filters.leaveTypeId })}
              onPdf={() => leaveService.exportReportPdf({ year: table.filters.year, leaveTypeId: table.filters.leaveTypeId })}
              onError={(message) => setNotice({ severity: 'error', message })}
            />
            {canManage && (
              <Button variant="contained" startIcon={<ForwardIcon />} onClick={() => openAction('carry')}>
                Carry forward
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

      <Tabs value={tab} onChange={(_event, next) => setTab(next)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Tab value="org" label="All balances" />
        <Tab value="employee" label="One employee" />
      </Tabs>

      <Stack direction="row" spacing={1} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap data-print="hide">
        <TextField
          select
          size="small"
          label="Year"
          value={table.filters.year}
          onChange={(event) => table.setFilter('year', Number(event.target.value))}
          sx={{ width: 130 }}
        >
          {YEARS.map((year) => (
            <MenuItem key={year} value={year}>
              {year}
            </MenuItem>
          ))}
        </TextField>

        {tab === 'org' ? (
          <TextField
            select
            size="small"
            label="Leave type"
            value={table.filters.leaveTypeId}
            onChange={(event) => table.setFilter('leaveTypeId', event.target.value)}
            sx={{ width: 220 }}
          >
            <MenuItem value="">All types</MenuItem>
            {types.map((type) => (
              <MenuItem key={getRowId(type)} value={getRowId(type)}>
                {type.name}
              </MenuItem>
            ))}
          </TextField>
        ) : (
          <EmployeePicker value={employee} onChange={setEmployee} sx={{ width: { xs: '100%', sm: 320 } }} />
        )}
      </Stack>

      {tab === 'org' ? (
        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          error={error}
          onRetry={load}
          emptyTitle="No balances for this year"
          emptyMessage="A balance is created the first time an employee's entitlement is read or they apply for leave."
          page={table.page}
          limit={table.limit}
          total={table.total}
          onPageChange={table.setPage}
          onLimitChange={table.setLimit}
        />
      ) : !employee ? (
        <EmptyState
          title="Choose an employee"
          message="Search above to see every leave type they hold a balance in, with the ledger behind it."
          minHeight={260}
        />
      ) : (
        <>
          {detailLoading && <LinearProgress sx={{ mb: 2 }} />}

          <Grid container spacing={2}>
            {(detail?.balances ?? []).map((balance) => (
              <Grid key={getRowId(balance)} size={{ xs: 12, md: 6 }}>
                <Card variant="outlined" sx={{ height: '100%' }}>
                  <CardContent>
                    <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                      <Box>
                        <Typography variant="h6">{balance.leaveType.name}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {balance.leaveType.isPaid ? 'Paid' : 'Unpaid'} · {detail.year}
                        </Typography>
                      </Box>

                      <Box sx={{ textAlign: 'right' }}>
                        <Typography variant="h4" color={balance.available < 0 ? 'error.main' : 'success.main'}>
                          {balance.available}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          available
                        </Typography>
                      </Box>
                    </Stack>

                    <Divider sx={{ my: 1.5 }} />

                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
                      <Chip label={`Entitled ${balance.entitled}`} size="small" variant="outlined" />
                      {balance.carriedForward > 0 && <Chip label={`Carried ${balance.carriedForward}`} size="small" variant="outlined" color="info" />}
                      {balance.adjusted !== 0 && <Chip label={`Adjusted ${balance.adjusted > 0 ? '+' : ''}${balance.adjusted}`} size="small" variant="outlined" />}
                      <Chip label={`Taken ${balance.taken}`} size="small" variant="outlined" color="warning" />
                      {balance.pending > 0 && <Chip label={`Pending ${balance.pending}`} size="small" color="warning" />}
                      {balance.encashed > 0 && <Chip label={`Encashed ${balance.encashed}`} size="small" variant="outlined" color="primary" />}
                      {balance.lapsed > 0 && <Chip label={`Lapsed ${balance.lapsed}`} size="small" variant="outlined" color="error" />}
                    </Stack>

                    {canManage && (
                      <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
                        <Button size="small" startIcon={<PaidIcon />} onClick={() => openAction('encash', balance)}>
                          Encash
                        </Button>
                        <Button size="small" color="inherit" startIcon={<TuneIcon />} onClick={() => openAction('adjust', balance)}>
                          Adjust
                        </Button>
                      </Stack>
                    )}

                    {/* The ledger is why the balance is explainable at all. */}
                    <Typography variant="caption" color="text.secondary">
                      Ledger
                    </Typography>
                    <Stack spacing={0.5} sx={{ mt: 0.5, maxHeight: 180, overflowY: 'auto' }}>
                      {(balance.ledger ?? []).length === 0 && (
                        <Typography variant="caption" color="text.secondary">
                          No movements yet.
                        </Typography>
                      )}

                      {[...(balance.ledger ?? [])].reverse().map((entry) => (
                        <Stack key={entry._id ?? `${entry.action}-${entry.at}`} direction="row" spacing={1} alignItems="center">
                          <Chip
                            label={LEDGER_LABELS[entry.action] ?? humanize(entry.action)}
                            size="small"
                            color={LEDGER_COLOR[entry.action] ?? 'default'}
                            variant="outlined"
                            sx={{ minWidth: 130 }}
                          />
                          <Typography variant="caption" fontWeight={600}>
                            {entry.days > 0 ? '+' : ''}
                            {entry.days}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" noWrap>
                            {entry.note ?? ''} · {formatDateTime(entry.at)}
                          </Typography>
                        </Stack>
                      ))}
                    </Stack>
                  </CardContent>
                </Card>
              </Grid>
            ))}

            {detail && detail.balances.length === 0 && (
              <Grid size={12}>
                <EmptyState title="No active leave types" message="Create a leave type before balances can exist." />
              </Grid>
            )}
          </Grid>
        </>
      )}

      <FormDialog
        open={Boolean(action)}
        title={
          { encash: 'Encash leave', adjust: 'Adjust balance', carry: 'Carry forward to the next year' }[action?.type] ??
          ''
        }
        subtitle={
          action?.balance
            ? `${action.balance.leaveType?.name ?? action.balance.leaveTypeId?.name ?? ''} — ${action.balance.available} day(s) available`
            : 'Moves every eligible balance across a year boundary'
        }
        submitting={saving}
        submitLabel={{ encash: 'Encash', adjust: 'Adjust', carry: 'Run carry forward' }[action?.type] ?? 'Confirm'}
        disabled={
          (action?.type === 'encash' && !Number(actionForm.days)) ||
          (action?.type === 'adjust' && (!Number(actionForm.days) || actionForm.note.trim().length < 3))
        }
        onSubmit={runAction}
        onClose={() => setAction(null)}
      >
        <Grid container spacing={2} sx={{ pt: 0.5 }}>
          {action?.type === 'carry' ? (
            <>
              <Grid size={12}>
                <TextField
                  select
                  label="Carry from year"
                  size="small"
                  fullWidth
                  value={actionForm.fromYear}
                  onChange={(event) => setActionForm((p) => ({ ...p, fromYear: event.target.value }))}
                  helperText={`Into ${Number(actionForm.fromYear) + 1}. Running it twice is safe — balances already carried are skipped.`}
                >
                  {YEARS.map((year) => (
                    <MenuItem key={year} value={year}>
                      {year}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid size={12}>
                <Alert severity="warning">
                  Days beyond each leave type&apos;s carry-forward limit lapse and are recorded as lapsed rather
                  than silently dropped.
                </Alert>
              </Grid>
            </>
          ) : (
            <>
              <Grid size={12}>
                <TextField
                  label="Days"
                  type="number"
                  size="small"
                  fullWidth
                  required
                  value={actionForm.days}
                  onChange={(event) => setActionForm((p) => ({ ...p, days: event.target.value }))}
                  helperText={
                    action?.type === 'adjust'
                      ? 'Negative removes days, positive grants them'
                      : 'The server caps this by the leave type’s encashment limit'
                  }
                  slotProps={{
                    input: {
                      endAdornment: <InputAdornment position="end">days</InputAdornment>,
                      inputProps: action?.type === 'adjust' ? { step: 0.5 } : { min: 0.5, step: 0.5 },
                    },
                  }}
                />
              </Grid>

              <Grid size={12}>
                <TextField
                  label={action?.type === 'adjust' ? 'Reason (required)' : 'Note'}
                  size="small"
                  fullWidth
                  required={action?.type === 'adjust'}
                  value={actionForm.note}
                  onChange={(event) => setActionForm((p) => ({ ...p, note: event.target.value }))}
                  multiline
                  rows={2}
                  helperText={action?.type === 'adjust' ? 'Recorded on the ledger against this movement' : null}
                />
              </Grid>
            </>
          )}
        </Grid>
      </FormDialog>
    </Box>
  );
};

export default LeaveBalancePage;
