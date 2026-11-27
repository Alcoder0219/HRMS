import { Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';
import EditCalendarIcon from '@mui/icons-material/EditCalendarOutlined';
import BeachIcon from '@mui/icons-material/BeachAccessOutlined';
import FactCheckIcon from '@mui/icons-material/FactCheckOutlined';
import WalletIcon from '@mui/icons-material/AccountBalanceWalletOutlined';
import ExitIcon from '@mui/icons-material/ExitToAppOutlined';

import DashboardPanel from '../components/DashboardPanel.jsx';
import useDashboardQuery from '../useDashboardQuery.js';
import attendanceService from '@services/modules/attendance.service.js';
import leaveService from '@services/modules/leave.service.js';
import payrollService from '@services/modules/payroll.service.js';
import { PATHS } from '@routes/paths.js';

/**
 * The queues this user can act on, from the endpoints the approval screens
 * themselves read. A queue the user may not see is never requested; one that
 * could not be read is left out, never shown as zero -- "nothing pending" and
 * "not known" must not look the same.
 */
const PendingActions = ({ sees, payrollAwaiting = null, refreshKey }) => {
  const queues = useDashboardQuery(
    () =>
      Promise.allSettled([
        sees.attendance ? attendanceService.pendingCount().then((r) => r.data?.pending ?? 0) : Promise.reject(),
        sees.leaveApprove ? leaveService.pendingCount().then((r) => r.data?.pending ?? 0) : Promise.reject(),
        sees.payrollQueues
          ? payrollService.listLoans({ status: 'PENDING', limit: 1 }).then((r) => r.meta?.total ?? 0)
          : Promise.reject(),
        sees.payrollQueues
          ? payrollService.settlementDashboard().then((r) => (r.data?.totals?.awaitingHr ?? 0) + (r.data?.totals?.awaitingFinance ?? 0))
          : Promise.reject(),
      ]).then((results) => results.map((result) => (result.status === 'fulfilled' ? result.value : null))),
    [sees.attendance, sees.leaveApprove, sees.payrollQueues, refreshKey],
  );

  const [regularizations, leave, loans, settlements] = queues.data ?? [];
  const items = [
    { label: 'Attendance regularizations', hint: 'Corrections to attendance days', value: regularizations, to: PATHS.attendanceRegularization, icon: EditCalendarIcon },
    { label: 'Leave requests', hint: 'Applications awaiting a decision', value: leave, to: PATHS.leaveApproval, icon: BeachIcon },
    { label: 'Payroll approvals', hint: 'Pay runs submitted for approval', value: sees.payrollApprove ? payrollAwaiting : null, to: PATHS.payrollRuns, icon: FactCheckIcon },
    { label: 'Loan requests', hint: 'Loans and advances to decide', value: loans, to: PATHS.loans, icon: WalletIcon },
    { label: 'Full & final settlements', hint: 'Awaiting HR or finance', value: settlements, to: PATHS.settlements, icon: ExitIcon },
  ].filter((item) => item.value !== null && item.value !== undefined);

  return (
    <DashboardPanel
      title="Action center"
      subtitle="Your approval queues"
      loading={queues.loading}
      error={queues.error}
      onRetry={queues.reload}
      empty={!items.length}
      emptyMessage="You have no approval queues on this account."
      minHeight={120}
    >
      <Grid container spacing={1.5}>
        {items.map((item) => (
          <Grid key={item.label} size={{ xs: 12, sm: 6, lg: 4, xl: 12 / Math.min(items.length, 5) }}>
            <Card variant="outlined" sx={{ height: '100%' }}>
              <CardActionArea component={RouterLink} to={item.to} sx={{ height: '100%', p: 1.5 }}>
                <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
                  <Box
                    sx={(theme) => ({
                      display: 'grid',
                      placeItems: 'center',
                      width: 34,
                      height: 34,
                      borderRadius: 1.25,
                      flexShrink: 0,
                      color: item.value ? theme.palette.warning.main : theme.palette.text.secondary,
                      bgcolor: alpha(item.value ? theme.palette.warning.main : theme.palette.text.secondary, 0.12),
                    })}
                  >
                    <item.icon fontSize="small" />
                  </Box>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                      {item.label}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                      {item.hint}
                    </Typography>
                  </Box>
                  <Chip size="small" label={item.value} color={item.value ? 'warning' : 'default'} variant={item.value ? 'filled' : 'outlined'} />
                </Stack>
              </CardActionArea>
            </Card>
          </Grid>
        ))}
      </Grid>
    </DashboardPanel>
  );
};

export default PendingActions;
