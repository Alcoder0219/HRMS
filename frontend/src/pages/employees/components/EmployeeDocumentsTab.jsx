import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ExpandIcon from '@mui/icons-material/ExpandMoreOutlined';

import FileDropZone from '@components/common/FileDropZone.jsx';
import ConfirmDialog from '@components/feedback/ConfirmDialog.jsx';
import DocumentViewer from '@components/common/DocumentViewer.jsx';
import { releaseImageCache } from '@components/common/AuthenticatedImage.jsx';
import { CardSkeleton } from '@components/common/Skeletons.jsx';
import { ErrorState } from '@components/common/StateBlock.jsx';
import { useToast } from '@contexts/ToastContext.jsx';
import usePermissions from '@hooks/usePermissions.js';
import { RESOURCES, ACTIONS } from '@utils/permissions.js';
import employeeService, { downloadBlob } from '@services/modules/employee.service.js';
import DocumentCard, { MissingDocumentCard } from './DocumentCard.jsx';

/**
 * The Documents tab.
 *
 * The server returns nine sections; this arranges them into the five groups an
 * HR reviewer actually thinks in -- the photo, identity papers, education,
 * experience, everything else -- and renders every file as a card with its own
 * thumbnail.
 *
 * The grouping is presentation only. Sections, folders and document types are
 * unchanged, and the same `GET /:id/attachments` response drives it.
 *
 * Nothing is fetched until this tab is mounted, and each thumbnail waits until
 * its card scrolls into view, so opening the tab does not pull every full-size
 * scan at once.
 */

/** Section types, arranged into the groups the brief describes. */
const GROUPS = [
  { id: 'photo', title: 'Employee Photo', types: ['PHOTO'] },
  {
    id: 'identity',
    title: 'Identity Documents',
    types: ['PAN_COPY', 'AADHAAR_COPY', 'DRIVING_LICENSE_COPY', 'PASSPORT_COPY'],
  },
  { id: 'resume', title: 'Resume', types: ['RESUME'] },
  { id: 'education', title: 'Education Documents', types: ['EDUCATION'] },
  { id: 'experience', title: 'Experience Documents', types: ['EXPERIENCE'] },
  { id: 'other', title: 'Other Documents', types: ['OTHER'] },
];

/** Desktop 4 across, tablet 2, mobile 1. */
const CARD_SPAN = { xs: 12, sm: 6, md: 4, lg: 3 };

const EmployeeDocumentsTab = ({ employeeId }) => {
  const toast = useToast();
  const { can, isSuperAdmin } = usePermissions();

  const canDelete = can(RESOURCES.EMPLOYEE, ACTIONS.DELETE);
  // The stored path is infrastructure detail; useful to an administrator
  // debugging a file, meaningless and slightly leaky to anyone else.
  const canCopyPath = isSuperAdmin || can(RESOURCES.EMPLOYEE, ACTIONS.DELETE);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [viewer, setViewer] = useState({ open: false, index: 0, documents: [] });
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(null);
  const [progress, setProgress] = useState(0);
  const [collapsed, setCollapsed] = useState({});

  // One hidden input drives every "Upload X" placeholder and every Replace, so
  // there is a single file-picking path rather than one per card.
  const pickerRef = useRef(null);
  const pickerTarget = useRef(null);

  const load = useCallback(async () => {
    if (!employeeId) return;

    setLoading(true);
    setError(null);

    try {
      const response = await employeeService.listAttachments(employeeId);
      setData(response.data);
    } catch (rejection) {
      setError(rejection?.message ?? 'Could not load the documents');
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => {
    load();
  }, [load]);

  // Object URLs are held until revoked. Leaving this tab should not keep an
  // employee's scans in memory for the rest of the session.
  useEffect(() => () => releaseImageCache(), []);

  const sectionsByType = useMemo(() => {
    const map = new Map();
    (data?.sections ?? []).forEach((section) => map.set(section.type, section));
    return map;
  }, [data]);

  /** Every document on screen, in display order -- the viewer pages through this. */
  const allDocuments = useMemo(
    () =>
      GROUPS.flatMap((group) =>
        group.types.flatMap((type) => sectionsByType.get(type)?.documents ?? []),
      ),
    [sectionsByType],
  );

  /* ------------------------------------------------------------- actions -- */

  const openViewer = (document) => {
    const index = allDocuments.findIndex((entry) => entry._id === document._id);
    setViewer({ open: true, index: Math.max(0, index), documents: allDocuments });
  };

  const download = async (document) => {
    try {
      const blob = await employeeService.downloadAttachment(employeeId, document._id);
      downloadBlob(blob, document.originalName);
    } catch (rejection) {
      toast.error(rejection?.message ?? 'The download failed');
    }
  };

  const copyPath = async (document) => {
    try {
      await navigator.clipboard.writeText(document.path);
      toast.success('File path copied');
    } catch {
      toast.error('The browser blocked clipboard access');
    }
  };

  const openPicker = (target) => {
    pickerTarget.current = target;
    pickerRef.current?.click();
  };

  const runUpload = async (files) => {
    const target = pickerTarget.current;
    if (!target || !files?.length) return;

    setUploading(target);
    setProgress(0);

    try {
      if (target.mode === 'replace') {
        await employeeService.replaceAttachment(employeeId, target.document._id, target.type, files[0], setProgress);
        toast.success(`${target.document.originalName} replaced`);
      } else {
        await employeeService.uploadAttachments(employeeId, target.type, files, setProgress);
        toast.success(files.length === 1 ? `${files[0].name} uploaded` : `${files.length} files uploaded`);
      }

      // A replaced image keeps its document id in the cache; drop everything so
      // the new bytes are fetched rather than the old thumbnail reused.
      releaseImageCache();
      await load();
    } catch (rejection) {
      toast.error(rejection?.message ?? 'The upload failed');
    } finally {
      setUploading(null);
      pickerTarget.current = null;
    }
  };

  const confirmDelete = async () => {
    setDeleting(true);

    try {
      await employeeService.deleteAttachment(employeeId, pendingDelete._id);
      toast.success(`${pendingDelete.originalName} deleted`);
      setPendingDelete(null);
      releaseImageCache();
      await load();
    } catch (rejection) {
      toast.error(rejection?.message ?? 'The document could not be deleted');
    } finally {
      setDeleting(false);
    }
  };

  /* --------------------------------------------------------------- guard -- */

  if (!employeeId) {
    return (
      <Alert severity="info">
        Save the employee first. Documents are filed under the employee code, which is assigned on creation.
      </Alert>
    );
  }

  if (loading) {
    return (
      <Grid container spacing={2}>
        {Array.from({ length: 8 }, (_, index) => (
          <Grid key={index} size={CARD_SPAN}>
            <CardSkeleton lines={3} height={300} />
          </Grid>
        ))}
      </Grid>
    );
  }

  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <Box>
      <input
        ref={pickerRef}
        type="file"
        hidden
        accept=".jpg,.jpeg,.png,.pdf"
        multiple={pickerTarget.current?.multiple && pickerTarget.current?.mode !== 'replace'}
        onChange={(event) => {
          runUpload(Array.from(event.target.files ?? []));
          event.target.value = '';
        }}
      />

      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
        <Chip size="small" variant="outlined" label={`attachments/${data?.employeeId ?? ''}`} />
        <Chip size="small" color={data?.total ? 'primary' : 'default'} label={`${data?.total ?? 0} document(s)`} />
        <Typography variant="caption" color="text.secondary">
          JPG, PNG up to 2 MB · PDF up to 10 MB
        </Typography>
      </Stack>

      {uploading && (
        <Box sx={{ mb: 2 }}>
          <LinearProgress variant="determinate" value={progress} />
          <Typography variant="caption" color="text.secondary">
            {progress}% uploaded
          </Typography>
        </Box>
      )}

      <Stack spacing={3}>
        {GROUPS.map((group) => {
          const sections = group.types.map((type) => sectionsByType.get(type)).filter(Boolean);
          if (!sections.length) return null;

          const documents = sections.flatMap((section) => section.documents);
          const open = collapsed[group.id] !== true;

          return (
            <Box key={group.id}>
              <Stack
                direction="row"
                spacing={1}
                alignItems="center"
                sx={{ mb: 1, cursor: 'pointer' }}
                onClick={() => setCollapsed((state) => ({ ...state, [group.id]: open }))}
              >
                <Typography variant="subtitle1">{group.title}</Typography>
                <Chip size="small" label={documents.length} variant="outlined" sx={{ height: 20 }} />
                <Box sx={{ flex: 1 }} />
                <IconButton size="small" sx={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }}>
                  <ExpandIcon fontSize="small" />
                </IconButton>
              </Stack>

              <Collapse in={open} unmountOnExit>
                <Grid container spacing={2}>
                  {sections.map((section) => (
                    <Grid key={section.type} size={12} sx={{ p: 0 }}>
                      <Grid container spacing={2}>
                        {section.documents.map((document) => (
                          <Grid key={document._id} size={CARD_SPAN}>
                            <DocumentCard
                              document={document}
                              employeeId={employeeId}
                              canDelete={canDelete}
                              canCopyPath={canCopyPath}
                              onPreview={openViewer}
                              onDownload={download}
                              onReplace={(doc) =>
                                openPicker({ mode: 'replace', type: section.type, document: doc, multiple: false })
                              }
                              onDelete={setPendingDelete}
                              onCopyPath={copyPath}
                            />
                          </Grid>
                        ))}

                        {/* A single-file section with nothing in it gets a named
                            prompt; a multi-file one gets a drop zone that stays
                            available however many files it already holds. */}
                        {!section.multiple && section.documents.length === 0 && (
                          <Grid size={CARD_SPAN}>
                            <MissingDocumentCard
                              label={section.label}
                              disabled={Boolean(uploading)}
                              onClick={() => openPicker({ mode: 'upload', type: section.type, multiple: false })}
                            />
                          </Grid>
                        )}

                        {section.multiple && (
                          <Grid size={CARD_SPAN}>
                            <Box sx={{ height: '100%', display: 'flex', alignItems: 'stretch' }}>
                              <FileDropZone
                                multiple
                                disabled={Boolean(uploading)}
                                label={`Add to ${section.label}`}
                                onFiles={(files) => {
                                  pickerTarget.current = { mode: 'upload', type: section.type, multiple: true };
                                  runUpload(files);
                                }}
                                onReject={(reasons) => reasons.forEach((reason) => toast.error(reason))}
                              />
                            </Box>
                          </Grid>
                        )}
                      </Grid>
                    </Grid>
                  ))}
                </Grid>
              </Collapse>
            </Box>
          );
        })}
      </Stack>

      <DocumentViewer
        open={viewer.open}
        employeeId={employeeId}
        documents={viewer.documents}
        index={viewer.index}
        onIndexChange={(index) => setViewer((state) => ({ ...state, index }))}
        onClose={() => setViewer({ open: false, index: 0, documents: [] })}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={`Delete ${pendingDelete?.originalName ?? 'this document'}?`}
        message="The file is removed from the attachments folder as well as from the record. This cannot be undone."
        confirmLabel="Delete document"
        loading={deleting}
        onConfirm={confirmDelete}
        onClose={() => setPendingDelete(null)}
      />
    </Box>
  );
};

export default EmployeeDocumentsTab;
