import { useCallback, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import EditNoteIcon from '@mui/icons-material/EditNoteOutlined';
import LoginIcon from '@mui/icons-material/LoginOutlined';
import WarningIcon from '@mui/icons-material/WarningAmberOutlined';
import PeopleIcon from '@mui/icons-material/PeopleAltOutlined';

import PageHeader from '@components/common/PageHeader.jsx';
import DataTable from '@components/common/DataTable.jsx';
import StatCard from '@components/common/StatCard.jsx';
import ExportMenu from '@components/common/ExportMenu.jsx';
import ReportChart from '@components/charts/ReportChart.jsx';
import useTableState from '@hooks/useTableState.js';
import adminService from '@services/modules/admin.service.js';
import { formatDateTime, humanize } from '@utils/format.js';
import { PATHS } from '@routes/paths.js';

/**
 * One timeline of everything that happened: data changes and sign-ins together.
 *
 * The audit log answers "what changed to this record"; this answers "what has
 * been going on". They read from the same two collections but with opposite
 * emphasis, which is why the filters here are about people and periods rather
 * than about entities.
 */
const ActivityLogsPage = () => {
  const table = useTableState({ initialFilters: { kind: '', actorId: '', from: '', to: '' } });

  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);

    adminService
      .activity({ page: table.page, limit: table.limit, search: table.search, ...table.filters })
      .then((response) => {
        setRows(response.data ?? []);
        table.setTotal(response.meta?.total ?? 0);
      })
      .catch((rejection) => setError(rejection?.message ?? 'Could not load activity'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table.page, table.limit, table.search, table.filters]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    adminService
      .activityStats({ days })
      .then((response) => setStats(response.data))
      .catch(() => setStats(null));
  }, [days]);

  const setFilter = (field) => (event) => table.setFilters({ ...table.filters, [field]: event.target.value });

  const columns = [
    { key: 'occurredAt', label: 'When', render: (row) => formatDateTime(row.occurredAt) },
    {
      key: 'kind',
      label: 'Kind',
      render: (row) => (
        <Chip
          label={row.kind === 'CHANGE' ? 'Change' : 'Access'}
          size="small"
          color={row.kind === 'CHANGE' ? 'info' : row.ok ? 'success' : 'error'}
          variant={row.ok ? 'filled' : 'outlined'}
        />
      ),
    },
    { key: 'actor', label: 'Who' },
    { key: 'summary', label: 'What' },
    { key: 'detail', label: 'Detail', render: (row) => row.detail ?? '—' },
    { key: 'ip', label: 'Address', render: (row) => row.ip ?? '—' },
  ];

  const entityChart = stats && {
    key: 'byEntity',
    title: 'Most-changed record types',
    type: 'bar',
    valueFormat: 'number',
    series: (stats.byEntity ?? []).map((entry) => ({ label: entry.entity, value: entry.count })),
  };

  const actorChart = stats && {
    key: 'topActors',
    title: 'Busiest accounts',
    type: 'bar',
    valueFormat: 'number',
    series: (stats.topActors ?? []).map((entry) => ({ label: entry.actor, value: entry.count })),
  };

  const actionChart = stats && {
    key: 'byAction',
    title: 'Changes by action',
    type: 'donut',
    valueFormat: 'number',
    series: Object.entries(stats.byAction ?? {}).map(([label, value]) => ({ label, value })),
  };

  const accessChart = stats && {
    key: 'access',
    title: 'Sign-ins against failures',
    type: 'donut',
    valueFormat: 'number',
    series: [
      { label: 'Successful', value: stats.logins ?? 0 },
      { label: 'Failed', value: stats.failures ?? 0 },
    ].filter((entry) => entry.value > 0),
  };

  return (
    <Box>
      <PageHeader
        title="Activity Logs"
        subtitle="Changes and sign-ins on one timeline"
        breadcrumbs={[{ label: 'Home', to: PATHS.dashboard }, { label: 'Administration' }, { label: 'Activity' }]}
        actions={
          <ExportMenu columns={columns} rows={rows} filename="activity" totalCount={table.total} onError={setError} />
        }
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Stack direction="row" spacing={1} sx={{ mb: 2 }} alignItems="center" data-print="hide">
        <TextField
          select
          size="small"
          label="Summary period"
          value={days}
          onChange={(event) => setDays(Number(event.target.value))}
          sx={{ width: 170 }}
        >
          <MenuItem value={7}>Last 7 days</MenuItem>
          <MenuItem value={30}>Last 30 days</MenuItem>
          <MenuItem value={90}>Last 90 days</MenuItem>
        </TextField>
      </Stack>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 6, sm: 3 }}>
          <StatCard label="Changes" value={stats?.changes ?? 0} icon={EditNoteIcon} loading={!stats} />
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <StatCard label="Sign-ins" value={stats?.logins ?? 0} icon={LoginIcon} color="success" loading={!stats} />
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <StatCard
            label="Failed sign-ins"
            value={stats?.failures ?? 0}
            icon={WarningIcon}
            color={stats?.failures ? 'error' : 'primary'}
            loading={!stats}
          />
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <StatCard
            label="Accounts used"
            value={stats?.activeUsers ?? 0}
            caption={stats ? `${stats.dormantUsers} never signed in` : null}
            icon={PeopleIcon}
            loading={!stats}
          />
        </Grid>
      </Grid>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        {[actionChart, accessChart, entityChart, actorChart].map((chart, index) => (
          <Grid key={chart?.key ?? index} size={{ xs: 12, md: 6, lg: 3 }}>
            <ReportChart chart={chart} loading={!stats} />
          </Grid>
        ))}
      </Grid>

      <Typography variant="h6" sx={{ mb: 1 }}>
        Timeline
      </Typography>

      <Stack direction="row" spacing={1} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap data-print="hide">
        <TextField
          size="small"
          label="Search"
          placeholder="Person or record"
          value={table.search}
          onChange={(event) => table.setSearch(event.target.value)}
          sx={{ width: 220 }}
        />

        <TextField select size="small" label="Kind" value={table.filters.kind} onChange={setFilter('kind')} sx={{ width: 170 }}>
          <MenuItem value="">Everything</MenuItem>
          <MenuItem value="CHANGE">Data changes</MenuItem>
          <MenuItem value="ACCESS">Sign-in activity</MenuItem>
        </TextField>

        <TextField
          size="small"
          type="date"
          label="From"
          value={table.filters.from}
          onChange={setFilter('from')}
          slotProps={{ inputLabel: { shrink: true } }}
        />

        <TextField
          size="small"
          type="date"
          label="To"
          value={table.filters.to}
          onChange={setFilter('to')}
          slotProps={{ inputLabel: { shrink: true } }}
        />
      </Stack>

      <DataTable
        columns={columns}
        rows={rows}
        loading={loading}
        error={error}
        onRetry={load}
        getKey={(row) => `${row.kind}-${row._id}`}
        emptyTitle="Nothing happened in this period"
        page={table.page}
        limit={table.limit}
        total={table.total}
        onPageChange={table.setPage}
        onLimitChange={table.setLimit}
      />
    </Box>
  );
};

export default ActivityLogsPage;
