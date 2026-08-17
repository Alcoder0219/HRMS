import { useCallback, useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/AddOutlined';
import PdfIcon from '@mui/icons-material/PictureAsPdfOutlined';
import HowToRegIcon from '@mui/icons-material/HowToRegOutlined';
import MailIcon from '@mui/icons-material/MailOutlineOutlined';

import PageHeader from '@components/common/PageHeader.jsx';
import DataTable from '@components/common/DataTable.jsx';
import StatCard from '@components/common/StatCard.jsx';
import ExportMenu from '@components/common/ExportMenu.jsx';
import FormDialog from '@components/common/FormDialog.jsx';
import CurrencyAdornment from '@components/common/CurrencyAdornment.jsx';
import ConfirmDialog from '@components/feedback/ConfirmDialog.jsx';
import useTableState from '@hooks/useTableState.js';
import usePermissions from '@hooks/usePermissions.js';
import { useAppDispatch, useAppSelector } from '@hooks/useRedux.js';
import { fetchMasters, selectMasters } from '@redux/slices/employeeSlice.js';
import { RESOURCES, ACTIONS } from '@utils/permissions.js';
import recruitmentService from '@services/modules/recruitment.service.js';
import { OFFER_STATUS_COLOR, OFFER_NEXT, EMPLOYMENT_TYPES } from './recruitmentConstants.js';
import { downloadBlob } from '@utils/exporters.js';
import { formatCurrency, formatDate, humanize } from '@utils/format.js';
import { getRowId, employeeIdentifiers } from '@utils/dataGrid.js';
import { PATHS } from '@routes/paths.js';

const EMPTY = {
  candidateId: '',
  designationId: '',
  departmentId: '',
  unitId: '',
  gradeId: '',
  employmentType: 'FULL_TIME',
  annualCtc: '',
  probationMonths: 3,
  noticePeriodDays: 30,
  proposedJoiningDate: '',
  validUntil: '',
  notes: '',
};

/**
 * Offers, and the joining step that turns an accepted one into an employee.
 *
 * Conversion is the only place recruitment writes to the employee table, and it
 * goes through the employee service -- so a new joiner is subject to the same
 * uniqueness and date rules as anyone created through the Employee module.
 */
const OffersPage = () => {
  const dispatch = useAppDispatch();
  const masters = useAppSelector(selectMasters);
  const { can } = usePermissions();

  // Making an offer and converting one both commit the organisation.
  const canApprove = can(RESOURCES.RECRUITMENT, ACTIONS.APPROVE);

  const table = useTableState({ initialFilters: { status: '' } });

  const [rows, setRows] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [form, setForm] = useState(undefined);
  const [saving, setSaving] = useState(false);
  const [statusChange, setStatusChange] = useState(null);
  const [convert, setConvert] = useState(undefined);

  const { params, setTotal } = table;

  useEffect(() => {
    dispatch(fetchMasters());

    recruitmentService
      .listCandidates({ active: true, limit: 200 })
      .then((response) => setCandidates(response.data ?? []))
      .catch(() => setCandidates([]));
  }, [dispatch]);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);

    recruitmentService
      .listOffers(params)
      .then((response) => {
        setRows(response.data ?? []);
        setTotal(response.meta?.total ?? 0);
      })
      .catch((rejection) => {
        setRows([]);
        setError(rejection?.message ?? 'Could not load offers');
      })
      .finally(() => setLoading(false));
  }, [params, setTotal]);

  useEffect(() => {
    load();
  }, [load]);

  const set = (field) => (event) => setForm((previous) => ({ ...previous, [field]: event.target.value }));

  const handleCreate = async () => {
    setSaving(true);

    try {
      await recruitmentService.createOffer({
        candidateId: form.candidateId,
        designationId: form.designationId || null,
        departmentId: form.departmentId || null,
        unitId: form.unitId || null,
        gradeId: form.gradeId || null,
        employmentType: form.employmentType,
        annualCtc: Number(form.annualCtc),
        probationMonths: Number(form.probationMonths) || 0,
        noticePeriodDays: Number(form.noticePeriodDays) || 0,
        proposedJoiningDate: form.proposedJoiningDate,
        ...(form.validUntil ? { validUntil: form.validUntil } : {}),
        notes: form.notes.trim() || null,
      });

      setNotice({ severity: 'success', message: 'Offer created' });
      setForm(undefined);
      load();
    } catch (rejection) {
      setNotice({ severity: 'error', message: rejection?.message ?? 'The offer could not be created' });
    } finally {
      setSaving(false);
    }
  };

  const applyStatus = async (reason) => {
    const target = statusChange;
    setStatusChange(null);

    try {
      await recruitmentService.setOfferStatus(target.id, {
        status: target.status,
        ...(reason ? { reason } : {}),
      });
      setNotice({ severity: 'success', message: `Offer ${target.status.toLowerCase()}` });
      load();
    } catch (rejection) {
      setNotice({ severity: 'error', message: rejection?.message ?? 'The status could not be changed' });
    }
  };

  const runConvert = async () => {
    setSaving(true);

    try {
      const response = await recruitmentService.convert(getRowId(convert.offer), {
        ...(convert.joiningDate ? { joiningDate: convert.joiningDate } : {}),
        ...(convert.employeeCode.trim() ? { employeeCode: convert.employeeCode.trim().toUpperCase() } : {}),
        ...(convert.workEmail.trim() ? { workEmail: convert.workEmail.trim() } : {}),
      });

      setNotice({ severity: 'success', message: response.message ?? 'Employee created' });
      setConvert(undefined);
      load();
    } catch (rejection) {
      setNotice({ severity: 'error', message: rejection?.message ?? 'The conversion failed' });
    } finally {
      setSaving(false);
    }
  };

  const downloadLetter = async (row) => {
    try {
      const blob = await recruitmentService.offerLetter(getRowId(row));
      downloadBlob(blob, `offer-${row.offerNumber}.pdf`);
    } catch (rejection) {
      setNotice({ severity: 'error', message: rejection?.message ?? 'The letter could not be downloaded' });
    }
  };

  const columns = [
    { key: 'offerNumber', label: 'Offer', width: 120 },
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
    {
      key: 'designation',
      label: 'Role offered',
      exportValue: (row) => row.designationId?.name,
      render: (row) => row.designationId?.name ?? '—',
    },
    {
      key: 'annualCtc',
      label: 'Annual CTC',
      align: 'right',
      exportValue: (row) => row.annualCtc,
      render: (row) => <strong>{formatCurrency(row.annualCtc)}</strong>,
    },
    {
      key: 'proposedJoiningDate',
      label: 'Joining',
      exportValue: (row) => formatDate(row.proposedJoiningDate),
      render: (row) => (
        <Box>
          <Typography variant="body2">{formatDate(row.actualJoiningDate ?? row.proposedJoiningDate)}</Typography>
          {row.actualJoiningDate && (
            <Typography variant="caption" color="success.main">
              joined
            </Typography>
          )}
        </Box>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      exportValue: (row) => humanize(row.status),
      render: (row) => (
        <Box>
          <Chip label={humanize(row.status)} size="small" color={OFFER_STATUS_COLOR[row.status] ?? 'default'} />
          {row.employeeId && (
            <Typography variant="caption" display="block" color="text.secondary">
              {employeeIdentifiers(row.employeeId)}
            </Typography>
          )}
        </Box>
      ),
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      width: 260,
      render: (row) => (
        <Stack direction="row" spacing={0.5} justifyContent="flex-end" flexWrap="wrap" useFlexGap>
          <Tooltip title="Offer letter">
            <IconButton size="small" onClick={() => downloadLetter(row)}>
              <PdfIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          {canApprove &&
            (OFFER_NEXT[row.status] ?? []).map((action) => (
              <Button
                key={action.value}
                size="small"
                color={action.color}
                onClick={() =>
                  setStatusChange({ id: getRowId(row), status: action.value, number: row.offerNumber })
                }
              >
                {action.label}
              </Button>
            ))}

          {canApprove && row.status === 'ACCEPTED' && (
            <Button
              size="small"
              variant="contained"
              color="success"
              startIcon={<HowToRegIcon />}
              onClick={() =>
                setConvert({
                  offer: row,
                  joiningDate: row.proposedJoiningDate
                    ? new Date(row.proposedJoiningDate).toISOString().slice(0, 10)
                    : '',
                  employeeCode: '',
                  workEmail: '',
                })
              }
            >
              Join
            </Button>
          )}
        </Stack>
      ),
    },
  ];

  const sent = rows.filter((row) => row.status === 'SENT').length;
  const joined = rows.filter((row) => row.status === 'JOINED').length;

  const picker = (label, field, options) => (
    <Grid size={{ xs: 12, sm: 6, md: 4 }}>
      <TextField select size="small" fullWidth label={label} value={form?.[field] ?? ''} onChange={set(field)}>
        <MenuItem value="">
          <em>None</em>
        </MenuItem>
        {(options ?? []).map((option) => (
          <MenuItem key={option._id} value={option._id}>
            {option.name}
          </MenuItem>
        ))}
      </TextField>
    </Grid>
  );

  return (
    <Box>
      <PageHeader
        title="Offer Letters"
        subtitle="Offers made, and the joining that turns one into an employee"
        breadcrumbs={[{ label: 'Home', to: PATHS.dashboard }, { label: 'Recruitment' }, { label: 'Offers' }]}
        actions={
          <Stack direction="row" spacing={1} data-print="hide">
            <ExportMenu
              columns={columns}
              rows={rows}
              filename="offers"
              totalCount={table.total}
              onError={(message) => setNotice({ severity: 'error', message })}
            />
            {canApprove && (
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => setForm({ ...EMPTY })}>
                New offer
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
          <StatCard label="Offers" value={table.total} icon={MailIcon} loading={loading} />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard label="Awaiting response" value={sent} color="warning" loading={loading} />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard label="Joined" value={joined} icon={HowToRegIcon} color="success" loading={loading} />
        </Grid>
      </Grid>

      <Stack direction="row" spacing={1} sx={{ mb: 2 }} data-print="hide">
        <TextField
          select
          size="small"
          label="Status"
          value={table.filters.status}
          onChange={(event) => table.setFilter('status', event.target.value)}
          sx={{ width: 200 }}
        >
          <MenuItem value="">All statuses</MenuItem>
          {Object.keys(OFFER_STATUS_COLOR).map((status) => (
            <MenuItem key={status} value={status}>
              {humanize(status)}
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      <DataTable
        columns={columns}
        rows={rows}
        loading={loading}
        error={error}
        onRetry={load}
        emptyTitle="No offers yet"
        emptyMessage="An offer is made against a candidate who is still in the running."
        page={table.page}
        limit={table.limit}
        total={table.total}
        onPageChange={table.setPage}
        onLimitChange={table.setLimit}
      />

      <FormDialog
        open={form !== undefined}
        title="New offer"
        subtitle="The placement here is what the employee record inherits at joining"
        submitting={saving}
        submitLabel="Create offer"
        disabled={!form?.candidateId || !Number(form?.annualCtc) || !form?.proposedJoiningDate}
        onSubmit={handleCreate}
        onClose={() => setForm(undefined)}
        maxWidth="md"
      >
        <Grid container spacing={2} sx={{ pt: 0.5 }}>
          <Grid size={12}>
            <TextField
              select
              label="Candidate"
              size="small"
              fullWidth
              required
              value={form?.candidateId ?? ''}
              onChange={set('candidateId')}
              helperText="Only candidates still in the running"
            >
              {candidates.map((candidate) => (
                <MenuItem key={getRowId(candidate)} value={getRowId(candidate)}>
                  {candidate.fullName ?? `${candidate.firstName} ${candidate.lastName}`} — {candidate.jobOpeningId?.title ?? ''}
                </MenuItem>
              ))}
            </TextField>
          </Grid>

          {picker('Designation', 'designationId', masters?.designations)}
          {picker('Department', 'departmentId', masters?.departments)}
          {picker('Unit', 'unitId', masters?.units)}
          {picker('Grade', 'gradeId', masters?.grades)}

          <Grid size={{ xs: 12, sm: 6, md: 4 }}>
            <TextField select label="Employment type" size="small" fullWidth value={form?.employmentType ?? 'FULL_TIME'} onChange={set('employmentType')}>
              {EMPLOYMENT_TYPES.map((type) => (
                <MenuItem key={type} value={type}>
                  {humanize(type)}
                </MenuItem>
              ))}
            </TextField>
          </Grid>

          <Grid size={{ xs: 12, sm: 6, md: 4 }}>
            <TextField
              label="Annual CTC"
              type="number"
              size="small"
              fullWidth
              required
              value={form?.annualCtc ?? ''}
              onChange={set('annualCtc')}
              slotProps={{ input: { startAdornment: <CurrencyAdornment /> } }}
            />
          </Grid>

          <Grid size={{ xs: 6, sm: 3, md: 2 }}>
            <TextField label="Probation (mo)" type="number" size="small" fullWidth value={form?.probationMonths ?? 3} onChange={set('probationMonths')} />
          </Grid>
          <Grid size={{ xs: 6, sm: 3, md: 2 }}>
            <TextField label="Notice (days)" type="number" size="small" fullWidth value={form?.noticePeriodDays ?? 30} onChange={set('noticePeriodDays')} />
          </Grid>

          <Grid size={{ xs: 12, sm: 6, md: 4 }}>
            <TextField
              label="Proposed joining date"
              type="date"
              size="small"
              fullWidth
              required
              value={form?.proposedJoiningDate ?? ''}
              onChange={set('proposedJoiningDate')}
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Grid>

          <Grid size={{ xs: 12, sm: 6, md: 4 }}>
            <TextField
              label="Offer valid until"
              type="date"
              size="small"
              fullWidth
              value={form?.validUntil ?? ''}
              onChange={set('validUntil')}
              helperText="Must be on or before the joining date"
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Grid>

          <Grid size={12}>
            <TextField label="Notes" size="small" fullWidth multiline rows={2} value={form?.notes ?? ''} onChange={set('notes')} />
          </Grid>

          <Grid size={12}>
            <Alert severity="info">
              A probation period on the offer means the employee starts on probation when they join.
            </Alert>
          </Grid>
        </Grid>
      </FormDialog>

      <FormDialog
        open={convert !== undefined}
        title="Record joining"
        subtitle={
          convert?.offer
            ? `${convert.offer.offerNumber} — ${convert.offer.candidateId?.firstName ?? ''} ${convert.offer.candidateId?.lastName ?? ''}`
            : ''
        }
        submitting={saving}
        submitLabel="Create employee"
        submitColor="success"
        onSubmit={runConvert}
        onClose={() => setConvert(undefined)}
      >
        <Alert severity="warning" sx={{ mb: 2 }}>
          <AlertTitle>This creates a real employee record</AlertTitle>
          The placement on the offer — department, designation, unit and grade — is copied onto the new
          employee, a seat is consumed on the requisition, and the candidate is marked hired. It cannot be
          undone from here.
        </Alert>

        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Actual joining date"
              type="date"
              size="small"
              fullWidth
              value={convert?.joiningDate ?? ''}
              onChange={(event) => setConvert((p) => ({ ...p, joiningDate: event.target.value }))}
              helperText="Blank uses the proposed date"
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Grid>

          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Employee code"
              size="small"
              fullWidth
              value={convert?.employeeCode ?? ''}
              onChange={(event) => setConvert((p) => ({ ...p, employeeCode: event.target.value }))}
              helperText="Blank to generate one"
            />
          </Grid>

          <Grid size={12}>
            <TextField
              label="Work email"
              type="email"
              size="small"
              fullWidth
              value={convert?.workEmail ?? ''}
              onChange={(event) => setConvert((p) => ({ ...p, workEmail: event.target.value }))}
              helperText="Optional — can be set later on the employee record"
            />
          </Grid>
        </Grid>
      </FormDialog>

      <ConfirmDialog
        open={Boolean(statusChange)}
        title={`${statusChange?.status ? humanize(statusChange.status) : ''} ${statusChange?.number ?? ''}?`}
        message={
          ['DECLINED', 'WITHDRAWN'].includes(statusChange?.status)
            ? 'The candidate leaves the running and the offer closes. A reason is required.'
            : statusChange?.status === 'ACCEPTED'
              ? 'The offer can then be converted into an employee from this screen.'
              : 'The offer is marked as sent to the candidate.'
        }
        confirmLabel="Confirm"
        confirmColor={['DECLINED', 'WITHDRAWN'].includes(statusChange?.status) ? 'error' : 'primary'}
        requireReason={['DECLINED', 'WITHDRAWN'].includes(statusChange?.status)}
        reasonLabel="Reason"
        onConfirm={applyStatus}
        onClose={() => setStatusChange(null)}
      />
    </Box>
  );
};

export default OffersPage;
