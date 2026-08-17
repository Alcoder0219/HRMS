import { useCallback, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import WorkIcon from '@mui/icons-material/WorkOutlineOutlined';
import PersonSearchIcon from '@mui/icons-material/PersonSearchOutlined';
import EventSeatIcon from '@mui/icons-material/EventSeatOutlined';
import TimerIcon from '@mui/icons-material/TimerOutlined';

import PageHeader from '@components/common/PageHeader.jsx';
import DataTable from '@components/common/DataTable.jsx';
import StatCard from '@components/common/StatCard.jsx';
import ExportMenu from '@components/common/ExportMenu.jsx';
import { LoadingState, ErrorState } from '@components/common/StateBlock.jsx';
import recruitmentService from '@services/modules/recruitment.service.js';
import { STAGE_COLOR } from './recruitmentConstants.js';
import { humanize } from '@utils/format.js';
import { getRowId } from '@utils/dataGrid.js';
import { PATHS } from '@routes/paths.js';

/**
 * The hiring funnel and what it costs in time.
 *
 * "Reached" counts everyone who got at least this far, so the funnel only ever
 * narrows -- counting the current stage alone would show a candidate sitting at
 * Offer as never having been interviewed.
 */
const HiringReportsPage = () => {
  const [params, setParams] = useState({ from: '', to: '', jobOpeningId: '' });
  const [data, setData] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    recruitmentService
      .listJobs({ limit: 100 })
      .then((response) => setJobs(response.data ?? []))
      .catch(() => setJobs([]));
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);

    recruitmentService
      .hiringReport(params)
      .then((response) => setData(response.data))
      .catch((rejection) => {
        setData(null);
        setError(rejection?.message ?? 'Could not load the hiring report');
      })
      .finally(() => setLoading(false));
  }, [params]);

  useEffect(() => {
    load();
  }, [load]);

  const set = (field) => (event) => setParams((previous) => ({ ...previous, [field]: event.target.value }));

  const totals = data?.totals ?? {};
  const funnel = data?.funnel ?? [];
  const widest = funnel[0]?.reached ?? 0;

  const sourceColumns = [
    { key: 'source', label: 'Source', render: (row) => humanize(row.source) },
    { key: 'applied', label: 'Applied', align: 'right' },
    { key: 'hired', label: 'Hired', align: 'right' },
    {
      key: 'conversionPercent',
      label: 'Conversion',
      align: 'right',
      render: (row) => (
        <Chip
          label={`${row.conversionPercent}%`}
          size="small"
          color={row.conversionPercent >= 20 ? 'success' : row.conversionPercent > 0 ? 'warning' : 'default'}
          variant="outlined"
        />
      ),
    },
  ];

  const jobColumns = [
    { key: 'code', label: 'Code' },
    { key: 'title', label: 'Opening' },
    { key: 'applied', label: 'Applied', align: 'right' },
    { key: 'active', label: 'In progress', align: 'right' },
    {
      key: 'hired',
      label: 'Hired',
      align: 'right',
      render: (row) => (row.hired ? <Chip label={row.hired} size="small" color="success" /> : '—'),
    },
    { key: 'rejected', label: 'Closed out', align: 'right' },
  ];

  return (
    <Box>
      <PageHeader
        title="Hiring Reports"
        subtitle="Where candidates drop out, which sources work, and how long hiring takes"
        breadcrumbs={[{ label: 'Home', to: PATHS.dashboard }, { label: 'Recruitment' }, { label: 'Reports' }]}
        actions={
          <ExportMenu
            columns={jobColumns}
            rows={data?.byJob ?? []}
            filename="hiring-report"
            totalCount={data?.byJob?.length ?? 0}
            onError={(message) => setError(message)}
          />
        }
      />

      {error && !loading && <ErrorState message={error} onRetry={load} minHeight={200} />}

      {!error && (
        <>
          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid size={{ xs: 6, sm: 3 }}>
              <StatCard label="Candidates" value={totals.candidates ?? 0} icon={PersonSearchIcon} loading={loading} />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <StatCard label="Hired" value={totals.hired ?? 0} color="success" loading={loading} />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <StatCard label="Open roles" value={totals.openJobs ?? 0} icon={WorkIcon} loading={loading} />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <StatCard
                label="Time to hire"
                value={`${totals.timeToHireDays ?? 0} d`}
                caption="Application to joining"
                icon={TimerIcon}
                loading={loading}
              />
            </Grid>
          </Grid>

          <Stack direction="row" spacing={1} sx={{ mb: 3 }} flexWrap="wrap" useFlexGap data-print="hide">
            <TextField
              size="small"
              type="date"
              label="Applied from"
              value={params.from}
              onChange={set('from')}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              size="small"
              type="date"
              label="To"
              value={params.to}
              onChange={set('to')}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              select
              size="small"
              label="Opening"
              value={params.jobOpeningId}
              onChange={set('jobOpeningId')}
              sx={{ width: 240 }}
            >
              <MenuItem value="">All openings</MenuItem>
              {jobs.map((job) => (
                <MenuItem key={getRowId(job)} value={getRowId(job)}>
                  {job.title}
                </MenuItem>
              ))}
            </TextField>
          </Stack>

          {loading && <LoadingState message="Building the report…" minHeight={200} />}

          {!loading && (
            <>
              <Typography variant="h6" sx={{ mb: 1 }}>
                Funnel
              </Typography>

              <Paper variant="outlined" sx={{ p: 2, mb: 3 }} data-print="table">
                <Stack spacing={1.5}>
                  {funnel.map((entry, index) => (
                    <Box key={entry.stage}>
                      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Chip
                            label={humanize(entry.stage)}
                            size="small"
                            color={STAGE_COLOR[entry.stage] ?? 'default'}
                            sx={{ minWidth: 110 }}
                          />
                          <Typography variant="body2" fontWeight={600}>
                            {entry.reached}
                          </Typography>
                        </Stack>

                        {index > 0 && (
                          <Typography
                            variant="caption"
                            color={entry.conversionPercent >= 50 ? 'success.main' : 'warning.main'}
                          >
                            {entry.conversionPercent}% from {humanize(funnel[index - 1].stage).toLowerCase()}
                          </Typography>
                        )}
                      </Stack>

                      <LinearProgress
                        variant="determinate"
                        value={widest ? (entry.reached / widest) * 100 : 0}
                        sx={{ height: 10, borderRadius: 5 }}
                        color={entry.stage === 'HIRED' ? 'success' : 'primary'}
                      />
                    </Box>
                  ))}

                  {funnel.length === 0 && (
                    <Typography variant="body2" color="text.secondary">
                      No candidates in this period.
                    </Typography>
                  )}
                </Stack>
              </Paper>

              <Grid container spacing={2}>
                <Grid size={{ xs: 12, md: 5 }}>
                  <Typography variant="h6" sx={{ mb: 1 }}>
                    By source
                  </Typography>
                  <DataTable
                    columns={sourceColumns}
                    rows={data?.bySource ?? []}
                    getKey={(row) => row.source}
                    emptyTitle="No applications yet"
                  />
                </Grid>

                <Grid size={{ xs: 12, md: 7 }}>
                  <Typography variant="h6" sx={{ mb: 1 }}>
                    By opening
                  </Typography>
                  <DataTable
                    columns={jobColumns}
                    rows={data?.byJob ?? []}
                    getKey={(row) => row.jobOpeningId}
                    emptyTitle="No openings with applicants"
                  />
                </Grid>
              </Grid>

              <Stack direction="row" spacing={2} sx={{ mt: 3 }} flexWrap="wrap" useFlexGap>
                <Chip icon={<EventSeatIcon />} label={`${totals.scheduledInterviews ?? 0} interview(s) scheduled`} variant="outlined" />
                <Chip label={`${totals.pendingOffers ?? 0} offer(s) awaiting response`} variant="outlined" />
              </Stack>
            </>
          )}
        </>
      )}
    </Box>
  );
};

export default HiringReportsPage;
