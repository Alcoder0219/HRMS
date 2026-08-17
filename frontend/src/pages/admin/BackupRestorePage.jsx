import { useEffect, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import DownloadIcon from '@mui/icons-material/CloudDownloadOutlined';
import UploadIcon from '@mui/icons-material/UploadFileOutlined';
import PreviewIcon from '@mui/icons-material/VisibilityOutlined';
import RestoreIcon from '@mui/icons-material/SettingsBackupRestoreOutlined';

import PageHeader from '@components/common/PageHeader.jsx';
import DataTable from '@components/common/DataTable.jsx';
import { FormSelect, FormTextField } from '@components/form/FormFields.jsx';
import { CardSkeleton } from '@components/common/Skeletons.jsx';
import adminService from '@services/modules/admin.service.js';
import { useToast } from '@contexts/ToastContext.jsx';
import { downloadBlob } from '@utils/exporters.js';
import { formatDateTime, formatNumber } from '@utils/format.js';
import { PATHS } from '@routes/paths.js';

const CONFIRMATION = 'RESTORE';

const MODES = [
  {
    value: 'MERGE',
    label: 'Merge — add what is missing',
    description: 'Records already in the database are left exactly as they are. Nothing is deleted or overwritten.',
    severity: 'info',
  },
  {
    value: 'OVERWRITE',
    label: 'Overwrite — add and replace',
    description: 'Records in the archive replace the versions currently stored. Records not in the archive are kept.',
    severity: 'warning',
  },
  {
    value: 'REPLACE',
    label: 'Replace — make it match the archive',
    description:
      'Every affected collection is emptied first. Anything created since this backup was taken is permanently lost.',
    severity: 'error',
  },
];

/**
 * Backup and restore.
 *
 * The screen is deliberately awkward about restoring: a preview must be run
 * before the apply button appears at all, and applying needs the confirmation
 * phrase typed by hand. Both are enforced on the server too -- this is the
 * part that makes the risk visible, not the part that prevents it.
 */
const BackupRestorePage = () => {
  const fileInput = useRef(null);
  const toast = useToast();

  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const [file, setFile] = useState(null);
  const [mode, setMode] = useState('MERGE');
  const [confirm, setConfirm] = useState('');
  const [plan, setPlan] = useState(null);

  const load = () => {
    setLoading(true);

    adminService
      .backupPreview()
      .then((response) => setPreview(response.data))
      .catch((rejection) => setError(rejection?.message ?? 'Could not read the backup contents'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleDownload = async () => {
    setBusy(true);
    setError(null);

    try {
      const blob = await adminService.downloadBackup();
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      downloadBlob(blob, `hrms-backup-${stamp}.json`);
      toast.success('Backup downloaded. Keep it somewhere safe — it contains employee and payroll data.');
      load();
    } catch (rejection) {
      setError(rejection?.message ?? 'The backup failed');
    } finally {
      setBusy(false);
    }
  };

  const chooseFile = (event) => {
    setFile(event.target.files?.[0] ?? null);
    // A plan describes one file; keeping it after the file changes would let
    // someone apply a restore they never previewed.
    setPlan(null);
    setConfirm('');
  };

  const runPreview = async () => {
    setBusy(true);
    setError(null);
    setPlan(null);

    try {
      const response = await adminService.restore(file, { mode, dryRun: true });
      setPlan(response.data);
    } catch (rejection) {
      setError(rejection?.message ?? 'The archive could not be read');
    } finally {
      setBusy(false);
    }
  };

  const applyRestore = async () => {
    setBusy(true);
    setError(null);

    try {
      const response = await adminService.restore(file, { mode, dryRun: false, confirm });
      setPlan(response.data);
      toast.success(
        `Restore applied: ${response.data.totals.inserted} inserted, ${response.data.totals.updated} replaced, ${response.data.totals.removed} removed.`,
      );
      setConfirm('');
      load();
    } catch (rejection) {
      setError(rejection?.message ?? 'The restore failed');
    } finally {
      setBusy(false);
    }
  };

  const selectedMode = MODES.find((entry) => entry.value === mode);
  const canApply = plan?.dryRun && confirm === CONFIRMATION;

  return (
    <Box>
      <PageHeader
        title="Backup & Restore"
        subtitle="Take a copy of your data, or put one back"
        breadcrumbs={[{ label: 'Home', to: PATHS.dashboard }, { label: 'Administration' }, { label: 'Backup' }]}
      />

      {busy && <LinearProgress sx={{ mb: 2 }} />}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {loading && (
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 6 }}>
            <CardSkeleton lines={6} />
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <CardSkeleton lines={6} />
          </Grid>
        </Grid>
      )}

      {!loading && (
        <Grid container spacing={2}>
          {/* ---------------------------------------------------- backup -- */}
          <Grid size={{ xs: 12, md: 6 }}>
            <Card variant="outlined" sx={{ height: '100%' }}>
              <CardContent>
                <Typography variant="subtitle1" gutterBottom>
                  Backup
                </Typography>

                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  A single JSON file containing {formatNumber(preview?.documents ?? 0)} record(s) across{' '}
                  {preview?.collections?.length ?? 0} collection(s).
                </Typography>

                <Alert severity="info" sx={{ mb: 2 }}>
                  <AlertTitle>What is not included</AlertTitle>
                  Login accounts, passwords and sessions, and the audit and sign-in logs. Restoring accounts would
                  revive deleted logins and old passwords; a log that can be replaced from a file is not a log.
                </Alert>

                <Button
                  variant="contained"
                  startIcon={<DownloadIcon />}
                  onClick={handleDownload}
                  disabled={busy}
                  sx={{ mb: 2 }}
                >
                  Download backup
                </Button>

                {preview?.lastBackupAt && (
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
                    Last taken {formatDateTime(preview.lastBackupAt)}
                  </Typography>
                )}

                <Divider sx={{ mb: 2 }} />

                <DataTable
                  columns={[
                    { key: 'name', label: 'Collection' },
                    { key: 'count', label: 'Records', align: 'right', render: (row) => formatNumber(row.count) },
                  ]}
                  rows={preview?.collections ?? []}
                  getKey={(row) => row.name}
                  emptyTitle="Nothing to back up yet"
                />
              </CardContent>
            </Card>
          </Grid>

          {/* --------------------------------------------------- restore -- */}
          <Grid size={{ xs: 12, md: 6 }}>
            <Card variant="outlined" sx={{ height: '100%' }}>
              <CardContent>
                <Typography variant="subtitle1" gutterBottom>
                  Restore
                </Typography>

                <Stack spacing={2}>
                  <Box>
                    <input
                      ref={fileInput}
                      type="file"
                      accept="application/json,.json"
                      onChange={chooseFile}
                      style={{ display: 'none' }}
                    />
                    <Button variant="outlined" startIcon={<UploadIcon />} onClick={() => fileInput.current?.click()}>
                      Choose archive
                    </Button>
                    {file && (
                      <Chip
                        sx={{ ml: 1 }}
                        size="small"
                        label={`${file.name} (${Math.round(file.size / 1024)} KB)`}
                        onDelete={() => {
                          setFile(null);
                          setPlan(null);
                        }}
                      />
                    )}
                  </Box>

                  <FormSelect
                    label="Mode"
                    value={mode}
                    onChange={(value) => {
                      setMode(value);
                      setPlan(null);
                      setConfirm('');
                    }}
                    options={MODES}
                    emptyLabel={null}
                  />

                  <Alert severity={selectedMode.severity}>{selectedMode.description}</Alert>

                  <Button variant="outlined" startIcon={<PreviewIcon />} onClick={runPreview} disabled={!file || busy}>
                    Preview this restore
                  </Button>

                  {plan && (
                    <>
                      <Divider />

                      <Box>
                        <Typography variant="subtitle2" gutterBottom>
                          {plan.dryRun ? 'What this would do' : 'What it did'}
                        </Typography>

                        <Stack direction="row" spacing={1} sx={{ mb: 1 }} flexWrap="wrap" useFlexGap>
                          <Chip size="small" color="success" label={`${plan.totals.inserted} inserted`} />
                          <Chip size="small" color="info" label={`${plan.totals.updated} replaced`} />
                          <Chip
                            size="small"
                            color={plan.totals.removed ? 'error' : 'default'}
                            label={`${plan.totals.removed} removed`}
                          />
                          <Chip size="small" variant="outlined" label={`${plan.totals.skipped} left alone`} />
                        </Stack>

                        <Typography variant="caption" color="text.secondary" display="block">
                          Archive taken {plan.archive.createdAt ? formatDateTime(plan.archive.createdAt) : 'unknown'}
                          {plan.archive.createdBy ? ` by ${plan.archive.createdBy}` : ''}
                        </Typography>

                        <Box sx={{ mt: 1 }}>
                          <DataTable
                            columns={[
                              { key: 'collection', label: 'Collection' },
                              { key: 'inArchive', label: 'In file', align: 'right' },
                              { key: 'currentlyPresent', label: 'Now', align: 'right' },
                              { key: 'toInsert', label: 'Insert', align: 'right' },
                              { key: 'toUpdate', label: 'Replace', align: 'right' },
                              {
                                key: 'toRemove',
                                label: 'Remove',
                                align: 'right',
                                render: (row) =>
                                  row.toRemove > 0 ? (
                                    <Typography variant="body2" color="error.main">
                                      {row.toRemove}
                                    </Typography>
                                  ) : (
                                    '—'
                                  ),
                              },
                            ]}
                            rows={plan.report ?? []}
                            getKey={(row) => row.collection}
                            emptyTitle="The archive is empty"
                          />
                        </Box>
                      </Box>

                      {plan.dryRun && (
                        <>
                          <Alert severity={mode === 'REPLACE' ? 'error' : 'warning'}>
                            <AlertTitle>This cannot be undone</AlertTitle>
                            {mode === 'REPLACE'
                              ? `${plan.totals.removed} record(s) will be deleted permanently. Take a backup first if you have not already.`
                              : 'Take a backup first if you have not already.'}
                          </Alert>

                          <FormTextField
                            label={`Type ${CONFIRMATION} to confirm`}
                            value={confirm}
                            onChange={setConfirm}
                          />

                          <Button
                            variant="contained"
                            color="error"
                            startIcon={<RestoreIcon />}
                            onClick={applyRestore}
                            disabled={!canApply || busy}
                          >
                            Apply restore
                          </Button>
                        </>
                      )}
                    </>
                  )}
                </Stack>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}
    </Box>
  );
};

export default BackupRestorePage;
