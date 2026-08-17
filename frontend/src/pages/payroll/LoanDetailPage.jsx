import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, Link as RouterLink } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import LinearProgress from '@mui/material/LinearProgress';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import BackIcon from '@mui/icons-material/ArrowBackOutlined';
import CheckIcon from '@mui/icons-material/CheckCircleOutlined';
import BlockIcon from '@mui/icons-material/BlockOutlined';
import PaidIcon from '@mui/icons-material/PaidOutlined';
import ReplayIcon from '@mui/icons-material/ReplayOutlined';

import PageHeader from '@components/common/PageHeader.jsx';
import DataTable from '@components/common/DataTable.jsx';
import ConfirmDialog from '@components/feedback/ConfirmDialog.jsx';
import { LoadingState, ErrorState } from '@components/common/StateBlock.jsx';
import usePermissions from '@hooks/usePermissions.js';
import { RESOURCES, ACTIONS } from '@utils/permissions.js';
import payrollService from '@services/modules/payroll.service.js';
import { formatCurrency, formatDate, humanize } from '@utils/format.js';
import { displayName } from '@utils/dataGrid.js';
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

const INSTALMENT_COLOR = { PENDING: 'default', PAID: 'success', SKIPPED: 'warning', WAIVED: 'info' };

const monthName = (month) => new Date(2000, month - 1).toLocaleString([], { month: 'short' });

/**
 * One loan: its terms, its recovery ledger, and the actions its current status
 * allows.
 *
 * The instalment schedule is the reason this page exists. A single "outstanding"
 * figure cannot answer "which month was missed and why", which is the question
 * that arrives when someone's take-home pay changes unexpectedly.
 */
const LoanDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = usePermissions();

  const canApprove = can(RESOURCES.PAYROLL, ACTIONS.APPROVE);

  const [loan, setLoan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);

    payrollService
      .getLoan(id)
      .then((response) => setLoan(response.data))
      .catch((rejection) => setError(rejection?.message ?? 'Could not load the loan'))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (input) => {
    const action = pending;
    setPending(null);
    setBusy(true);

    try {
      if (action === 'approve') await payrollService.decideLoan(id, { decision: 'APPROVED' });
      // The validator names this field `reason`, for both a rejection and a hold.
      if (action === 'reject') await payrollService.decideLoan(id, { decision: 'REJECTED', reason: input });
      if (action === 'disburse') await payrollService.disburseLoan(id, {});
      if (action === 'hold') await payrollService.holdLoan(id, { hold: !loan.isOnHold, reason: input || null });
      if (action === 'repayment') {
        const amount = Number(input);
        if (!amount || amount <= 0) throw { message: 'Enter the amount received' };
        await payrollService.recordRepayment(id, { amount });
      }

      setNotice({ severity: 'success', message: 'Loan updated' });
      load();
    } catch (rejection) {
      setNotice({ severity: 'error', message: rejection?.message ?? 'The action failed' });
    } finally {
      setBusy(false);
    }
  };

  const line = (label, value) => (
    <Stack direction="row" justifyContent="space-between" sx={{ py: 0.75 }} spacing={2}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" fontWeight={500} align="right">
        {value}
      </Typography>
    </Stack>
  );

  const columns = [
    { key: 'sequence', label: '#', width: 60 },
    {
      key: 'due',
      label: 'Due',
      render: (row) => `${monthName(row.dueMonth)} ${row.dueYear}`,
    },
    { key: 'amount', label: 'Instalment', align: 'right', render: (row) => formatCurrency(row.amount) },
    { key: 'paidAmount', label: 'Recovered', align: 'right', render: (row) => formatCurrency(row.paidAmount) },
    { key: 'paidOn', label: 'Recovered on', render: (row) => (row.paidOn ? formatDate(row.paidOn) : '—') },
    {
      key: 'status',
      label: 'Status',
      render: (row) => (
        <Chip
          label={humanize(row.status)}
          size="small"
          color={INSTALMENT_COLOR[row.status] ?? 'default'}
          variant={row.status === 'PAID' ? 'filled' : 'outlined'}
        />
      ),
    },
  ];

  if (loading) return <LoadingState message="Loading loan…" minHeight={320} />;

  if (error) {
    return (
      <Box>
        <PageHeader title="Loan" breadcrumbs={[{ label: 'Home', to: PATHS.dashboard }, { label: 'Loans', to: PATHS.loans }]} />
        <ErrorState message={error} onRetry={load} />
      </Box>
    );
  }

  const recovered = loan.totalPayable ? Math.min(100, (loan.recoveredAmount / loan.totalPayable) * 100) : 0;

  return (
    <Box>
      <PageHeader
        title={loan.loanNumber}
        subtitle={`${humanize(loan.type)} · ${displayName(loan.employeeId) || 'Employee'}`}
        breadcrumbs={[
          { label: 'Home', to: PATHS.dashboard },
          { label: 'Payroll' },
          { label: 'Loans', to: PATHS.loans },
          { label: loan.loanNumber },
        ]}
        actions={
          <Stack direction="row" spacing={1} data-print="hide">
            <Button size="small" startIcon={<BackIcon />} onClick={() => navigate(PATHS.loans)}>
              Back
            </Button>

            {canApprove && loan.status === 'PENDING' && (
              <>
                <Button size="small" variant="contained" color="success" startIcon={<CheckIcon />} disabled={busy} onClick={() => setPending('approve')}>
                  Approve
                </Button>
                <Button size="small" color="error" startIcon={<BlockIcon />} disabled={busy} onClick={() => setPending('reject')}>
                  Reject
                </Button>
              </>
            )}

            {canApprove && loan.status === 'APPROVED' && (
              <Button size="small" variant="contained" startIcon={<PaidIcon />} disabled={busy} onClick={() => setPending('disburse')}>
                Disburse
              </Button>
            )}

            {canApprove && ['DISBURSED', 'ACTIVE'].includes(loan.status) && (
              <>
                <Button size="small" startIcon={<ReplayIcon />} disabled={busy} onClick={() => setPending('repayment')}>
                  Record repayment
                </Button>
                <Button size="small" color={loan.isOnHold ? 'success' : 'warning'} disabled={busy} onClick={() => setPending('hold')}>
                  {loan.isOnHold ? 'Resume recovery' : 'Hold recovery'}
                </Button>
              </>
            )}
          </Stack>
        }
      />

      {notice && (
        <Alert severity={notice.severity} sx={{ mb: 2 }} onClose={() => setNotice(null)}>
          {notice.message}
        </Alert>
      )}

      {loan.isOnHold && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Recovery is on hold. No instalment will be deducted until it is resumed.
          {loan.holdReason ? ` Reason: ${loan.holdReason}` : ''}
        </Alert>
      )}

      {loan.status === 'REJECTED' && loan.rejectionReason && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Rejected — {loan.rejectionReason}
        </Alert>
      )}

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card variant="outlined" sx={{ height: '100%' }}>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography variant="h6">Terms</Typography>
                <Chip label={humanize(loan.status)} color={STATUS_COLOR[loan.status] ?? 'default'} size="small" />
              </Stack>

              <Divider sx={{ my: 2 }} />

              {line(
                'Employee',
                loan.employeeId ? (
                  <Link component={RouterLink} to={PATHS.employeeDetail(loan.employeeId._id ?? loan.employeeId)} underline="hover">
                    {displayName(loan.employeeId)}
                  </Link>
                ) : (
                  '—'
                ),
              )}
              {line('Principal', formatCurrency(loan.principal))}
              {line('Interest rate', `${loan.interestRate ?? 0}%`)}
              {line('Total payable', formatCurrency(loan.totalPayable))}
              {line('EMI', formatCurrency(loan.emi))}
              {line('Tenure', `${loan.tenureMonths} months`)}
              {line('Recovery starts', `${monthName(loan.recoveryStartMonth)} ${loan.recoveryStartYear}`)}
              {loan.purpose ? line('Purpose', loan.purpose) : null}
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <Card variant="outlined" sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6">Recovery</Typography>
              <Divider sx={{ my: 2 }} />

              <Typography variant="h4">{formatCurrency(loan.outstanding)}</Typography>
              <Typography variant="caption" color="text.secondary">
                still outstanding
              </Typography>

              <LinearProgress
                variant="determinate"
                value={recovered}
                color={recovered >= 100 ? 'success' : 'primary'}
                sx={{ my: 2, height: 8, borderRadius: 4 }}
              />

              {line('Recovered', formatCurrency(loan.recoveredAmount))}
              {line('Progress', `${Math.round(recovered)}%`)}
              {line('Disbursed on', loan.disbursedOn ? formatDate(loan.disbursedOn) : 'Not yet')}
              {line('Closed on', loan.closedOn ? formatDate(loan.closedOn) : '—')}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Typography variant="h6" sx={{ mb: 1 }}>
        Instalment schedule
      </Typography>

      <DataTable
        columns={columns}
        rows={loan.instalments ?? []}
        getKey={(row) => `${row.sequence}`}
        emptyTitle="No schedule yet"
        emptyMessage="Instalments are generated when the loan is approved."
      />

      <ConfirmDialog
        open={Boolean(pending)}
        title={
          {
            approve: 'Approve this loan?',
            reject: 'Reject this loan?',
            disburse: 'Mark as disbursed?',
            hold: loan.isOnHold ? 'Resume recovery?' : 'Hold recovery?',
            repayment: 'Record a repayment',
          }[pending] ?? 'Confirm'
        }
        message={
          {
            approve: 'The instalment schedule is generated and recovery begins from the start month.',
            reject: 'The employee sees your reason. A rejection requires one.',
            disburse: 'Records that the money has left the company.',
            hold: loan.isOnHold
              ? 'Instalments resume from the next payroll run.'
              : 'No instalment will be deducted until recovery is resumed.',
            repayment: 'For money paid back outside payroll — a lump sum or a cash repayment.',
          }[pending] ?? ''
        }
        confirmLabel={pending === 'reject' ? 'Reject' : 'Confirm'}
        confirmColor={pending === 'reject' ? 'error' : 'success'}
        requireReason={['reject', 'hold', 'repayment'].includes(pending)}
        reasonLabel={
          pending === 'repayment' ? 'Amount received' : pending === 'reject' ? 'Reason for rejection' : 'Reason'
        }
        loading={busy}
        onConfirm={act}
        onClose={() => setPending(null)}
      />
    </Box>
  );
};

export default LoanDetailPage;
