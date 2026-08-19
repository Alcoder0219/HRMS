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
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import BackIcon from '@mui/icons-material/ArrowBackOutlined';
import PdfIcon from '@mui/icons-material/PictureAsPdfOutlined';
import LockIcon from '@mui/icons-material/LockOutlined';
import LockOpenIcon from '@mui/icons-material/LockOpenOutlined';

import PageHeader from '@components/common/PageHeader.jsx';
import ConfirmDialog from '@components/feedback/ConfirmDialog.jsx';
import { LoadingState, ErrorState } from '@components/common/StateBlock.jsx';
import usePermissions from '@hooks/usePermissions.js';
import { RESOURCES, ACTIONS } from '@utils/permissions.js';
import payrollService from '@services/modules/payroll.service.js';
import { downloadBlob } from '@utils/exporters.js';
import { formatCurrency, formatDate, humanize } from '@utils/format.js';
import { employeeIdentifiers } from '@utils/dataGrid.js';
import { PATHS } from '@routes/paths.js';

const STATUS_COLOR = { DRAFT: 'default', FINALISED: 'info', PUBLISHED: 'success', ON_HOLD: 'warning' };

/**
 * One payslip, component by component.
 *
 * Every figure is read from the stored payslip rather than recomputed here. The
 * document is a snapshot taken when payroll ran -- re-deriving it in the
 * browser from today's salary structure would quietly show a different number
 * than the one that was actually paid.
 */
const PayslipDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = usePermissions();

  const canHold = can(RESOURCES.PAYROLL, ACTIONS.APPROVE);

  const [payslip, setPayslip] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [holdOpen, setHoldOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);

    payrollService
      .getPayslip(id)
      .then((response) => setPayslip(response.data))
      .catch((rejection) => setError(rejection?.message ?? 'Could not load the payslip'))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleHold = async (reason) => {
    setHoldOpen(false);
    setBusy(true);

    const holding = payslip.status !== 'ON_HOLD';

    try {
      // The validator requires a reason when holding, and allows none when
      // releasing -- withholding someone's salary silently is not defensible.
      await payrollService.holdPayslip(id, holding ? { hold: true, reason } : { hold: false });

      setNotice({ severity: 'success', message: holding ? 'Payslip held' : 'Hold released' });
      load();
    } catch (rejection) {
      setNotice({ severity: 'error', message: rejection?.message ?? 'The action failed' });
    } finally {
      setBusy(false);
    }
  };

  const downloadPdf = async () => {
    try {
      const blob = await payrollService.payslipPdf(id);
      downloadBlob(blob, `payslip-${payslip.employeeSnapshot?.employeeCode ?? 'employee'}-${payslip.period}.pdf`);
    } catch (rejection) {
      setNotice({ severity: 'error', message: rejection?.message ?? 'The payslip could not be downloaded' });
    }
  };

  if (loading) return <LoadingState message="Loading payslip…" minHeight={320} />;

  if (error) {
    return (
      <Box>
        <PageHeader
          title="Payslip"
          breadcrumbs={[{ label: 'Home', to: PATHS.dashboard }, { label: 'Payslips', to: PATHS.payslips }]}
        />
        <ErrorState message={error} onRetry={load} />
      </Box>
    );
  }

  const componentTable = (items, total, totalLabel) => (
    <Table size="small">
      <TableBody>
        {(items ?? []).map((item) => (
          <TableRow key={`${item.code}-${item.label}`}>
            <TableCell>{item.label}</TableCell>
            <TableCell align="right">{formatCurrency(item.amount)}</TableCell>
          </TableRow>
        ))}
        <TableRow>
          <TableCell sx={{ fontWeight: 700 }}>{totalLabel}</TableCell>
          <TableCell align="right" sx={{ fontWeight: 700 }}>
            {formatCurrency(total)}
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );

  const line = (label, value) => (
    <Stack direction="row" justifyContent="space-between" sx={{ py: 0.5 }} spacing={2}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" fontWeight={500} align="right">
        {value}
      </Typography>
    </Stack>
  );

  const snapshot = payslip.employeeSnapshot ?? {};

  return (
    <Box>
      <PageHeader
        title={`Payslip — ${payslip.period}`}
        subtitle={`${snapshot.fullName ?? 'Employee'} · ${employeeIdentifiers(snapshot)}`}
        breadcrumbs={[
          { label: 'Home', to: PATHS.dashboard },
          { label: 'Payroll' },
          { label: 'Payslips', to: PATHS.payslips },
          { label: payslip.period },
        ]}
        actions={
          <Stack direction="row" spacing={1} data-print="hide">
            <Button size="small" startIcon={<BackIcon />} onClick={() => navigate(PATHS.payslips)}>
              Back
            </Button>

            <Button size="small" startIcon={<PdfIcon />} onClick={downloadPdf}>
              Download PDF
            </Button>

            {canHold && (
              <Button
                size="small"
                color={payslip.status === 'ON_HOLD' ? 'success' : 'warning'}
                startIcon={payslip.status === 'ON_HOLD' ? <LockOpenIcon /> : <LockIcon />}
                disabled={busy}
                onClick={() => setHoldOpen(true)}
              >
                {payslip.status === 'ON_HOLD' ? 'Release hold' : 'Hold'}
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

      {payslip.status === 'ON_HOLD' && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          This payslip is on hold and is excluded from the run&apos;s disbursement.
          {payslip.holdReason ? ` Reason: ${payslip.holdReason}` : ''}
        </Alert>
      )}

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, md: 4 }}>
          <Card variant="outlined" sx={{ height: '100%' }}>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography variant="h6">Employee</Typography>
                <Chip label={humanize(payslip.status)} size="small" color={STATUS_COLOR[payslip.status] ?? 'default'} />
              </Stack>

              <Divider sx={{ my: 2 }} />

              {line(
                'Name',
                payslip.employeeId ? (
                  <Link
                    component={RouterLink}
                    to={PATHS.employeeDetail(payslip.employeeId._id ?? payslip.employeeId)}
                    underline="hover"
                  >
                    {snapshot.fullName ?? 'Employee'}
                  </Link>
                ) : (
                  (snapshot.fullName ?? '—')
                ),
              )}
              {line('Employee ID', snapshot.employeeId ?? '—')}
              {line('Code', snapshot.employeeCode ?? '—')}
              {line('Department', snapshot.department ?? '—')}
              {line('Designation', snapshot.designation ?? '—')}
              {/* Only what the payslip actually carries: a slip issued for
                  someone outside NHIF has no membership number to quote. */}
              {snapshot.tinNumber ? line('TIN', snapshot.tinNumber) : null}
              {snapshot.nssfNumber ? line('NSSF no.', snapshot.nssfNumber) : null}
              {snapshot.nhifNumber ? line('NHIF no.', snapshot.nhifNumber) : null}

              <Divider sx={{ my: 2 }} />

              <Typography variant="caption" color="text.secondary">
                Attendance
              </Typography>
              {line('Payable days', payslip.attendance?.payableDays ?? '—')}
              {line('LOP days', payslip.attendance?.lopDays ?? 0)}
              {payslip.attendance?.overtimeHours
                ? line('Overtime', `${payslip.attendance.overtimeHours} h`)
                : null}
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 8 }}>
          <Card variant="outlined" sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6">Components</Typography>
              <Divider sx={{ my: 2 }} />

              <Grid container spacing={2}>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <Typography variant="caption" color="text.secondary">
                    Earnings
                  </Typography>
                  {componentTable(payslip.earnings, payslip.grossEarnings, 'Gross earnings')}
                </Grid>

                <Grid size={{ xs: 12, sm: 6 }}>
                  <Typography variant="caption" color="text.secondary">
                    Deductions
                  </Typography>
                  {componentTable(payslip.deductions, payslip.totalDeductions, 'Total deductions')}
                </Grid>
              </Grid>

              <Divider sx={{ my: 2 }} />

              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Net payable
                  </Typography>
                  <Typography variant="h4" color="success.main">
                    {formatCurrency(payslip.netPayable)}
                  </Typography>
                </Box>

                {payslip.publishedAt && (
                  <Typography variant="caption" color="text.secondary">
                    Published {formatDate(payslip.publishedAt)}
                  </Typography>
                )}
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        {payslip.employerContributions?.length > 0 && (
          <Grid size={{ xs: 12, md: 6 }}>
            <Card variant="outlined">
              <CardContent>
                <Typography variant="h6">Employer contributions</Typography>
                <Typography variant="caption" color="text.secondary">
                  NSSF, SDL and WCF — a cost the company carries on top of the salary, never deducted from it
                </Typography>
                <Divider sx={{ my: 2 }} />
                {componentTable(
                  payslip.employerContributions,
                  payslip.employerContributionTotal,
                  'Total employer cost',
                )}
              </CardContent>
            </Card>
          </Grid>
        )}

        {payslip.ytd && (
          <Grid size={{ xs: 12, md: 6 }}>
            <Card variant="outlined">
              <CardContent>
                <Typography variant="h6">Year to date</Typography>
                <Divider sx={{ my: 2 }} />
                {/* The stored YTD block's own keys -- `gross`, `deductions`,
                    `net` -- not the payslip's monthly ones. */}
                {line('Gross', formatCurrency(payslip.ytd.gross))}
                {line('Deductions', formatCurrency(payslip.ytd.deductions))}
                {line('Net', formatCurrency(payslip.ytd.net))}
                {payslip.ytd.nssf !== undefined ? line('NSSF', formatCurrency(payslip.ytd.nssf)) : null}
                {payslip.ytd.paye !== undefined ? line('PAYE', formatCurrency(payslip.ytd.paye)) : null}
              </CardContent>
            </Card>
          </Grid>
        )}
      </Grid>

      <ConfirmDialog
        open={holdOpen}
        title={payslip.status === 'ON_HOLD' ? 'Release the hold?' : 'Hold this payslip?'}
        message={
          payslip.status === 'ON_HOLD'
            ? 'The payslip rejoins the run and will be paid.'
            : 'The payslip is excluded from this run’s disbursement. A reason is required and is recorded against it.'
        }
        confirmLabel={payslip.status === 'ON_HOLD' ? 'Release' : 'Hold'}
        confirmColor={payslip.status === 'ON_HOLD' ? 'success' : 'warning'}
        requireReason={payslip.status !== 'ON_HOLD'}
        reasonLabel="Reason for holding"
        loading={busy}
        onConfirm={toggleHold}
        onClose={() => setHoldOpen(false)}
      />
    </Box>
  );
};

export default PayslipDetailPage;
