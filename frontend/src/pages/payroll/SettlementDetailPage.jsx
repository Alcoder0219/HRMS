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
import Link from '@mui/material/Link';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import BackIcon from '@mui/icons-material/ArrowBackOutlined';
import PdfIcon from '@mui/icons-material/PictureAsPdfOutlined';
import CheckIcon from '@mui/icons-material/CheckCircleOutlined';

import PageHeader from '@components/common/PageHeader.jsx';
import ConfirmDialog from '@components/feedback/ConfirmDialog.jsx';
import { LoadingState, ErrorState } from '@components/common/StateBlock.jsx';
import usePermissions from '@hooks/usePermissions.js';
import { RESOURCES, ACTIONS } from '@utils/permissions.js';
import payrollService from '@services/modules/payroll.service.js';
import { downloadBlob } from '@utils/exporters.js';
import { formatCurrency, formatDate, formatDateTime, humanize } from '@utils/format.js';
import { displayName } from '@utils/dataGrid.js';
import { PATHS } from '@routes/paths.js';

const STATUS_COLOR = {
  DRAFT: 'default',
  PENDING_HR: 'warning',
  PENDING_FINANCE: 'warning',
  APPROVED: 'info',
  PAID: 'success',
  ON_HOLD: 'error',
  CANCELLED: 'default',
};

/**
 * One settlement sheet, and the two-stage approval that moves it.
 *
 * Only the transitions the current status permits are offered. The server holds
 * the same table and additionally refuses to let one person clear both the HR
 * and the finance stage -- offering a button that is guaranteed to fail teaches
 * people to distrust the screen.
 */
const ACTIONS_BY_STATUS = {
  DRAFT: [{ key: 'submit', label: 'Submit to HR', color: 'primary' }],
  PENDING_HR: [
    { key: 'hr-approve', label: 'HR approve', color: 'success' },
    { key: 'hr-return', label: 'Return', color: 'warning' },
  ],
  PENDING_FINANCE: [
    { key: 'finance-approve', label: 'Finance approve', color: 'success' },
    { key: 'finance-return', label: 'Return', color: 'warning' },
  ],
  APPROVED: [{ key: 'paid', label: 'Mark paid', color: 'success' }],
  ON_HOLD: [{ key: 'release', label: 'Release hold', color: 'primary' }],
};

const SettlementDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = usePermissions();

  const canApprove = can(RESOURCES.PAYROLL, ACTIONS.APPROVE);
  const canUpdate = can(RESOURCES.PAYROLL, ACTIONS.UPDATE);

  const [settlement, setSettlement] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);

    payrollService
      .getSettlement(id)
      .then((response) => setSettlement(response.data))
      .catch((rejection) => setError(rejection?.message ?? 'Could not load the settlement'))
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
      if (action === 'submit') await payrollService.submitSettlement(id);
      if (action === 'hr-approve') await payrollService.hrDecision(id, { decision: 'APPROVED' });
      if (action === 'hr-return') await payrollService.hrDecision(id, { decision: 'RETURNED', comment: input });
      if (action === 'finance-approve') await payrollService.financeDecision(id, { decision: 'APPROVED' });
      if (action === 'finance-return')
        await payrollService.financeDecision(id, { decision: 'RETURNED', comment: input });
      if (action === 'paid')
        await payrollService.markSettlementPaid(id, { paymentReference: input || undefined });
      if (action === 'hold') await payrollService.holdSettlement(id, { reason: input });
      // A hold returns to the HR queue: it is the earliest stage a release is
      // allowed back to, so the sheet is re-checked rather than resuming
      // mid-approval.
      if (action === 'release') await payrollService.releaseSettlement(id, { toStatus: 'PENDING_HR' });
      if (action === 'cancel') await payrollService.cancelSettlement(id, { reason: input });
      if (action === 'recalculate') await payrollService.recalculateSettlement(id, {});

      setNotice({ severity: 'success', message: 'Settlement updated' });
      load();
    } catch (rejection) {
      setNotice({ severity: 'error', message: rejection?.message ?? 'The action failed' });
    } finally {
      setBusy(false);
    }
  };

  const downloadPdf = async () => {
    try {
      const blob = await payrollService.settlementPdf(id);
      downloadBlob(blob, `settlement-${settlement.settlementNumber}.pdf`);
    } catch (rejection) {
      setNotice({ severity: 'error', message: rejection?.message ?? 'The sheet could not be downloaded' });
    }
  };

  if (loading) return <LoadingState message="Loading settlement…" minHeight={320} />;

  if (error) {
    return (
      <Box>
        <PageHeader
          title="Settlement"
          breadcrumbs={[{ label: 'Home', to: PATHS.dashboard }, { label: 'Settlements', to: PATHS.settlements }]}
        />
        <ErrorState message={error} onRetry={load} />
      </Box>
    );
  }

  const available = canApprove ? (ACTIONS_BY_STATUS[settlement.status] ?? []) : [];
  const openState = !['PAID', 'CANCELLED'].includes(settlement.status);

  const componentRows = (items, sign) =>
    (items ?? []).map((item) => (
      <TableRow key={`${sign}-${item.code}-${item.label}`}>
        <TableCell>{item.label}</TableCell>
        <TableCell align="right">{formatCurrency(item.amount)}</TableCell>
      </TableRow>
    ));

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

  return (
    <Box>
      <PageHeader
        title={settlement.settlementNumber}
        subtitle={`${humanize(settlement.trigger)} · ${displayName(settlement.employeeId) || settlement.employeeSnapshot?.fullName || 'Employee'}`}
        breadcrumbs={[
          { label: 'Home', to: PATHS.dashboard },
          { label: 'Payroll' },
          { label: 'Settlements', to: PATHS.settlements },
          { label: settlement.settlementNumber },
        ]}
        actions={
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap data-print="hide">
            <Button size="small" startIcon={<BackIcon />} onClick={() => navigate(PATHS.settlements)}>
              Back
            </Button>

            <Button size="small" startIcon={<PdfIcon />} onClick={downloadPdf}>
              Sheet PDF
            </Button>

            {canUpdate && ['DRAFT', 'PENDING_HR', 'ON_HOLD'].includes(settlement.status) && (
              <Button size="small" disabled={busy} onClick={() => setPending('recalculate')}>
                Recalculate
              </Button>
            )}

            {available.map((action) => (
              <Button
                key={action.key}
                size="small"
                variant={action.color === 'success' ? 'contained' : 'outlined'}
                color={action.color}
                disabled={busy}
                startIcon={action.color === 'success' ? <CheckIcon /> : null}
                onClick={() => setPending(action.key)}
              >
                {action.label}
              </Button>
            ))}

            {canApprove && openState && settlement.status !== 'ON_HOLD' && (
              <Button size="small" color="warning" disabled={busy} onClick={() => setPending('hold')}>
                Hold
              </Button>
            )}

            {canApprove && openState && (
              <Button size="small" color="error" disabled={busy} onClick={() => setPending('cancel')}>
                Cancel
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

      {settlement.status === 'ON_HOLD' && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          On hold{settlement.holdReason ? ` — ${settlement.holdReason}` : ''}
        </Alert>
      )}

      {settlement.pendingAssetCount > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {settlement.pendingAssetCount} company asset(s) have not been returned. Their recovery value is
          already deducted below.
        </Alert>
      )}

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, md: 4 }}>
          <Card variant="outlined" sx={{ height: '100%' }}>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography variant="h6">Exit</Typography>
                <Chip
                  label={humanize(settlement.status)}
                  color={STATUS_COLOR[settlement.status] ?? 'default'}
                  size="small"
                />
              </Stack>

              <Divider sx={{ my: 2 }} />

              {line(
                'Employee',
                settlement.employeeId ? (
                  <Link
                    component={RouterLink}
                    to={PATHS.employeeDetail(settlement.employeeId._id ?? settlement.employeeId)}
                    underline="hover"
                  >
                    {displayName(settlement.employeeId)}
                  </Link>
                ) : (
                  (settlement.employeeSnapshot?.fullName ?? '—')
                ),
              )}
              {line('Trigger', humanize(settlement.trigger))}
              {line('Joined', formatDate(settlement.joiningDate))}
              {line('Last working day', formatDate(settlement.lastWorkingDate))}
              {line('Service', settlement.service ? `${settlement.service.years ?? 0}y ${settlement.service.months ?? 0}m` : '—')}
              {line('Rehire eligible', settlement.rehireEligible ? 'Yes' : 'No')}
              {settlement.exitReason ? line('Reason', settlement.exitReason) : null}
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 8 }}>
          <Card variant="outlined" sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6">Settlement sheet</Typography>
              <Divider sx={{ my: 2 }} />

              <Grid container spacing={2}>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <Typography variant="caption" color="text.secondary">
                    Earnings
                  </Typography>
                  <Table size="small">
                    <TableBody>
                      {componentRows(settlement.earnings, 'e')}
                      <TableRow>
                        <TableCell sx={{ fontWeight: 700 }}>Total earnings</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700 }}>
                          {formatCurrency(settlement.totalEarnings)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </Grid>

                <Grid size={{ xs: 12, sm: 6 }}>
                  <Typography variant="caption" color="text.secondary">
                    Deductions
                  </Typography>
                  <Table size="small">
                    <TableBody>
                      {componentRows(settlement.deductions, 'd')}
                      <TableRow>
                        <TableCell sx={{ fontWeight: 700 }}>Total deductions</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700 }}>
                          {formatCurrency(settlement.totalDeductions)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </Grid>
              </Grid>

              <Divider sx={{ my: 2 }} />

              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    {settlement.payableTo === 'COMPANY' ? 'Recoverable from employee' : 'Net payable to employee'}
                  </Typography>
                  <Typography variant="h4" color={settlement.payableTo === 'COMPANY' ? 'error.main' : 'success.main'}>
                    {formatCurrency(Math.abs(settlement.netSettlement))}
                  </Typography>
                </Box>

                {settlement.paidAt && (
                  <Box sx={{ textAlign: 'right' }}>
                    <Typography variant="caption" color="text.secondary" display="block">
                      Paid {formatDateTime(settlement.paidAt)}
                    </Typography>
                    {settlement.paymentReference && (
                      <Typography variant="caption">ref {settlement.paymentReference}</Typography>
                    )}
                  </Box>
                )}
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Typography variant="h6" sx={{ mb: 1 }}>
        Approval trail
      </Typography>

      <Paper variant="outlined" sx={{ p: settlement.approvals?.length ? 0 : 2 }}>
        {settlement.approvals?.length ? (
          <List dense>
            {settlement.approvals.map((approval, index) => (
              <ListItem key={`${approval.stage}-${approval.at}-${index}`} divider>
                <ListItemText
                  primary={
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Chip label={approval.stage} size="small" variant="outlined" />
                      <Chip
                        label={humanize(approval.decision)}
                        size="small"
                        color={approval.decision === 'APPROVED' ? 'success' : 'warning'}
                      />
                      <Typography variant="caption" color="text.secondary">
                        {approval.byEmail ?? ''}
                      </Typography>
                    </Stack>
                  }
                  secondary={`${formatDateTime(approval.at)}${approval.comment ? ` — ${approval.comment}` : ''}`}
                  secondaryTypographyProps={{ variant: 'caption' }}
                />
              </ListItem>
            ))}
          </List>
        ) : (
          <Typography variant="body2" color="text.secondary">
            Not submitted for approval yet.
          </Typography>
        )}
      </Paper>

      <ConfirmDialog
        open={Boolean(pending)}
        title={
          {
            submit: 'Submit to HR?',
            'hr-approve': 'Approve as HR?',
            'hr-return': 'Return for correction?',
            'finance-approve': 'Approve as finance?',
            'finance-return': 'Return for correction?',
            paid: 'Mark as paid?',
            hold: 'Put this settlement on hold?',
            release: 'Release the hold?',
            cancel: 'Cancel this settlement?',
            recalculate: 'Recalculate the sheet?',
          }[pending] ?? 'Confirm'
        }
        message={
          {
            submit: 'The sheet moves to the HR queue and can no longer be edited freely.',
            'hr-approve': 'HR confirms the facts of the exit. It then goes to finance for the money.',
            'hr-return': 'Sent back for correction. Say what needs changing.',
            'finance-approve': 'Finance confirms the amounts. The settlement becomes payable.',
            'finance-return': 'Sent back for correction. Say what needs changing.',
            paid: 'Record the payment reference so this can be reconciled later.',
            hold: 'Nothing moves until the hold is released. A reason is required.',
            release: 'The settlement returns to the HR queue so the sheet is re-checked.',
            cancel: 'The settlement is closed without payment. A reason is required.',
            recalculate: 'Severance, notice and encashment are recomputed from the current inputs.',
          }[pending] ?? ''
        }
        confirmLabel={['cancel', 'hold'].includes(pending) ? 'Confirm' : 'Continue'}
        confirmColor={['cancel', 'hr-return', 'finance-return', 'hold'].includes(pending) ? 'error' : 'success'}
        requireReason={['hr-return', 'finance-return', 'hold', 'cancel', 'paid'].includes(pending)}
        reasonLabel={
          pending === 'paid' ? 'Payment reference' : pending === 'cancel' ? 'Reason for cancelling' : 'Comment'
        }
        loading={busy}
        onConfirm={act}
        onClose={() => setPending(null)}
      />
    </Box>
  );
};

export default SettlementDetailPage;
