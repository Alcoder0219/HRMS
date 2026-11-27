import { Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';

import DashboardPanel from '../components/DashboardPanel.jsx';
import { CHART_COLORS, DonutChart } from '../components/Charts.jsx';
import StatusChip from '@components/common/StatusChip.jsx';
import { formatDate } from '@utils/format.js';
import { PATHS } from '@routes/paths.js';

/**
 * Leave for the selected month and the queue behind it. Counts of the leave
 * requests themselves; approving still happens on the Leave screens.
 */
const LeaveOverview = ({ query, periodLabel }) => {
  const data = query.data;
  const common = { loading: query.loading, error: query.error, onRetry: query.reload };

  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, md: 5, lg: 4 }}>
        <DashboardPanel
          title="Leave requests"
          subtitle={`${periodLabel} · applications touching the month`}
          {...common}
          empty={!data}
          minHeight={240}
          action={
            <Link component={RouterLink} to={PATHS.leave} variant="caption">
              Leave management
            </Link>
          }
        >
          {data && (
            <Stack spacing={2}>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1.5 }}>
                {[
                  ['Received', data.received],
                  ['On leave today', data.onLeaveToday],
                  ['Awaiting approval', data.pendingTotal],
                ].map(([label, value]) => (
                  <Box key={label} sx={{ minWidth: 0 }}>
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                      {label}
                    </Typography>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                      {value}
                    </Typography>
                  </Box>
                ))}
              </Box>
              {data.received > 0 ? (
                <DonutChart
                  size={140}
                  format={(value) => `${value} request(s)`}
                  centerValue={data.received}
                  centerLabel="Requests"
                  data={[
                    { label: 'Approved', value: data.approved, color: CHART_COLORS.approved },
                    { label: 'Pending', value: data.pending, color: CHART_COLORS.pending },
                    { label: 'Rejected', value: data.rejected, color: CHART_COLORS.rejected },
                    { label: 'Cancelled', value: data.cancelled, color: CHART_COLORS.other },
                  ]}
                />
              ) : (
                <Typography variant="body2" color="text.secondary">
                  No leave applications for {periodLabel}.
                </Typography>
              )}
            </Stack>
          )}
        </DashboardPanel>
      </Grid>

      <Grid size={{ xs: 12, md: 7, lg: 8 }}>
        <DashboardPanel
          title="Pending leave approvals"
          subtitle={data ? `${data.pendingTotal} awaiting a decision · earliest first` : 'Awaiting a decision'}
          {...common}
          empty={!data?.pendingRequests?.length}
          emptyMessage="No leave requests are waiting for approval."
          minHeight={240}
          action={
            <Link component={RouterLink} to={PATHS.leaveApproval} variant="caption">
              Review requests
            </Link>
          }
        >
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Employee</TableCell>
                  <TableCell>Employee ID</TableCell>
                  <TableCell>Leave type</TableCell>
                  <TableCell>From</TableCell>
                  <TableCell>To</TableCell>
                  <TableCell>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(data?.pendingRequests ?? []).map((request) => (
                  <TableRow key={request._id} hover>
                    <TableCell sx={{ maxWidth: 200 }}>
                      <Typography variant="body2" noWrap>
                        {request.employee?.fullName ?? '—'}
                      </Typography>
                    </TableCell>
                    <TableCell>{request.employee?.employeeId ?? request.employee?.employeeCode ?? '—'}</TableCell>
                    <TableCell>{request.leaveType ?? '—'}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDate(request.from)}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDate(request.to)}</TableCell>
                    <TableCell>
                      <StatusChip status={request.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </DashboardPanel>
      </Grid>
    </Grid>
  );
};

export default LeaveOverview;
