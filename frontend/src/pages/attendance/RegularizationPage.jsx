import { useCallback, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import CheckIcon from '@mui/icons-material/CheckOutlined';
import CloseIcon from '@mui/icons-material/CloseOutlined';

import PageHeader from '@components/common/PageHeader.jsx';
import ConfirmDialog from '@components/feedback/ConfirmDialog.jsx';
import { useAppDispatch, useAppSelector } from '@hooks/useRedux.js';
import usePermissions from '@hooks/usePermissions.js';
import { RESOURCES, ACTIONS } from '@utils/permissions.js';
import { employeeIdentifiers } from '@utils/dataGrid.js';
import {
  fetchRegularizations,
  fetchPendingCount,
  selectAttendance,
} from '@redux/slices/attendanceSlice.js';
import attendanceService from '@services/modules/attendance.service.js';
import { formatDate, formatDateTime, humanize } from '@utils/format.js';
import { formatAttendanceTime, toAttendanceClock } from '@utils/attendanceTime.js';
import { PATHS } from '@routes/paths.js';

const STATUS_COLOR = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'error',
  CANCELLED: 'default',
};

const timeOf = formatAttendanceTime;

const RegularizationPage = () => {
  const dispatch = useAppDispatch();
  const { can } = usePermissions();
  const { regularizations, pending } = useAppSelector(selectAttendance);

  const canApprove = can(RESOURCES.ATTENDANCE, ACTIONS.APPROVE);
  // Approvers land on the inbox; everyone else only has their own requests.
  const [tab, setTab] = useState(canApprove ? 0 : 1);
  const [decision, setDecision] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    const params = tab === 0 ? { status: 'PENDING' } : { mine: true };
    dispatch(fetchRegularizations(params));
    if (canApprove) dispatch(fetchPendingCount());
  }, [dispatch, tab, canApprove]);

  useEffect(() => {
    load();
  }, [load]);

  const handleDecision = async (comment) => {
    const target = decision;
    setDecision(null);
    setBusy(true);

    try {
      await attendanceService.decideRegularization(target.id, {
        decision: target.approve ? 'APPROVED' : 'REJECTED',
        comment: comment || undefined,
      });

      setNotice({
        severity: 'success',
        message: `Request ${target.approve ? 'approved' : 'rejected'}`,
      });
      load();
    } catch (rejection) {
      setNotice({ severity: 'error', message: rejection?.message ?? 'The decision could not be saved' });
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async (id) => {
    try {
      await attendanceService.cancelRegularization(id);
      setNotice({ severity: 'success', message: 'Request withdrawn' });
      load();
    } catch (rejection) {
      setNotice({ severity: 'error', message: rejection?.message ?? 'Could not withdraw' });
    }
  };

  return (
    <Box>
      <PageHeader
        title="Regularization"
        subtitle="Corrections to recorded attendance"
        breadcrumbs={[
          { label: 'Home', to: PATHS.dashboard },
          { label: 'Attendance', to: PATHS.attendance },
          { label: 'Regularization' },
        ]}
      />

      {notice && (
        <Alert severity={notice.severity} sx={{ mb: 2 }} onClose={() => setNotice(null)}>
          {notice.message}
        </Alert>
      )}

      <Tabs
        value={tab}
        onChange={(_event, next) => setTab(next)}
        sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
      >
        {canApprove && (
          <Tab
            value={0}
            label={
              <Badge badgeContent={pending} color="warning" sx={{ pr: pending ? 2 : 0 }}>
                Awaiting approval
              </Badge>
            }
          />
        )}
        <Tab value={1} label="My requests" />
      </Tabs>

      <Paper variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Date</TableCell>
              {tab === 0 && <TableCell>Employee</TableCell>}
              <TableCell>Type</TableCell>
              <TableCell>Requested</TableCell>
              <TableCell>Reason</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right" width={140} />
            </TableRow>
          </TableHead>

          <TableBody>
            {regularizations.map((request) => (
              <TableRow key={request._id} hover>
                <TableCell>{formatDate(toAttendanceClock(request.date))}</TableCell>

                {tab === 0 && (
                  <TableCell>
                    <Typography variant="body2">
                      {request.employeeId
                        ? `${request.employeeId.firstName} ${request.employeeId.lastName}`
                        : '—'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {employeeIdentifiers(request.employeeId)}
                    </Typography>
                  </TableCell>
                )}

                <TableCell>
                  <Typography variant="caption">{humanize(request.type)}</Typography>
                </TableCell>

                <TableCell>
                  <Typography variant="caption">
                    {timeOf(request.requestedCheckIn)} → {timeOf(request.requestedCheckOut)}
                  </Typography>
                  {request.requestedStatus && (
                    <Typography variant="caption" display="block" color="text.secondary">
                      as {humanize(request.requestedStatus)}
                    </Typography>
                  )}
                  {/* What the machine originally recorded, so an approver can
                      see what is actually being changed. */}
                  {request.originalSnapshot?.status && (
                    <Typography variant="caption" display="block" color="text.secondary">
                      was {humanize(request.originalSnapshot.status)}
                    </Typography>
                  )}
                </TableCell>

                <TableCell sx={{ maxWidth: 260 }}>
                  <Typography variant="caption">{request.reason}</Typography>
                  {request.decisionComment && (
                    <Typography variant="caption" display="block" color="text.secondary">
                      Note: {request.decisionComment}
                    </Typography>
                  )}
                </TableCell>

                <TableCell>
                  <Chip
                    label={humanize(request.status)}
                    color={STATUS_COLOR[request.status] ?? 'default'}
                    size="small"
                    variant={request.status === 'PENDING' ? 'filled' : 'outlined'}
                  />
                  {request.decidedAt && (
                    <Typography variant="caption" display="block" color="text.secondary">
                      {formatDateTime(request.decidedAt)}
                    </Typography>
                  )}
                </TableCell>

                <TableCell align="right">
                  {tab === 0 && request.status === 'PENDING' && (
                    <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                      <Button
                        size="small"
                        color="success"
                        startIcon={<CheckIcon />}
                        disabled={busy}
                        onClick={() => setDecision({ id: request._id, approve: true })}
                      >
                        Approve
                      </Button>
                      <Button
                        size="small"
                        color="error"
                        startIcon={<CloseIcon />}
                        disabled={busy}
                        onClick={() => setDecision({ id: request._id, approve: false })}
                      >
                        Reject
                      </Button>
                    </Stack>
                  )}

                  {tab === 1 && request.status === 'PENDING' && (
                    <Button size="small" color="inherit" onClick={() => handleCancel(request._id)}>
                      Withdraw
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}

            {regularizations.length === 0 && (
              <TableRow>
                <TableCell colSpan={tab === 0 ? 7 : 6}>
                  <Box sx={{ py: 4, textAlign: 'center' }}>
                    <Typography variant="body2" color="text.secondary">
                      {tab === 0 ? 'Nothing awaiting your approval.' : 'You have no requests.'}
                    </Typography>
                  </Box>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>

      <ConfirmDialog
        open={Boolean(decision)}
        title={decision?.approve ? 'Approve request?' : 'Reject request?'}
        message={
          decision?.approve
            ? 'The attendance day will be recalculated from the corrected times.'
            : 'The employee will see your reason. A rejection requires a comment.'
        }
        confirmLabel={decision?.approve ? 'Approve' : 'Reject'}
        confirmColor={decision?.approve ? 'success' : 'error'}
        requireReason
        reasonLabel={decision?.approve ? 'Comment (optional)' : 'Reason for rejection'}
        loading={busy}
        onConfirm={handleDecision}
        onClose={() => setDecision(null)}
      />
    </Box>
  );
};

export default RegularizationPage;
