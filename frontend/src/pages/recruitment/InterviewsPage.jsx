import { useCallback, useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Rating from '@mui/material/Rating';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/AddOutlined';
import ClearIcon from '@mui/icons-material/ClearOutlined';
import EventSeatIcon from '@mui/icons-material/EventSeatOutlined';
import CheckIcon from '@mui/icons-material/CheckCircleOutlined';

import PageHeader from '@components/common/PageHeader.jsx';
import DataTable from '@components/common/DataTable.jsx';
import StatCard from '@components/common/StatCard.jsx';
import ExportMenu from '@components/common/ExportMenu.jsx';
import FormDialog from '@components/common/FormDialog.jsx';
import { EmptyState } from '@components/common/StateBlock.jsx';
import useTableState from '@hooks/useTableState.js';
import usePermissions from '@hooks/usePermissions.js';
import { RESOURCES, ACTIONS } from '@utils/permissions.js';
import recruitmentService from '@services/modules/recruitment.service.js';
import {
  INTERVIEW_MODES,
  INTERVIEW_STATUS_COLOR,
  RECOMMENDATIONS,
} from './recruitmentConstants.js';
import { formatDate, formatDateTime, humanize } from '@utils/format.js';
import { getRowId } from '@utils/dataGrid.js';
import { PATHS } from '@routes/paths.js';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const now = new Date();

const EMPTY_SCHEDULE = {
  candidateId: '',
  scheduledAt: '',
  durationMinutes: 45,
  mode: 'VIDEO',
  title: '',
  location: '',
  meetingLink: '',
};

const EMPTY_FEEDBACK = {
  interviewerName: '',
  rating: 3,
  recommendation: 'YES',
  strengths: '',
  concerns: '',
  comment: '',
  closeRound: true,
};

/**
 * The interview schedule, as a list and as a month.
 *
 * Feedback is held per interviewer rather than averaged into one field: a panel
 * disagreeing is the most useful signal there is, and collapsing it before
 * anyone reads it destroys exactly that.
 */
const InterviewsPage = () => {
  const { can } = usePermissions();

  const canSchedule = can(RESOURCES.RECRUITMENT, ACTIONS.CREATE);
  const canUpdate = can(RESOURCES.RECRUITMENT, ACTIONS.UPDATE);

  const [tab, setTab] = useState('list');
  const table = useTableState({ initialFilters: { status: '', from: '', to: '' }, initialSort: 'scheduledAt' });

  const [rows, setRows] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [schedule, setSchedule] = useState(undefined);
  const [feedback, setFeedback] = useState(undefined);
  const [saving, setSaving] = useState(false);
  const [month, setMonth] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });

  const { params, setTotal } = table;

  useEffect(() => {
    // Only candidates who can still be interviewed.
    recruitmentService
      .listCandidates({ active: true, limit: 200 })
      .then((response) => setCandidates(response.data ?? []))
      .catch(() => setCandidates([]));
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);

    // The calendar reads the whole month; the list honours the filters.
    const query =
      tab === 'calendar'
        ? {
            from: new Date(month.year, month.month - 1, 1).toISOString(),
            to: new Date(month.year, month.month, 0, 23, 59).toISOString(),
            limit: 200,
          }
        : params;

    recruitmentService
      .listInterviews(query)
      .then((response) => {
        setRows(response.data ?? []);
        if (tab !== 'calendar') setTotal(response.meta?.total ?? 0);
      })
      .catch((rejection) => {
        setRows([]);
        setError(rejection?.message ?? 'Could not load interviews');
      })
      .finally(() => setLoading(false));
  }, [tab, params, month.year, month.month, setTotal]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSchedule = async () => {
    setSaving(true);

    try {
      await recruitmentService.scheduleInterview({
        candidateId: schedule.candidateId,
        scheduledAt: new Date(schedule.scheduledAt).toISOString(),
        durationMinutes: Number(schedule.durationMinutes) || 45,
        mode: schedule.mode,
        title: schedule.title.trim() || null,
        location: schedule.location.trim() || null,
        meetingLink: schedule.meetingLink.trim() || null,
      });

      setNotice({ severity: 'success', message: 'Interview scheduled' });
      setSchedule(undefined);
      load();
    } catch (rejection) {
      setNotice({ severity: 'error', message: rejection?.message ?? 'The interview could not be scheduled' });
    } finally {
      setSaving(false);
    }
  };

  const handleFeedback = async () => {
    setSaving(true);

    try {
      await recruitmentService.submitFeedback(getRowId(feedback.interview), {
        interviewerName: feedback.interviewerName.trim() || null,
        rating: Number(feedback.rating),
        recommendation: feedback.recommendation,
        strengths: feedback.strengths.trim() || null,
        concerns: feedback.concerns.trim() || null,
        comment: feedback.comment.trim() || null,
        closeRound: feedback.closeRound,
      });

      setNotice({ severity: 'success', message: 'Feedback recorded' });
      setFeedback(undefined);
      load();
    } catch (rejection) {
      setNotice({ severity: 'error', message: rejection?.message ?? 'The feedback could not be saved' });
    } finally {
      setSaving(false);
    }
  };

  const cancelInterview = async (row) => {
    try {
      await recruitmentService.updateInterview(getRowId(row), {
        status: 'CANCELLED',
        cancelReason: 'Cancelled from the schedule',
      });
      setNotice({ severity: 'success', message: 'Interview cancelled' });
      load();
    } catch (rejection) {
      setNotice({ severity: 'error', message: rejection?.message ?? 'Could not cancel' });
    }
  };

  const byDate = useMemo(() => {
    const map = new Map();

    rows.forEach((row) => {
      const key = new Date(row.scheduledAt).toISOString().slice(0, 10);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
    });

    return map;
  }, [rows]);

  const weeks = useMemo(() => {
    const first = new Date(month.year, month.month - 1, 1);
    const last = new Date(month.year, month.month, 0);

    const cells = [...Array(first.getDay()).fill(null)];
    for (let day = 1; day <= last.getDate(); day += 1) {
      const date = new Date(month.year, month.month - 1, day);
      cells.push({ day, key: date.toISOString().slice(0, 10) });
    }

    const result = [];
    for (let index = 0; index < cells.length; index += 7) result.push(cells.slice(index, index + 7));
    return result;
  }, [month.year, month.month]);

  const columns = [
    {
      key: 'scheduledAt',
      label: 'When',
      sortable: true,
      width: 180,
      exportValue: (row) => formatDateTime(row.scheduledAt),
      render: (row) => (
        <Box>
          <Typography variant="body2">{formatDateTime(row.scheduledAt)}</Typography>
          <Typography variant="caption" color="text.secondary">
            {row.durationMinutes} min · {humanize(row.mode)}
          </Typography>
        </Box>
      ),
    },
    {
      key: 'candidate',
      label: 'Candidate',
      exportValue: (row) => `${row.candidateId?.firstName ?? ''} ${row.candidateId?.lastName ?? ''}`.trim(),
      render: (row) => (
        <Box>
          <Typography variant="body2">
            {`${row.candidateId?.firstName ?? ''} ${row.candidateId?.lastName ?? ''}`.trim() || '—'}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {row.jobOpeningId?.title ?? ''}
          </Typography>
        </Box>
      ),
    },
    { key: 'round', label: 'Round', align: 'right', render: (row) => `#${row.round}` },
    {
      key: 'averageRating',
      label: 'Rating',
      align: 'right',
      exportValue: (row) => row.averageRating,
      render: (row) =>
        row.averageRating != null ? (
          <Chip label={`${row.averageRating}/5`} size="small" color="info" variant="outlined" />
        ) : (
          '—'
        ),
    },
    {
      key: 'outcome',
      label: 'Outcome',
      exportValue: (row) => humanize(row.outcome),
      render: (row) => {
        if (!row.outcome) return '—';
        const meta = RECOMMENDATIONS.find((option) => option.value === row.outcome);
        return <Chip label={meta?.label ?? humanize(row.outcome)} size="small" color={meta?.color ?? 'default'} variant="outlined" />;
      },
    },
    {
      key: 'status',
      label: 'Status',
      exportValue: (row) => humanize(row.status),
      render: (row) => (
        <Chip label={humanize(row.status)} size="small" color={INTERVIEW_STATUS_COLOR[row.status] ?? 'default'} />
      ),
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      width: 170,
      render: (row) =>
        canUpdate && row.status === 'SCHEDULED' ? (
          <Stack direction="row" spacing={0.5} justifyContent="flex-end">
            <Button size="small" startIcon={<CheckIcon />} onClick={() => setFeedback({ ...EMPTY_FEEDBACK, interview: row })}>
              Feedback
            </Button>
            <Button size="small" color="inherit" onClick={() => cancelInterview(row)}>
              Cancel
            </Button>
          </Stack>
        ) : (
          '—'
        ),
    },
  ];

  const scheduled = rows.filter((row) => row.status === 'SCHEDULED').length;
  const completed = rows.filter((row) => row.status === 'COMPLETED').length;
  const hasFilters = table.activeFilterCount > 0;

  return (
    <Box>
      <PageHeader
        title="Interviews"
        subtitle="The schedule, and what each panel decided"
        breadcrumbs={[{ label: 'Home', to: PATHS.dashboard }, { label: 'Recruitment' }, { label: 'Interviews' }]}
        actions={
          <Stack direction="row" spacing={1} data-print="hide">
            <ExportMenu
              columns={columns}
              rows={rows}
              filename="interviews"
              totalCount={table.total}
              onError={(message) => setNotice({ severity: 'error', message })}
            />
            {canSchedule && (
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => setSchedule({ ...EMPTY_SCHEDULE })}>
                Schedule
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

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard label="Interviews" value={tab === 'calendar' ? rows.length : table.total} icon={EventSeatIcon} loading={loading} />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard label="Scheduled" value={scheduled} color="primary" loading={loading} />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard label="Completed" value={completed} color="success" loading={loading} />
        </Grid>
      </Grid>

      <Tabs value={tab} onChange={(_event, next) => setTab(next)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Tab value="list" label="Schedule" />
        <Tab value="calendar" label="Calendar" />
      </Tabs>

      {tab === 'list' ? (
        <>
          <Stack direction="row" spacing={1} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap data-print="hide">
            <TextField
              select
              size="small"
              label="Status"
              value={table.filters.status}
              onChange={(event) => table.setFilter('status', event.target.value)}
              sx={{ width: 170 }}
            >
              <MenuItem value="">All statuses</MenuItem>
              {Object.keys(INTERVIEW_STATUS_COLOR).map((status) => (
                <MenuItem key={status} value={status}>
                  {humanize(status)}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              size="small"
              type="date"
              label="From"
              value={table.filters.from}
              onChange={(event) => table.setFilter('from', event.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              size="small"
              type="date"
              label="To"
              value={table.filters.to}
              onChange={(event) => table.setFilter('to', event.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
            />

            {hasFilters && (
              <Button size="small" color="inherit" startIcon={<ClearIcon />} onClick={table.resetFilters}>
                Clear
              </Button>
            )}
          </Stack>

          <DataTable
            columns={columns}
            rows={rows}
            loading={loading}
            error={error}
            onRetry={load}
            emptyTitle={hasFilters ? 'No interviews match' : 'Nothing scheduled'}
            emptyMessage={hasFilters ? 'Try widening the dates.' : 'Schedule a round against an active candidate.'}
            page={table.page}
            limit={table.limit}
            total={table.total}
            onPageChange={table.setPage}
            onLimitChange={table.setLimit}
          />
        </>
      ) : (
        <>
          <Stack direction="row" spacing={1} sx={{ mb: 2 }} data-print="hide">
            <TextField
              select
              size="small"
              label="Year"
              value={month.year}
              onChange={(event) => setMonth((p) => ({ ...p, year: Number(event.target.value) }))}
              sx={{ width: 120 }}
            >
              {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map((year) => (
                <MenuItem key={year} value={year}>
                  {year}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              select
              size="small"
              label="Month"
              value={month.month}
              onChange={(event) => setMonth((p) => ({ ...p, month: Number(event.target.value) }))}
              sx={{ width: 160 }}
            >
              {Array.from({ length: 12 }, (_, index) => (
                <MenuItem key={index + 1} value={index + 1}>
                  {new Date(2000, index).toLocaleString([], { month: 'long' })}
                </MenuItem>
              ))}
            </TextField>
          </Stack>

          <Paper variant="outlined" sx={{ p: 2, overflowX: 'auto' }} data-print="table">
            <Box sx={{ minWidth: 640 }}>
              <Grid container columns={7} spacing={1} sx={{ mb: 1 }}>
                {WEEKDAYS.map((weekday) => (
                  <Grid key={weekday} size={1}>
                    <Typography variant="caption" color="text.secondary" align="center" display="block">
                      {weekday}
                    </Typography>
                  </Grid>
                ))}
              </Grid>

              {weeks.map((week, weekIndex) => (
                <Grid container columns={7} spacing={1} key={weekIndex} sx={{ mb: 1 }}>
                  {week.map((cell, cellIndex) => {
                    if (!cell) return <Grid key={`pad-${cellIndex}`} size={1} />;

                    const entries = byDate.get(cell.key) ?? [];

                    return (
                      <Grid key={cell.key} size={1}>
                        <Tooltip
                          arrow
                          title={
                            entries.length
                              ? entries
                                  .map(
                                    (entry) =>
                                      `${new Date(entry.scheduledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} — ${entry.candidateId?.firstName ?? ''} ${entry.candidateId?.lastName ?? ''} (round ${entry.round})`,
                                  )
                                  .join('\n')
                              : 'Nothing scheduled'
                          }
                        >
                          <Box
                            sx={{
                              minHeight: 78,
                              p: 1,
                              borderRadius: 1,
                              border: 1,
                              borderColor: 'divider',
                              bgcolor: entries.length ? 'primary.light' : 'background.paper',
                              color: entries.length ? 'primary.contrastText' : 'inherit',
                            }}
                          >
                            <Typography variant="caption">{cell.day}</Typography>
                            {entries.length > 0 && (
                              <>
                                <Typography variant="h6" sx={{ lineHeight: 1.2 }}>
                                  {entries.length}
                                </Typography>
                                <Typography variant="caption" noWrap display="block">
                                  {entries[0].candidateId?.firstName ?? ''}
                                  {entries.length > 1 ? ` +${entries.length - 1}` : ''}
                                </Typography>
                              </>
                            )}
                          </Box>
                        </Tooltip>
                      </Grid>
                    );
                  })}
                </Grid>
              ))}

              {rows.length === 0 && !loading && (
                <EmptyState title="Nothing scheduled this month" minHeight={120} />
              )}
            </Box>
          </Paper>
        </>
      )}

      <FormDialog
        open={schedule !== undefined}
        title="Schedule an interview"
        subtitle="Rounds number themselves, and scheduling moves the candidate to Interview"
        submitting={saving}
        submitLabel="Schedule"
        disabled={!schedule?.candidateId || !schedule?.scheduledAt}
        onSubmit={handleSchedule}
        onClose={() => setSchedule(undefined)}
      >
        <Grid container spacing={2} sx={{ pt: 0.5 }}>
          <Grid size={12}>
            <TextField
              select
              label="Candidate"
              size="small"
              fullWidth
              required
              value={schedule?.candidateId ?? ''}
              onChange={(event) => setSchedule((p) => ({ ...p, candidateId: event.target.value }))}
              helperText="Only candidates still in the running"
            >
              {candidates.map((candidate) => (
                <MenuItem key={getRowId(candidate)} value={getRowId(candidate)}>
                  {candidate.fullName ?? `${candidate.firstName} ${candidate.lastName}`} — {candidate.jobOpeningId?.title ?? ''}
                </MenuItem>
              ))}
            </TextField>
          </Grid>

          <Grid size={{ xs: 12, sm: 7 }}>
            <TextField
              label="When"
              type="datetime-local"
              size="small"
              fullWidth
              required
              value={schedule?.scheduledAt ?? ''}
              onChange={(event) => setSchedule((p) => ({ ...p, scheduledAt: event.target.value }))}
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Grid>

          <Grid size={{ xs: 6, sm: 2 }}>
            <TextField
              label="Minutes"
              type="number"
              size="small"
              fullWidth
              value={schedule?.durationMinutes ?? 45}
              onChange={(event) => setSchedule((p) => ({ ...p, durationMinutes: event.target.value }))}
            />
          </Grid>

          <Grid size={{ xs: 6, sm: 3 }}>
            <TextField
              select
              label="Mode"
              size="small"
              fullWidth
              value={schedule?.mode ?? 'VIDEO'}
              onChange={(event) => setSchedule((p) => ({ ...p, mode: event.target.value }))}
            >
              {INTERVIEW_MODES.map((mode) => (
                <MenuItem key={mode} value={mode}>
                  {humanize(mode)}
                </MenuItem>
              ))}
            </TextField>
          </Grid>

          <Grid size={12}>
            <TextField
              label="Title"
              size="small"
              fullWidth
              value={schedule?.title ?? ''}
              onChange={(event) => setSchedule((p) => ({ ...p, title: event.target.value }))}
              placeholder="Technical screen"
            />
          </Grid>

          {schedule?.mode === 'IN_PERSON' ? (
            <Grid size={12}>
              <TextField
                label="Location"
                size="small"
                fullWidth
                value={schedule?.location ?? ''}
                onChange={(event) => setSchedule((p) => ({ ...p, location: event.target.value }))}
              />
            </Grid>
          ) : (
            <Grid size={12}>
              <TextField
                label="Meeting link"
                size="small"
                fullWidth
                value={schedule?.meetingLink ?? ''}
                onChange={(event) => setSchedule((p) => ({ ...p, meetingLink: event.target.value }))}
              />
            </Grid>
          )}
        </Grid>
      </FormDialog>

      <FormDialog
        open={feedback !== undefined}
        title="Interview feedback"
        subtitle={
          feedback?.interview
            ? `Round ${feedback.interview.round} — ${feedback.interview.candidateId?.firstName ?? ''} ${feedback.interview.candidateId?.lastName ?? ''}`
            : ''
        }
        submitting={saving}
        submitLabel="Record feedback"
        onSubmit={handleFeedback}
        onClose={() => setFeedback(undefined)}
      >
        <Grid container spacing={2} sx={{ pt: 0.5 }}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Interviewer"
              size="small"
              fullWidth
              value={feedback?.interviewerName ?? ''}
              onChange={(event) => setFeedback((p) => ({ ...p, interviewerName: event.target.value }))}
            />
          </Grid>

          <Grid size={{ xs: 12, sm: 6 }}>
            <Typography variant="caption" color="text.secondary" display="block">
              Rating
            </Typography>
            <Rating
              value={Number(feedback?.rating ?? 3)}
              onChange={(_event, value) => setFeedback((p) => ({ ...p, rating: value ?? 3 }))}
            />
          </Grid>

          <Grid size={12}>
            <TextField
              select
              label="Recommendation"
              size="small"
              fullWidth
              value={feedback?.recommendation ?? 'YES'}
              onChange={(event) => setFeedback((p) => ({ ...p, recommendation: event.target.value }))}
            >
              {RECOMMENDATIONS.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
          </Grid>

          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Strengths"
              size="small"
              fullWidth
              multiline
              rows={2}
              value={feedback?.strengths ?? ''}
              onChange={(event) => setFeedback((p) => ({ ...p, strengths: event.target.value }))}
            />
          </Grid>

          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Concerns"
              size="small"
              fullWidth
              multiline
              rows={2}
              value={feedback?.concerns ?? ''}
              onChange={(event) => setFeedback((p) => ({ ...p, concerns: event.target.value }))}
            />
          </Grid>

          <Grid size={12}>
            <TextField
              label="Comment"
              size="small"
              fullWidth
              multiline
              rows={2}
              value={feedback?.comment ?? ''}
              onChange={(event) => setFeedback((p) => ({ ...p, comment: event.target.value }))}
            />
          </Grid>

          <Grid size={12}>
            <Alert severity="info">
              Closing the round marks the interview completed and records this recommendation as the panel&apos;s
              overall call. Leave it open if other interviewers still have to submit.
            </Alert>
            <TextField
              select
              size="small"
              fullWidth
              sx={{ mt: 1 }}
              label="After submitting"
              value={feedback?.closeRound ? 'close' : 'open'}
              onChange={(event) => setFeedback((p) => ({ ...p, closeRound: event.target.value === 'close' }))}
            >
              <MenuItem value="close">Close the round</MenuItem>
              <MenuItem value="open">Leave it open for others</MenuItem>
            </TextField>
          </Grid>
        </Grid>
      </FormDialog>
    </Box>
  );
};

export default InterviewsPage;
