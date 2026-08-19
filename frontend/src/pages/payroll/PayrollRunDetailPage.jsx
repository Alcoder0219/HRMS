import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import DownloadIcon from '@mui/icons-material/FileDownloadOutlined';
import AccountBalanceIcon from '@mui/icons-material/AccountBalanceWalletOutlined';
import PeopleIcon from '@mui/icons-material/PeopleAltOutlined';
import PaidIcon from '@mui/icons-material/PaidOutlined';
import SavingsIcon from '@mui/icons-material/SavingsOutlined';
import BusinessIcon from '@mui/icons-material/BusinessOutlined';
import TrendingUpIcon from '@mui/icons-material/TrendingUpOutlined';

import PageHeader from '@components/common/PageHeader.jsx';
import DataTable from '@components/common/DataTable.jsx';
import StatCard from '@components/common/StatCard.jsx';
import ConfirmDialog from '@components/feedback/ConfirmDialog.jsx';
import usePermissions from '@hooks/usePermissions.js';
import { RESOURCES, ACTIONS } from '@utils/permissions.js';
import payrollService from '@services/modules/payroll.service.js';
import { downloadBlob } from '@services/modules/employee.service.js';
import { formatCurrency, formatDateTime, humanize } from '@utils/format.js';
import { RUN_STATUS_COLOR } from './PayrollRunsPage.jsx';
import { PATHS } from '@routes/paths.js';

/**
 * One payroll run: its totals, its salary register, and the workflow buttons
 * that move it from draft to paid.
 *
 * Only the transitions the run's current status actually permits are offered.
 * The server enforces the same table; showing a button that is guaranteed to
 * fail teaches people to distrust the screen.
 */
const NEXT_ACTIONS = {
  DRAFT: [],
  PROCESSING: [{ key: 'submit', label: 'Submit for approval', color: 'primary' }],
  PENDING_APPROVAL: [{ key: 'approve', label: 'Approve', color: 'success' }],
  APPROVED: [{ key: 'paid', label: 'Mark paid', color: 'success' }],
  PAID: [],
  CANCELLED: [],
};

/**
 * A run can be abandoned right up to approval, and not after -- once approved
 * the next step is payment. Mirrors PAYROLL_STATUS_TRANSITIONS on the server,
 * which refuses anything else.
 */
const CANCELLABLE = ['DRAFT', 'PROCESSING', 'PENDING_APPROVAL'];

const PayrollRunDetailPage = () => {
  const { id } = useParams();
  const { can } = usePermissions();

  const canApprove = can(RESOURCES.PAYROLL, ACTIONS.APPROVE);
  const canExport = can(RESOURCES.PAYROLL, ACTIONS.EXPORT);

  const [run, setRun] = useState(null);
  const [register, setRegister] = useState([]);
  // Column totals for the summary cards, computed by the report service from
  // the same rows the table renders.
  const [totals, setTotals] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [pending, setPending] = useState(null);

  const load = useCallback(() => {
    setLoading(true);

    Promise.all([payrollService.getRun(id), payrollService.salaryRegister(id).catch(() => ({ data: null }))])
      .then(([runResponse, registerResponse]) => {
        setRun(runResponse.data);
        setRegister(registerResponse.data?.rows ?? []);
        setTotals(registerResponse.data?.totals ?? {});
      })
      .catch((rejection) =>
        setNotice({ severity: 'error', message: rejection?.message ?? 'Could not load the run' }),
      )
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const runAction = async (reference) => {
    const action = pending;
    setPending(null);
    setBusy(true);

    try {
      if (action === 'submit') await payrollService.submitRun(id);
      if (action === 'approve') await payrollService.approveRun(id);
      if (action === 'paid') await payrollService.markRunPaid(id, { paymentReference: reference || undefined });
      // The server requires a reason; ConfirmDialog collects it.
      if (action === 'cancel') await payrollService.cancelRun(id, { reason: reference });

      setNotice({ severity: 'success', message: 'Run updated' });
      load();
    } catch (rejection) {
      setNotice({ severity: 'error', message: rejection?.message ?? 'The action failed' });
    } finally {
      setBusy(false);
    }
  };

  const download = async (kind) => {
    setBusy(true);

    try {
      if (kind === 'register') {
        const blob = await payrollService.exportRegister(id);
        downloadBlob(blob, `salary-register-${run?.period ?? id}.xlsx`);
      } else {
        // Format is omitted on purpose: the server falls back to the bank
        // format configured in payroll settings, which is the one the
        // organisation's bank actually accepts.
        const blob = await payrollService.bankFile(id);
        downloadBlob(blob, `bank-transfer-${run?.period ?? id}.csv`);
      }
    } catch (rejection) {
      setNotice({ severity: 'error', message: rejection?.message ?? 'The download failed' });
    } finally {
      setBusy(false);
    }
  };

  /**
   * The full salary breakup, in the order payroll is verified: days, then what
   * was earned, then what each side contributed, then what is actually paid.
   *
   * Register rows are the flattened projection the report service builds --
   * component totals lifted out of the payslip, not the payslip document. Every
   * figure here is displayed as received; nothing is summed or derived in the
   * browser, so the screen cannot disagree with the payslip it came from.
   *
   * A missing figure on an older run reads as zero rather than a dash: this is
   * a money column, and a blank in one is ambiguous between "nothing" and
   * "unknown".
   */
  const money = (key) => (row) => formatCurrency(row[key] ?? 0);

  const columns = [
    // The two identifying columns stay put while the rest scrolls sideways.
    { key: 'employeeCode', label: 'Employee Code', sticky: 0, width: 130 },
    {
      key: 'fullName',
      label: 'Employee Name',
      sticky: 130,
      stickyEdge: true,
      width: 190,
      render: (row) => (
        <Box>
          <Typography variant="body2" noWrap>{row.fullName ?? '—'}</Typography>
          <Typography variant="caption" color="text.secondary" noWrap>
            {row.department ?? '—'}
          </Typography>
        </Box>
      ),
    },

    // Not sticky: the two frozen columns carry fixed offsets, and widening that
    // pair would push the whole scrolling region out of alignment.
    { key: 'employeeId', label: 'Employee ID', width: 120, render: (row) => row.employeeId ?? '—' },

    { key: 'payableDays', label: 'Payable Days', align: 'right' },
    {
      key: 'lopDays',
      label: 'LOP',
      align: 'right',
      render: (row) => (row.lopDays ? <Chip label={row.lopDays} size="small" color="warning" variant="outlined" /> : '—'),
    },

    { key: 'basic', label: 'Basic Salary', align: 'right', render: money('basic') },
    { key: 'hraAllowance', label: 'HRA', align: 'right', render: money('hraAllowance') },
    { key: 'foodAllowance', label: 'Food', align: 'right', render: money('foodAllowance') },
    { key: 'transportationAllowance', label: 'Transportation', align: 'right', render: money('transportationAllowance') },
    { key: 'communicationAllowance', label: 'Communication', align: 'right', render: money('communicationAllowance') },
    { key: 'mediclaim', label: 'Mediclaim', align: 'right', render: money('mediclaim') },
    { key: 'schoolFeesAllowance', label: 'School Fees', align: 'right', render: money('schoolFeesAllowance') },
    { key: 'annualLeaveAllowance', label: 'Annual Leave', align: 'right', render: money('annualLeaveAllowance') },
    { key: 'performanceIncentive', label: 'Performance Incentive', align: 'right', render: money('performanceIncentive') },
    { key: 'otherAllowance', label: 'Other Allowance', align: 'right', render: money('otherAllowance') },
    {
      key: 'grossSalary',
      label: 'Gross Salary',
      align: 'right',
      render: (row) => <strong>{formatCurrency(row.grossSalary ?? 0)}</strong>,
    },

    { key: 'nssfEmployee', label: 'NSSF - Employee', align: 'right', render: money('nssfEmployee') },
    { key: 'nssfEmployer', label: 'NSSF - Employer', align: 'right', render: money('nssfEmployer') },
    { key: 'nhif', label: 'NHIF', align: 'right', render: money('nhif') },
    { key: 'paye', label: 'PAYE', align: 'right', render: money('paye') },
    // SDL and WCF are levied on the employer only, so neither has an employee
    // column beside it to compare against.
    { key: 'sdl', label: 'SDL (Employer)', align: 'right', render: money('sdl') },
    { key: 'wcf', label: 'WCF (Employer)', align: 'right', render: money('wcf') },
    { key: 'otherDeductions', label: 'Other Deductions', align: 'right', render: money('otherDeductions') },
    {
      key: 'totalDeductions',
      label: 'Total Deductions',
      align: 'right',
      render: (row) => <strong>{formatCurrency(row.totalDeductions ?? 0)}</strong>,
    },
    // No aggregate Employer Contribution column: the employer's NSSF, SDL and WCF
    // already have columns of their own, and Total Deductions includes them.

    { key: 'netSalary', label: 'Net Salary', align: 'right', render: money('netSalary') },
    { key: 'overtime', label: 'Overtime', align: 'right', render: money('overtime') },
    { key: 'bonus', label: 'Bonus', align: 'right', render: money('bonus') },
    {
      key: 'finalPayable',
      label: 'Final Payable',
      align: 'right',
      render: (row) => (
        <Typography variant="body2" fontWeight={700} color="success.main">
          {formatCurrency(row.finalPayable ?? 0)}
        </Typography>
      ),
    },

    {
      key: 'status',
      label: 'Status',
      render: (row) => (row.status ? <Chip label={humanize(row.status)} size="small" variant="outlined" /> : '—'),
    },
  ];

  const actions = canApprove ? (NEXT_ACTIONS[run?.status] ?? []) : [];

  return (
    <Box>
      <PageHeader
        title={run ? `Payroll — ${run.period}` : 'Payroll run'}
        subtitle={run ? `${run.employeeCount} employee(s) · ${humanize(run.payableDaysBasis)} basis` : 'Loading…'}
        breadcrumbs={[
          { label: 'Home', to: PATHS.dashboard },
          { label: 'Payroll' },
          { label: 'Runs', to: PATHS.payrollRuns },
          { label: run?.period ?? '' },
        ]}
        actions={
          <Stack direction="row" spacing={1}>
            {canExport && (
              <>
                <Button size="small" startIcon={<DownloadIcon />} onClick={() => download('register')} disabled={busy}>
                  Register
                </Button>
                <Button size="small" startIcon={<AccountBalanceIcon />} onClick={() => download('bank')} disabled={busy}>
                  Bank file
                </Button>
              </>
            )}

            {actions.map((action) => (
              <Button
                key={action.key}
                size="small"
                variant="contained"
                color={action.color}
                disabled={busy}
                onClick={() => setPending(action.key)}
              >
                {action.label}
              </Button>
            ))}

            {canApprove && CANCELLABLE.includes(run?.status) && (
              <Button size="small" color="error" disabled={busy} onClick={() => setPending('cancel')}>
                Cancel run
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

      {run && (
        <>
          <Stack direction="row" spacing={1} sx={{ mb: 2 }} alignItems="center">
            <Chip label={humanize(run.status)} color={RUN_STATUS_COLOR[run.status] ?? 'default'} />
            {run.paidAt && (
              <Typography variant="caption" color="text.secondary">
                Paid {formatDateTime(run.paidAt)}
                {run.paymentReference ? ` · ref ${run.paymentReference}` : ''}
              </Typography>
            )}
          </Stack>

          {/*
            Totals come from the register the table is showing, so a card and
            the column beneath it can never disagree. The run document's own
            totals are the fallback for a run whose register did not load.
          */}
          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid size={{ xs: 12, sm: 6, md: 4, lg: 2 }}>
              <StatCard
                label="Employees"
                value={totals.employeeCount ?? run.employeeCount}
                icon={PeopleIcon}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 4, lg: 2 }}>
              <StatCard
                label="Total gross"
                value={formatCurrency(totals.totalGross ?? run.totalGross)}
                icon={PaidIcon}
                color="info"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 4, lg: 2 }}>
              <StatCard
                label="Employee deductions"
                value={formatCurrency(totals.totalDeductions ?? run.totalDeductions)}
                caption={`NSSF ${formatCurrency(run.totalNssfEmployee)} · PAYE ${formatCurrency(run.totalPaye)}`}
                icon={SavingsIcon}
                color="warning"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 4, lg: 2 }}>
              <StatCard
                label="Employer contribution"
                value={formatCurrency(totals.totalEmployerContribution ?? run.totalEmployerContribution)}
                caption="NSSF, SDL and WCF — never deducted"
                icon={BusinessIcon}
                color="secondary"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 4, lg: 2 }}>
              <StatCard
                label="Overtime & bonus"
                value={formatCurrency((totals.totalOvertime ?? 0) + (totals.totalBonus ?? 0))}
                caption={`OT ${formatCurrency(totals.totalOvertime ?? 0)} · Bonus ${formatCurrency(totals.totalBonus ?? 0)}`}
                icon={TrendingUpIcon}
                color="info"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 4, lg: 2 }}>
              <StatCard
                label="Grand net payable"
                value={formatCurrency(totals.grandNetPayable ?? run.totalNet)}
                caption="Paid to employees"
                icon={AccountBalanceIcon}
                color="success"
              />
            </Grid>
          </Grid>
        </>
      )}

      <Typography variant="h6" sx={{ mb: 1 }}>
        Salary register
      </Typography>

      <DataTable
        columns={columns}
        rows={register}
        loading={loading}
        getKey={(row) => row.employeeCode}
        emptyMessage="No payslips in this run."
      />

      <ConfirmDialog
        open={Boolean(pending)}
        title={
          {
            submit: 'Submit for approval?',
            approve: 'Approve this run?',
            paid: 'Mark as paid?',
            cancel: 'Cancel this payroll run?',
          }[pending] ?? 'Confirm'
        }
        message={
          {
            submit: 'The run moves to the approver’s queue and can no longer be re-processed.',
            approve:
              'Approving locks the figures. Any correction after this needs the run to be cancelled and re-processed.',
            paid: 'Record the payment reference from the bank, so the run can be reconciled later.',
            cancel:
              'The run and its payslips are abandoned. Cancelling a priced register is the question an auditor always asks, so a reason is required.',
          }[pending] ?? ''
        }
        confirmLabel={pending === 'paid' ? 'Mark paid' : pending === 'cancel' ? 'Cancel run' : 'Confirm'}
        confirmColor={pending === 'submit' ? 'primary' : pending === 'cancel' ? 'error' : 'success'}
        requireReason={pending === 'paid' || pending === 'cancel'}
        reasonLabel={pending === 'cancel' ? 'Reason for cancelling' : 'Payment reference'}
        loading={busy}
        onConfirm={runAction}
        onClose={() => setPending(null)}
      />
    </Box>
  );
};

export default PayrollRunDetailPage;
