import { useEffect, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import UploadIcon from '@mui/icons-material/UploadFileOutlined';
import PreviewIcon from '@mui/icons-material/VisibilityOutlined';
import DownloadIcon from '@mui/icons-material/FileDownloadOutlined';
import ReplaceIcon from '@mui/icons-material/SwapHorizOutlined';
import DeleteIcon from '@mui/icons-material/DeleteOutlineOutlined';

import DataTable from '@components/common/DataTable.jsx';
import FormDialog from '@components/common/FormDialog.jsx';
import ConfirmDialog from '@components/feedback/ConfirmDialog.jsx';
import usePermissions from '@hooks/usePermissions.js';
import { RESOURCES, ACTIONS } from '@utils/permissions.js';
import employeeService, { downloadBlob } from '@services/modules/employee.service.js';
import { DOCUMENT_TYPE_OPTIONS } from '@utils/employeeOptions.js';
import { formatDate, formatDateTime, humanize } from '@utils/format.js';
import { employeeIdentifiers } from '@utils/dataGrid.js';

const PREVIEWABLE_IMAGE = /^image\//;
const PREVIEWABLE_PDF = /^application\/pdf$/;

const sizeLabel = (bytes) => {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * Document management for one employee: upload, preview, download, replace and
 * delete, a page at a time.
 *
 * Every file operation goes through the authenticated attachments endpoints.
 * That is the fix for the preview: employee documents are stored OUTSIDE the
 * directory Express serves statically -- deliberately, because a passport scan
 * must not be readable by anyone who learns its URL -- so the stored path is
 * not a URL and never was. Pointing an `<img src>` at it asked the web server
 * for a file it does not serve, and the browser drew a broken image. The bytes
 * are fetched through `GET /employees/:id/attachments/:documentId/file`
 * instead, which carries the session, checks the tenant and streams the file
 * with its own Content-Type; the resulting blob is what the modal renders.
 *
 * The rows are the presented attachment shape from that same API, so what is
 * listed, previewed, downloaded and deleted are all the same record.
 */
const DocumentManager = ({
  employee,
  documents = [],
  loading = false,
  page = null,
  limit = 10,
  total = 0,
  onPageChange = null,
  onLimitChange = null,
  onChanged,
  dense = false,
}) => {
  const { can } = usePermissions();

  const canUpload = can(RESOURCES.EMPLOYEE, ACTIONS.UPDATE);
  const canDelete = can(RESOURCES.EMPLOYEE, ACTIONS.DELETE);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [form, setForm] = useState({ type: 'OTHER', files: [] });
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [notice, setNotice] = useState(null);
  const [preview, setPreview] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [replacing, setReplacing] = useState(null);

  const replaceInput = useRef(null);

  const employeeId = employee?._id ?? employee?.id;

  /* --------------------------------------------------------------- preview -- */

  /**
   * The previewed file, as an object URL.
   *
   * Fetched rather than linked, because the endpoint needs an Authorization
   * header and an `<img>` cannot send one. Revoked when the modal closes: an
   * object URL is held by the document until it is, and browsing a folder of
   * scans would otherwise keep every one of them in memory.
   */
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);

  const previewable =
    PREVIEWABLE_IMAGE.test(preview?.mimeType ?? '') || PREVIEWABLE_PDF.test(preview?.mimeType ?? '');

  useEffect(() => {
    if (!preview || !employeeId || !previewable) return undefined;

    let cancelled = false;
    let objectUrl = null;

    setPreviewLoading(true);
    setPreviewError(null);

    employeeService
      .downloadAttachment(employeeId, preview._id, 'inline')
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setPreviewUrl(objectUrl);
      })
      .catch((rejection) => {
        if (!cancelled) setPreviewError(rejection?.message ?? 'This file could not be opened');
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setPreviewUrl(null);
    };
  }, [preview, employeeId, previewable]);

  /* --------------------------------------------------------------- actions -- */

  const openUpload = () => {
    setForm({ type: 'OTHER', files: [] });
    setUploadOpen(true);
  };

  const handleUpload = async () => {
    setBusy(true);
    setProgress(0);

    try {
      await employeeService.uploadAttachments(employeeId, form.type, form.files, setProgress);
      setNotice({ severity: 'success', message: `${form.files.length} document(s) uploaded` });
      setUploadOpen(false);
      onChanged?.();
    } catch (rejection) {
      setNotice({ severity: 'error', message: rejection?.message ?? 'The upload failed' });
    } finally {
      setBusy(false);
    }
  };

  /**
   * Replace goes through the endpoint built for it.
   *
   * It swaps the file and keeps the document's place in one call, so there is
   * no window in which the employee has neither the old document nor the new
   * one -- which is what an upload-then-delete pair risks if the second call
   * fails.
   */
  const handleReplace = async (file) => {
    const target = replacing;
    setReplacing(null);

    if (!file || !target) return;

    setBusy(true);
    setProgress(0);

    try {
      await employeeService.replaceAttachment(employeeId, target._id, target.documentType, file, setProgress);
      setNotice({ severity: 'success', message: `${target.originalName} replaced` });
      onChanged?.();
    } catch (rejection) {
      setNotice({
        severity: 'error',
        message: rejection?.message ?? 'The replacement failed — the original document is unchanged',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    const target = pendingDelete;
    setPendingDelete(null);
    setBusy(true);

    try {
      await employeeService.deleteAttachment(employeeId, target._id);
      setNotice({ severity: 'success', message: `${target.originalName} deleted` });
      onChanged?.();
    } catch (rejection) {
      setNotice({ severity: 'error', message: rejection?.message ?? 'The document could not be deleted' });
    } finally {
      setBusy(false);
    }
  };

  /** Downloads stream through the same authenticated endpoint the preview uses. */
  const handleDownload = async (row) => {
    setBusy(true);

    try {
      const blob = await employeeService.downloadAttachment(employeeId, row._id);
      downloadBlob(blob, row.originalName);
    } catch (rejection) {
      setNotice({ severity: 'error', message: rejection?.message ?? 'The download failed' });
    } finally {
      setBusy(false);
    }
  };

  /* --------------------------------------------------------------- columns -- */

  const expiring = documents.filter((document) => {
    if (!document.expiresAt) return false;

    const soon = new Date();
    soon.setDate(soon.getDate() + 60);
    return new Date(document.expiresAt) <= soon;
  });

  const columns = [
    {
      key: 'originalName',
      label: 'Document',
      exportValue: (row) => row.originalName,
      render: (row) => (
        <Box>
          <Typography variant="body2">{row.originalName}</Typography>
          <Typography variant="caption" color="text.secondary">
            {row.storedName}
          </Typography>
        </Box>
      ),
    },
    { key: 'documentType', label: 'Type', render: (row) => humanize(row.documentType) },
    { key: 'size', label: 'Size', align: 'right', render: (row) => sizeLabel(row.size) },
    {
      key: 'expiresAt',
      label: 'Expires',
      render: (row) => {
        if (!row.expiresAt) return '—';

        const expired = new Date(row.expiresAt) < new Date();

        return (
          <Chip
            label={formatDate(row.expiresAt)}
            size="small"
            color={expired ? 'error' : 'warning'}
            variant="outlined"
          />
        );
      },
    },
    {
      key: 'isVerified',
      label: 'Verified',
      render: (row) =>
        row.isVerified ? <Chip label="Verified" size="small" color="success" variant="outlined" /> : '—',
    },
    {
      key: 'uploadedAt',
      label: 'Uploaded',
      render: (row) => (
        <Typography variant="caption" color="text.secondary">
          {formatDateTime(row.uploadedAt)}
        </Typography>
      ),
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      width: 160,
      render: (row) => (
        <Stack direction="row" spacing={0.25} justifyContent="flex-end">
          <Tooltip title="Preview">
            <IconButton size="small" onClick={() => setPreview(row)}>
              <PreviewIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          <Tooltip title="Download">
            <IconButton size="small" disabled={busy} onClick={() => handleDownload(row)}>
              <DownloadIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          {canUpload && (
            <Tooltip title="Replace">
              <IconButton
                size="small"
                disabled={busy}
                onClick={() => {
                  setReplacing(row);
                  replaceInput.current?.click();
                }}
              >
                <ReplaceIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}

          {canDelete && (
            <Tooltip title="Delete">
              <IconButton size="small" color="error" disabled={busy} onClick={() => setPendingDelete(row)}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Stack>
      ),
    },
  ];

  return (
    <Box>
      {notice && (
        <Alert severity={notice.severity} sx={{ mb: 2 }} onClose={() => setNotice(null)}>
          {notice.message}
        </Alert>
      )}

      {expiring.length > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {expiring.length} document(s) on this page have expired or expire within 60 days.
        </Alert>
      )}

      {busy && <LinearProgress variant={progress ? 'determinate' : 'indeterminate'} value={progress} sx={{ mb: 1 }} />}

      {canUpload && (
        <Stack direction="row" spacing={1} sx={{ mb: 2 }} data-print="hide">
          <Button variant="contained" size="small" startIcon={<UploadIcon />} onClick={openUpload} disabled={!employeeId}>
            Upload documents
          </Button>
        </Stack>
      )}

      <DataTable
        columns={columns}
        rows={documents}
        loading={loading}
        dense={dense}
        // Server-side: the table reports which page is wanted and the API
        // returns it. Only these rows were ever fetched.
        page={page}
        limit={limit}
        total={total}
        onPageChange={onPageChange}
        onLimitChange={onLimitChange}
        emptyTitle="No documents uploaded"
        emptyMessage={
          canUpload
            ? 'Upload identity proofs, contracts and certificates here.'
            : 'Nothing has been uploaded for this employee.'
        }
        emptyAction={
          canUpload ? (
            <Button size="small" variant="outlined" startIcon={<UploadIcon />} onClick={openUpload}>
              Upload
            </Button>
          ) : null
        }
      />

      {/* Lives outside the table so a re-render cannot detach it mid-selection. */}
      <input
        ref={replaceInput}
        type="file"
        hidden
        onChange={(event) => {
          handleReplace(event.target.files?.[0]);
          // Cleared so choosing the same file twice still fires a change.
          event.target.value = '';
        }}
      />

      <FormDialog
        open={uploadOpen}
        title="Upload documents"
        subtitle={
          employee
            ? `${employeeIdentifiers(employee)} ${employee.firstName ?? ''} ${employee.lastName ?? ''}`.trim()
            : ''
        }
        submitting={busy}
        submitLabel={`Upload ${form.files.length || ''}`.trim()}
        disabled={form.files.length === 0}
        onSubmit={handleUpload}
        onClose={() => setUploadOpen(false)}
      >
        <Grid container spacing={2} sx={{ pt: 0.5 }}>
          <Grid size={12}>
            <TextField
              select
              label="Document type"
              value={form.type}
              onChange={(event) => setForm((previous) => ({ ...previous, type: event.target.value }))}
              fullWidth
              size="small"
              helperText="Applied to every file in this upload"
            >
              {DOCUMENT_TYPE_OPTIONS.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
          </Grid>

          <Grid size={12}>
            <Box
              component="label"
              sx={{
                border: '1px dashed',
                borderColor: 'divider',
                borderRadius: 2,
                p: 3,
                textAlign: 'center',
                cursor: 'pointer',
                display: 'block',
                '&:hover': { borderColor: 'primary.main', bgcolor: 'action.hover' },
              }}
            >
              <input
                type="file"
                hidden
                multiple
                onChange={(event) =>
                  setForm((previous) => ({ ...previous, files: [...(event.target.files ?? [])] }))
                }
              />
              <UploadIcon color="action" />
              <Typography variant="body2" sx={{ mt: 1 }}>
                {form.files.length ? `${form.files.length} file(s) selected` : 'Choose files'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                JPG, PNG or PDF · up to 10 files per upload
              </Typography>
            </Box>
          </Grid>

          {form.files.length > 0 && (
            <Grid size={12}>
              <Stack spacing={0.5}>
                {form.files.map((file) => (
                  <Typography key={file.name} variant="caption" color="text.secondary">
                    {file.name} — {sizeLabel(file.size)}
                  </Typography>
                ))}
              </Stack>
            </Grid>
          )}
        </Grid>
      </FormDialog>

      <Dialog open={Boolean(preview)} onClose={() => setPreview(null)} maxWidth="lg" fullWidth>
        <DialogTitle>{preview?.originalName}</DialogTitle>

        <DialogContent dividers sx={{ minHeight: 420 }}>
          {previewable && previewLoading && (
            <Stack alignItems="center" sx={{ py: 8 }}>
              <CircularProgress />
            </Stack>
          )}

          {previewable && previewError && !previewLoading && (
            <Alert severity="error" sx={{ my: 4 }}>
              {previewError}
            </Alert>
          )}

          {previewUrl && !previewLoading && PREVIEWABLE_IMAGE.test(preview?.mimeType ?? '') && (
            <Box
              component="img"
              src={previewUrl}
              alt={preview.originalName}
              sx={{ width: '100%', height: 'auto', display: 'block' }}
            />
          )}

          {previewUrl && !previewLoading && PREVIEWABLE_PDF.test(preview?.mimeType ?? '') && (
            // An object tag rather than an iframe: the browser falls back to its
            // own message when no PDF viewer is available, instead of a blank box.
            <Box
              component="object"
              data={previewUrl}
              type="application/pdf"
              sx={{ width: '100%', height: 600 }}
            >
              <Typography variant="body2">
                This browser cannot display the PDF inline. Use Download instead.
              </Typography>
            </Box>
          )}

          {/* Anything that is neither an image nor a PDF is not fetched at all:
              rendering a Word file into an <img> only ever produced a broken
              icon, and downloading it to say so would be wasted bytes. */}
          {preview && !previewable && (
            <Stack spacing={2} sx={{ py: 6 }} alignItems="center">
              <Typography variant="body2" color="text.secondary">
                Preview not available for this file type
                {preview.mimeType ? ` (${preview.mimeType})` : ''}.
              </Typography>
              <Button
                variant="outlined"
                startIcon={<DownloadIcon />}
                disabled={busy}
                onClick={() => handleDownload(preview)}
              >
                Download {preview.originalName}
              </Button>
            </Stack>
          )}
        </DialogContent>

        <DialogActions>
          {preview && (
            <Button startIcon={<DownloadIcon />} disabled={busy} onClick={() => handleDownload(preview)}>
              Download
            </Button>
          )}
          <Button onClick={() => setPreview(null)} color="inherit">
            Close
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={`Delete ${pendingDelete?.originalName ?? 'document'}?`}
        message="The file is removed permanently. This cannot be undone."
        confirmLabel="Delete"
        confirmColor="error"
        onConfirm={handleDelete}
        onClose={() => setPendingDelete(null)}
      />
    </Box>
  );
};

export default DocumentManager;
