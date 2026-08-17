import { useCallback, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import SavingsIcon from '@mui/icons-material/SavingsOutlined';
import MoreTimeIcon from '@mui/icons-material/MoreTimeOutlined';
import HistoryIcon from '@mui/icons-material/HistoryOutlined';

import PageHeader from '@components/common/PageHeader.jsx';
import DataTable from '@components/common/DataTable.jsx';
import StatCard from '@components/common/StatCard.jsx';
import EmployeePicker from '@components/common/EmployeePicker.jsx';
import useAuth from '@hooks/useAuth.js';
import attendanceService from '@services/modules/attendance.service.js';
import { formatDate, humanize } from '@utils/format.js';
import { getRowId } from '@utils/dataGrid.js';
import { PATHS } from '@routes/paths.js';

const STATUS_COLOR = { EARNED: 'success', CONSUMED: 'default', EXPIRED: 'error' };

/**
 * The compensatory-off ledger behind GET /attendance/comp-off.
 *
 * Credits are individual rows rather than a running total, because each one
 * expires on its own schedule -- a single balance could not answer "how much of
 * this is still usable", which is the only question that matters at the counter.
 */
const CompOffPage = () => {
  const { user } = useAuth();

  // An administrator's login is usually not attached to an employee record, and
  // the API rejects a self-service read from one. Asking who to look at is the
  // honest version of that constraint.
  const linkedToEmployee = Boolean(user?.employeeId);

  const [employee, setEmployee] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    const employeeId = employee ? getRowId(employee) : undefined;
    if (!employeeId && !linkedToEmployee) return;

    setLoading(true);
    setError(null);

    attendanceService
      .compOff(employeeId)
      .then((response) => setData(response.data))
      .catch((rejection) => {
        setData(null);
        setError(rejection?.message ?? 'Could not load the comp-off ledger');
      })
      .finally(() => setLoading(false));
  }, [employee, linkedToEmployee]);

  useEffect(() => {
    load();
  }, [load]);

  const entries = data?.entries ?? [];
  const earned = entries.filter((row) => row.status === 'EARNED');
  const expired = entries.filter((row) => row.status === 'EXPIRED');

  const columns = [
    { key: 'earnedOn', label: 'Earned on', render: (row) => formatDate(row.earnedOn) },
    { key: 'days', label: 'Days', align: 'right', render: (row) => row.days?.toFixed(1) ?? '—' },
    {
      key: 'workedMinutes',
      label: 'Worked',
      align: 'right',
      render: (row) =>
        row.workedMinutes ? `${Math.floor(row.workedMinutes / 60)}h ${row.workedMinutes % 60}m` : '—',
    },
    { key: 'expiresAt', label: 'Expires', render: (row) => formatDate(row.expiresAt) },
    {
      key: 'status',
      label: 'Status',
      render: (row) => (
        <Chip
          label={humanize(row.status)}
          size="small"
          color={STATUS_COLOR[row.status] ?? 'default'}
          variant={row.status === 'EARNED' ? 'filled' : 'outlined'}
        />
      ),
    },
    { key: 'consumedOn', label: 'Consumed', render: (row) => (row.consumedOn ? formatDate(row.consumedOn) : '—') },
    {
      key: 'reason',
      label: 'Note',
      render: (row) => (
        <Typography variant="caption" color="text.secondary">
          {row.reason || '—'}
        </Typography>
      ),
    },
  ];

  return (
    <Box>
      <PageHeader
        title="Comp Off"
        subtitle="Credit earned by working a holiday or a weekly off"
        breadcrumbs={[
          { label: 'Home', to: PATHS.dashboard },
          { label: 'Attendance', to: PATHS.attendance },
          { label: 'Comp Off' },
        ]}
      />

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 2 }} alignItems="center">
        <EmployeePicker
          value={employee}
          onChange={setEmployee}
          label={linkedToEmployee ? 'Employee (blank shows your own)' : 'Employee'}
          sx={{ width: { xs: '100%', sm: 360 } }}
        />
      </Stack>

      {!employee && !linkedToEmployee && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Your login is not linked to an employee record, so there is no personal ledger to show. Pick an
          employee above to see theirs.
        </Alert>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard
            label="Usable balance"
            value={data ? `${(data.balance ?? 0).toFixed(1)} days` : '—'}
            caption="Earned and not yet expired"
            icon={SavingsIcon}
            color="success"
            loading={loading}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard
            label="Open credits"
            value={earned.length}
            caption="Individual entries still available"
            icon={MoreTimeIcon}
            loading={loading}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard
            label="Lapsed"
            value={expired.length}
            caption="Expired before they were taken"
            icon={HistoryIcon}
            color="warning"
            loading={loading}
          />
        </Grid>
      </Grid>

      <DataTable
        columns={columns}
        rows={entries}
        loading={loading}
        emptyMessage="No comp-off has been earned."
      />
    </Box>
  );
};

export default CompOffPage;
