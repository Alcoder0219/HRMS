import { useCallback, useEffect, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Step from '@mui/material/Step';
import StepLabel from '@mui/material/StepLabel';
import Stepper from '@mui/material/Stepper';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/AddOutlined';
import SearchIcon from '@mui/icons-material/SearchOutlined';
import ClearIcon from '@mui/icons-material/ClearOutlined';
import ViewIcon from '@mui/icons-material/VisibilityOutlined';
import UploadIcon from '@mui/icons-material/UploadFileOutlined';
import DownloadIcon from '@mui/icons-material/FileDownloadOutlined';
import PersonSearchIcon from '@mui/icons-material/PersonSearchOutlined';

import PageHeader from '@components/common/PageHeader.jsx';
import DataTable from '@components/common/DataTable.jsx';
import StatCard from '@components/common/StatCard.jsx';
import ExportMenu from '@components/common/ExportMenu.jsx';
import FormDialog from '@components/common/FormDialog.jsx';
import CurrencyAdornment from '@components/common/CurrencyAdornment.jsx';
import useTableState from '@hooks/useTableState.js';
import usePermissions from '@hooks/usePermissions.js';
import { RESOURCES, ACTIONS } from '@utils/permissions.js';
import recruitmentService from '@services/modules/recruitment.service.js';
import {
  CANDIDATE_STAGES,
  MOVABLE_STAGES,
  STAGE_COLOR,
  CANDIDATE_SOURCES,
  INTERVIEW_STATUS_COLOR,
  OFFER_STATUS_COLOR,
} from './recruitmentConstants.js';
import { fileUrl } from '@utils/fileUrl.js';
import { formatCurrency, formatDate, formatDateTime, humanize } from '@utils/format.js';
import { getRowId } from '@utils/dataGrid.js';
import { PATHS } from '@routes/paths.js';

const FUNNEL = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED'];

const EMPTY = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  jobOpeningId: '',
  source: 'DIRECT',
  referredBy: '',
  totalExperienceYears: '',
  currentEmployer: '',
  currentCtc: '',
  expectedCtc: '',
  noticePeriodDays: '',
  notes: '',
};

/**
 * The applicant pipeline.
 *
 * A candidate is deliberately not an employee: no code, no salary structure, no
 * attendance, and most never will have. The two meet exactly once, at joining,
 * which the Offers screen owns.
 */
const CandidatesPage = () => {
  const { can } = usePermissions();

  const canCreate = can(RESOURCES.RECRUITMENT, ACTIONS.CREATE);
  const canUpdate = can(RESOURCES.RECRUITMENT, ACTIONS.UPDATE);

  const table = useTableState({
    initialFilters: { stage: '', jobOpeningId: '', source: '' },
    initialSort: 'appliedAt',
  });

  const [rows, setRows] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [form, setForm] = useState(undefined);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const resumeInput = useRef(null);
  const [resumeTarget, setResumeTarget] = useState(null);

  const { params, setTotal } = table;

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
      .listCandidates(params)
      .then((response) => {
        setRows(response.data ?? []);
        setTotal(response.meta?.total ?? 0);
      })
      .catch((rejection) => {
        setRows([]);
        setError(rejection?.message ?? 'Could not load candidates');
      })
      .finally(() => setLoading(false));
  }, [params, setTotal]);

  useEffect(() => {
    load();
  }, [load]);

  const openDetail = async (row) => {
    setDetailLoading(true);
    setDetail({ _id: getRowId(row) });

    try {
      const response = await recruitmentService.getCandidate(getRowId(row));
      setDetail(response.data);
    } catch (rejection) {
      setNotice({ severity: 'error', message: rejection?.message ?? 'Could not load the candidate' });
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const set = (field) => (event) => setForm((previous) => ({ ...previous, [field]: event.target.value }));

  const handleSave = async () => {
    setSaving(true);

    try {
      await recruitmentService.createCandidate({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || null,
        jobOpeningId: form.jobOpeningId,
        source: form.source,
        referredBy: form.referredBy.trim() || null,
        totalExperienceYears: Number(form.totalExperienceYears) || 0,
        currentEmployer: form.currentEmployer.trim() || null,
        currentCtc: Number(form.currentCtc) || 0,
        expectedCtc: Number(form.expectedCtc) || 0,
        noticePeriodDays: Number(form.noticePeriodDays) || 0,
        notes: form.notes.trim() || null,
      });

      setNotice({ severity: 'success', message: 'Candidate added' });
      setForm(undefined);
      load();
    } catch (rejection) {
      setNotice({ severity: 'error', message: rejection?.message ?? 'The candidate could not be saved' });
    } finally {
      setSaving(false);
    }
  };

  const moveStage = async (candidate, stage) => {
    // The server demands a reason for a rejection, so it is collected here
    // rather than sent empty and refused.
    let note = null;

    if (stage === 'REJECTED') {
      // eslint-disable-next-line no-alert
      note = window.prompt('Why is this candidate being rejected?');
      if (!note || note.trim().length < 3) return;
    }

    setBusy(true);

    try {
      await recruitmentService.moveStage(getRowId(candidate), { stage, ...(note ? { note } : {}) });
      setNotice({ severity: 'success', message: `Moved to ${stage.toLowerCase()}` });
      load();
      if (detail) openDetail(candidate);
    } catch (rejection) {
      setNotice({ severity: 'error', message: rejection?.message ?? 'The stage could not be changed' });
    } finally {
      setBusy(false);
    }
  };

  const uploadResume = async (file) => {
    const target = resumeTarget;
    setResumeTarget(null);

    if (!file || !target) return;

    setBusy(true);

    try {
      await recruitmentService.uploadResume(getRowId(target), file);
      setNotice({ severity: 'success', message: 'Resume uploaded' });
      load();
      if (detail) openDetail(target);
    } catch (rejection) {
      setNotice({ severity: 'error', message: rejection?.message ?? 'The upload failed' });
    } finally {
      setBusy(false);
    }
  };

  const columns = [
    {
      key: 'fullName',
      label: 'Candidate',
      sortable: true,
      exportValue: (row) => `${row.firstName} ${row.lastName}`,
      render: (row) => (
        <Box>
          <Typography variant="body2">
            {row.fullName ?? `${row.firstName} ${row.lastName}`}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {row.email}
          </Typography>
        </Box>
      ),
    },
    {
      key: 'job',
      label: 'Applied for',
      exportValue: (row) => row.jobOpeningId?.title,
      render: (row) => (
        <Box>
          <Typography variant="body2">{row.jobOpeningId?.title ?? '—'}</Typography>
          <Typography variant="caption" color="text.secondary" fontFamily="monospace">
            {row.jobOpeningId?.code ?? ''}
          </Typography>
        </Box>
      ),
    },
    {
      key: 'totalExperienceYears',
      label: 'Exp',
      align: 'right',
      render: (row) => (row.totalExperienceYears ? `${row.totalExperienceYears} yr` : '—'),
    },
    {
      key: 'expectedCtc',
      label: 'Expected',
      align: 'right',
      exportValue: (row) => row.expectedCtc,
      render: (row) => (row.expectedCtc ? formatCurrency(row.expectedCtc) : '—'),
    },
    {
      key: 'source',
      label: 'Source',
      exportValue: (row) => humanize(row.source),
      render: (row) => <Chip label={humanize(row.source)} size="small" variant="outlined" />,
    },
    {
      key: 'resume',
      label: 'Resume',
      exportValue: (row) => (row.resume?.filePath ? 'Yes' : 'No'),
      render: (row) =>
        row.resume?.filePath ? (
          <Tooltip title={row.resume.fileName}>
            <IconButton
              size="small"
              component="a"
              href={fileUrl(row.resume.filePath)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => event.stopPropagation()}
            >
              <DownloadIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ) : canUpdate ? (
          <Tooltip title="Upload resume">
            <IconButton
              size="small"
              onClick={(event) => {
                event.stopPropagation();
                setResumeTarget(row);
                resumeInput.current?.click();
              }}
            >
              <UploadIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ) : (
          '—'
        ),
    },
    {
      key: 'stage',
      label: 'Stage',
      sortable: true,
      exportValue: (row) => humanize(row.stage),
      render: (row) => (
        <Chip label={humanize(row.stage)} size="small" color={STAGE_COLOR[row.stage] ?? 'default'} />
      ),
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      width: 60,
      render: (row) => (
        <Tooltip title="Open">
          <IconButton size="small" onClick={(event) => { event.stopPropagation(); openDetail(row); }}>
            <ViewIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ),
    },
  ];

  const hasFilters = table.activeFilterCount > 0;
  const activeCount = rows.filter((row) => ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER'].includes(row.stage)).length;
  const hiredCount = rows.filter((row) => row.stage === 'HIRED').length;

  return (
    <Box>
      <PageHeader
        title="Candidates"
        subtitle="Everyone who has applied, and where they are in the process"
        breadcrumbs={[{ label: 'Home', to: PATHS.dashboard }, { label: 'Recruitment' }, { label: 'Candidates' }]}
        actions={
          <Stack direction="row" spacing={1} data-print="hide">
            <ExportMenu
              columns={columns}
              rows={rows}
              filename="candidates"
              totalCount={table.total}
              onError={(message) => setNotice({ severity: 'error', message })}
            />
            {canCreate && (
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => setForm({ ...EMPTY })}>
                Add candidate
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

      {busy && <LinearProgress sx={{ mb: 2 }} />}

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard label="Candidates" value={table.total} icon={PersonSearchIcon} loading={loading} />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard label="In progress (this page)" value={activeCount} color="primary" loading={loading} />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard label="Hired (this page)" value={hiredCount} color="success" loading={loading} />
        </Grid>
      </Grid>

      <Stack direction="row" spacing={1} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap data-print="hide">
        <TextField
          size="small"
          placeholder="Search name, email or employer"
          value={table.search}
          onChange={(event) => table.setSearch(event.target.value)}
          sx={{ width: { xs: '100%', sm: 300 } }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
        />

        <TextField
          select
          size="small"
          label="Stage"
          value={table.filters.stage}
          onChange={(event) => table.setFilter('stage', event.target.value)}
          sx={{ width: 170 }}
        >
          <MenuItem value="">All stages</MenuItem>
          {CANDIDATE_STAGES.map((stage) => (
            <MenuItem key={stage} value={stage}>
              {humanize(stage)}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          select
          size="small"
          label="Opening"
          value={table.filters.jobOpeningId}
          onChange={(event) => table.setFilter('jobOpeningId', event.target.value)}
          sx={{ width: 240 }}
        >
          <MenuItem value="">All openings</MenuItem>
          {jobs.map((job) => (
            <MenuItem key={getRowId(job)} value={getRowId(job)}>
              {job.title}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          select
          size="small"
          label="Source"
          value={table.filters.source}
          onChange={(event) => table.setFilter('source', event.target.value)}
          sx={{ width: 170 }}
        >
          <MenuItem value="">All sources</MenuItem>
          {CANDIDATE_SOURCES.map((source) => (
            <MenuItem key={source} value={source}>
              {humanize(source)}
            </MenuItem>
          ))}
        </TextField>

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
        sortBy={table.sortBy}
        sortOrder={table.sortOrder}
        onSort={table.toggleSort}
        onRowClick={openDetail}
        emptyTitle={hasFilters ? 'No candidates match' : 'No candidates yet'}
        emptyMessage={hasFilters ? 'Try clearing a filter.' : 'Add applicants against an open requisition.'}
        page={table.page}
        limit={table.limit}
        total={table.total}
        onPageChange={table.setPage}
        onLimitChange={table.setLimit}
      />

      {/* Outside the table, so a re-render cannot detach it mid-selection. */}
      <input
        ref={resumeInput}
        type="file"
        hidden
        accept=".pdf,.doc,.docx"
        onChange={(event) => {
          uploadResume(event.target.files?.[0]);
          event.target.value = '';
        }}
      />

      <FormDialog
        open={form !== undefined}
        title="Add candidate"
        subtitle="Applications are made against an open requisition"
        submitting={saving}
        submitLabel="Add candidate"
        disabled={!form?.firstName?.trim() || !form?.lastName?.trim() || !form?.email?.trim() || !form?.jobOpeningId}
        onSubmit={handleSave}
        onClose={() => setForm(undefined)}
        maxWidth="md"
      >
        <Grid container spacing={2} sx={{ pt: 0.5 }}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="First name" size="small" fullWidth required autoFocus value={form?.firstName ?? ''} onChange={set('firstName')} />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="Last name" size="small" fullWidth required value={form?.lastName ?? ''} onChange={set('lastName')} />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="Email" type="email" size="small" fullWidth required value={form?.email ?? ''} onChange={set('email')} />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="Phone" size="small" fullWidth value={form?.phone ?? ''} onChange={set('phone')} />
          </Grid>

          <Grid size={{ xs: 12, sm: 8 }}>
            <TextField select label="Applying for" size="small" fullWidth required value={form?.jobOpeningId ?? ''} onChange={set('jobOpeningId')}>
              {jobs
                .filter((job) => job.status === 'OPEN')
                .map((job) => (
                  <MenuItem key={getRowId(job)} value={getRowId(job)}>
                    {job.title} — {job.remaining} seat(s) left
                  </MenuItem>
                ))}
            </TextField>
          </Grid>

          <Grid size={{ xs: 12, sm: 4 }}>
            <TextField select label="Source" size="small" fullWidth value={form?.source ?? 'DIRECT'} onChange={set('source')}>
              {CANDIDATE_SOURCES.map((source) => (
                <MenuItem key={source} value={source}>
                  {humanize(source)}
                </MenuItem>
              ))}
            </TextField>
          </Grid>

          {form?.source === 'REFERRAL' && (
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField label="Referred by" size="small" fullWidth value={form?.referredBy ?? ''} onChange={set('referredBy')} />
            </Grid>
          )}

          <Grid size={{ xs: 6, sm: 3 }}>
            <TextField label="Experience (yrs)" type="number" size="small" fullWidth value={form?.totalExperienceYears ?? ''} onChange={set('totalExperienceYears')} />
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <TextField label="Notice (days)" type="number" size="small" fullWidth value={form?.noticePeriodDays ?? ''} onChange={set('noticePeriodDays')} />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="Current employer" size="small" fullWidth value={form?.currentEmployer ?? ''} onChange={set('currentEmployer')} />
          </Grid>

          <Grid size={{ xs: 6, sm: 3 }}>
            <TextField label="Current CTC" type="number" size="small" fullWidth value={form?.currentCtc ?? ''} onChange={set('currentCtc')} slotProps={{ input: { startAdornment: <CurrencyAdornment /> } }} />
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <TextField label="Expected CTC" type="number" size="small" fullWidth value={form?.expectedCtc ?? ''} onChange={set('expectedCtc')} slotProps={{ input: { startAdornment: <CurrencyAdornment /> } }} />
          </Grid>

          <Grid size={12}>
            <TextField label="Notes" size="small" fullWidth multiline rows={2} value={form?.notes ?? ''} onChange={set('notes')} />
          </Grid>
        </Grid>
      </FormDialog>

      <Dialog open={Boolean(detail)} onClose={() => setDetail(null)} maxWidth="md" fullWidth>
        <DialogTitle>
          {detail?.fullName ?? `${detail?.firstName ?? ''} ${detail?.lastName ?? ''}`}
          <Typography variant="body2" color="text.secondary">
            {detail?.email}
            {detail?.jobOpeningId?.title ? ` · ${detail.jobOpeningId.title}` : ''}
          </Typography>
        </DialogTitle>

        <DialogContent dividers>
          {detailLoading && <LinearProgress sx={{ mb: 2 }} />}

          {detail?.stage && (
            <Stepper
              activeStep={Math.max(0, FUNNEL.indexOf(detail.stage))}
              alternativeLabel
              sx={{ mb: 3 }}
            >
              {FUNNEL.map((stage) => (
                <Step key={stage} completed={FUNNEL.indexOf(detail.stage) > FUNNEL.indexOf(stage)}>
                  <StepLabel error={['REJECTED', 'WITHDRAWN'].includes(detail.stage) && stage === detail.stage}>
                    {humanize(stage)}
                  </StepLabel>
                </Step>
              ))}
            </Stepper>
          )}

          {['REJECTED', 'WITHDRAWN'].includes(detail?.stage) && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              {humanize(detail.stage)}
              {detail.rejectionReason ? ` — ${detail.rejectionReason}` : ''}
            </Alert>
          )}

          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <Typography variant="caption" color="text.secondary">
                Details
              </Typography>
              <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                <Typography variant="body2">Phone: {detail?.phone ?? '—'}</Typography>
                <Typography variant="body2">Experience: {detail?.totalExperienceYears ?? 0} yr</Typography>
                <Typography variant="body2">Employer: {detail?.currentEmployer ?? '—'}</Typography>
                <Typography variant="body2">Current CTC: {formatCurrency(detail?.currentCtc)}</Typography>
                <Typography variant="body2">Expected CTC: {formatCurrency(detail?.expectedCtc)}</Typography>
                <Typography variant="body2">Notice: {detail?.noticePeriodDays ?? 0} day(s)</Typography>
                <Typography variant="body2">Source: {humanize(detail?.source)}</Typography>
              </Stack>
            </Grid>

            <Grid size={{ xs: 12, sm: 6 }}>
              <Typography variant="caption" color="text.secondary">
                Resume
              </Typography>
              <Box sx={{ mt: 0.5 }}>
                {detail?.resume?.filePath ? (
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<DownloadIcon />}
                    component="a"
                    href={fileUrl(detail.resume.filePath)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {detail.resume.fileName}
                  </Button>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    Not uploaded
                  </Typography>
                )}
              </Box>

              {canUpdate && (
                <Button
                  size="small"
                  sx={{ mt: 1 }}
                  startIcon={<UploadIcon />}
                  onClick={() => {
                    setResumeTarget(detail);
                    resumeInput.current?.click();
                  }}
                >
                  {detail?.resume?.filePath ? 'Replace' : 'Upload'}
                </Button>
              )}
            </Grid>

            <Grid size={12}>
              <Divider sx={{ my: 1 }} />
              <Typography variant="caption" color="text.secondary">
                Interviews ({detail?.interviews?.length ?? 0})
              </Typography>
              <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                {(detail?.interviews ?? []).map((interview) => (
                  <Stack key={interview._id} direction="row" spacing={1} alignItems="center">
                    <Chip label={`Round ${interview.round}`} size="small" variant="outlined" />
                    <Typography variant="caption">{formatDateTime(interview.scheduledAt)}</Typography>
                    <Chip
                      label={humanize(interview.status)}
                      size="small"
                      color={INTERVIEW_STATUS_COLOR[interview.status] ?? 'default'}
                      variant="outlined"
                    />
                    {interview.averageRating != null && (
                      <Chip label={`${interview.averageRating}/5`} size="small" color="info" variant="outlined" />
                    )}
                  </Stack>
                ))}
                {!detail?.interviews?.length && (
                  <Typography variant="caption" color="text.secondary">
                    None scheduled.
                  </Typography>
                )}
              </Stack>
            </Grid>

            <Grid size={12}>
              <Typography variant="caption" color="text.secondary">
                Offers ({detail?.offers?.length ?? 0})
              </Typography>
              <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                {(detail?.offers ?? []).map((offer) => (
                  <Stack key={offer._id} direction="row" spacing={1} alignItems="center">
                    <Typography variant="caption" fontFamily="monospace">
                      {offer.offerNumber}
                    </Typography>
                    <Typography variant="caption">{formatCurrency(offer.annualCtc)}</Typography>
                    <Chip
                      label={humanize(offer.status)}
                      size="small"
                      color={OFFER_STATUS_COLOR[offer.status] ?? 'default'}
                      variant="outlined"
                    />
                  </Stack>
                ))}
                {!detail?.offers?.length && (
                  <Typography variant="caption" color="text.secondary">
                    None made.
                  </Typography>
                )}
              </Stack>
            </Grid>

            <Grid size={12}>
              <Divider sx={{ my: 1 }} />
              <Typography variant="caption" color="text.secondary">
                Stage history
              </Typography>
              <Stack spacing={0.5} sx={{ mt: 0.5, maxHeight: 160, overflowY: 'auto' }}>
                {[...(detail?.stageHistory ?? [])].reverse().map((entry, index) => (
                  <Stack key={`${entry.stage}-${index}`} direction="row" spacing={1} alignItems="center">
                    <Chip label={humanize(entry.stage)} size="small" color={STAGE_COLOR[entry.stage] ?? 'default'} variant="outlined" sx={{ minWidth: 110 }} />
                    <Typography variant="caption" color="text.secondary">
                      {formatDateTime(entry.at)} {entry.note ? `· ${entry.note}` : ''}
                    </Typography>
                  </Stack>
                ))}
              </Stack>
            </Grid>
          </Grid>
        </DialogContent>

        <DialogActions sx={{ px: 3, py: 2, flexWrap: 'wrap', gap: 1 }}>
          {canUpdate && detail?.stage && !['HIRED'].includes(detail.stage) && (
            <TextField
              select
              size="small"
              label="Move to"
              value=""
              onChange={(event) => moveStage(detail, event.target.value)}
              sx={{ width: 200, mr: 'auto' }}
            >
              {MOVABLE_STAGES.filter((stage) => stage !== detail.stage).map((stage) => (
                <MenuItem key={stage} value={stage}>
                  {humanize(stage)}
                </MenuItem>
              ))}
            </TextField>
          )}

          <Button onClick={() => setDetail(null)} color="inherit">
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default CandidatesPage;
