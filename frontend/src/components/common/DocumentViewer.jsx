import { useCallback, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/CloseOutlined';
import ZoomInIcon from '@mui/icons-material/ZoomInOutlined';
import ZoomOutIcon from '@mui/icons-material/ZoomOutOutlined';
import RotateIcon from '@mui/icons-material/Rotate90DegreesCwOutlined';
import FullscreenIcon from '@mui/icons-material/FullscreenOutlined';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExitOutlined';
import PrevIcon from '@mui/icons-material/ChevronLeftOutlined';
import NextIcon from '@mui/icons-material/ChevronRightOutlined';
import DownloadIcon from '@mui/icons-material/FileDownloadOutlined';
import PrintIcon from '@mui/icons-material/PrintOutlined';
import ResetIcon from '@mui/icons-material/RestartAltOutlined';

import employeeService, { downloadBlob } from '@services/modules/employee.service.js';
import { cachedObjectUrl } from './AuthenticatedImage.jsx';
import { formatDateTime } from '@utils/format.js';

/**
 * Full-screen viewer for an employee document.
 *
 * One component for both kinds, because everything except the canvas is shared:
 * the same toolbar, the same keyboard shortcuts, the same download and print,
 * the same previous/next across whatever set was opened.
 *
 * Images are drawn by the browser and transformed with CSS, which gives zoom
 * and rotation for free. PDFs are handed to the browser's own viewer, which
 * brings page navigation, its own zoom and text selection with it -- rendering
 * pages by hand would mean adding pdf.js for features the platform already has.
 */

const isImage = (mimeType) => /^image\//.test(mimeType ?? '');

const ZOOM_STEP = 0.25;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 5;

const DocumentViewer = ({ open, employeeId, documents = [], index = 0, onClose, onIndexChange }) => {
  const containerRef = useRef(null);

  const [url, setUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);

  const document_ = documents[index] ?? null;
  const many = documents.length > 1;

  /* ------------------------------------------------------------- loading -- */

  useEffect(() => {
    if (!open || !document_) return undefined;

    // A thumbnail already in the cache is the same bytes: reuse it rather than
    // downloading the file a second time to look at it.
    const cached = cachedObjectUrl(document_._id);
    if (cached) {
      setUrl(cached);
      setError(null);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setUrl(null);

    employeeService
      .downloadAttachment(employeeId, document_._id, 'inline')
      .then((blob) => {
        if (cancelled) return;
        setUrl(URL.createObjectURL(blob));
      })
      .catch((rejection) => {
        if (!cancelled) setError(rejection?.message ?? 'This file could not be opened');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, employeeId, document_]);

  // A new document starts at its natural size and orientation; carrying the
  // previous zoom over makes the next image look broken.
  useEffect(() => {
    setZoom(1);
    setRotation(0);
  }, [index, open]);

  /* ------------------------------------------------------------- actions -- */

  const step = useCallback(
    (delta) => {
      if (!many) return;
      const next = (index + delta + documents.length) % documents.length;
      onIndexChange?.(next);
    },
    [index, documents.length, many, onIndexChange],
  );

  const download = async () => {
    try {
      const blob = await employeeService.downloadAttachment(employeeId, document_._id);
      downloadBlob(blob, document_.originalName);
    } catch {
      setError('The download failed');
    }
  };

  /**
   * Printing opens the file in its own window and calls print there.
   *
   * Printing the dialog itself would print the surrounding page furniture, and
   * a PDF embedded in an object element cannot be reached by the parent's
   * print dialog at all.
   */
  const print = () => {
    if (!url) return;

    const frame = window.open(url, '_blank', 'noopener,noreferrer');
    if (!frame) {
      setError('The browser blocked the print window. Allow pop-ups for this site.');
      return;
    }

    if (isImage(document_.mimeType)) {
      frame.addEventListener('load', () => frame.print(), { once: true });
    }
    // A PDF is opened in the browser's viewer, which carries its own print
    // control; calling print() before it has parsed the file prints a blank.
  };

  const toggleFullscreen = async () => {
    const element = containerRef.current;
    if (!element) return;

    try {
      if (!window.document.fullscreenElement) {
        await element.requestFullscreen();
        setFullscreen(true);
      } else {
        await window.document.exitFullscreen();
        setFullscreen(false);
      }
    } catch {
      // Denied or unsupported -- the dialog is already near full screen.
      setFullscreen(Boolean(window.document.fullscreenElement));
    }
  };

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(window.document.fullscreenElement));
    window.document.addEventListener('fullscreenchange', onChange);
    return () => window.document.removeEventListener('fullscreenchange', onChange);
  }, []);

  /* ----------------------------------------------------------- shortcuts -- */

  useEffect(() => {
    if (!open) return undefined;

    const onKey = (event) => {
      if (event.key === 'ArrowRight') step(1);
      if (event.key === 'ArrowLeft') step(-1);
      if (event.key === '+' || event.key === '=') setZoom((value) => Math.min(MAX_ZOOM, value + ZOOM_STEP));
      if (event.key === '-') setZoom((value) => Math.max(MIN_ZOOM, value - ZOOM_STEP));
      if (event.key.toLowerCase() === 'r') setRotation((value) => (value + 90) % 360);
      if (event.key === '0') {
        setZoom(1);
        setRotation(0);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, step]);

  if (!document_) return null;

  const image = isImage(document_.mimeType);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xl"
      fullWidth
      slotProps={{ paper: { sx: { height: '92vh', bgcolor: 'background.paper' } } }}
    >
      <Box ref={containerRef} sx={{ display: 'flex', flexDirection: 'column', height: '100%', bgcolor: 'background.paper' }}>
        {/* ------------------------------------------------------ toolbar -- */}
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          sx={{ px: 2, py: 1, flexShrink: 0 }}
        >
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="subtitle2" noWrap title={document_.originalName}>
              {document_.originalName}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap>
              {document_.section} · {formatDateTime(document_.uploadedAt)}
              {document_.uploadedByName ? ` · ${document_.uploadedByName}` : ''}
            </Typography>
          </Box>

          {many && <Chip size="small" label={`${index + 1} of ${documents.length}`} variant="outlined" />}

          {image && (
            <>
              <Tooltip title="Zoom out (−)">
                <span>
                  <IconButton size="small" onClick={() => setZoom((v) => Math.max(MIN_ZOOM, v - ZOOM_STEP))} disabled={zoom <= MIN_ZOOM}>
                    <ZoomOutIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>

              <Chip size="small" label={`${Math.round(zoom * 100)}%`} sx={{ minWidth: 58 }} />

              <Tooltip title="Zoom in (+)">
                <span>
                  <IconButton size="small" onClick={() => setZoom((v) => Math.min(MAX_ZOOM, v + ZOOM_STEP))} disabled={zoom >= MAX_ZOOM}>
                    <ZoomInIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>

              <Tooltip title="Rotate (R)">
                <IconButton size="small" onClick={() => setRotation((v) => (v + 90) % 360)}>
                  <RotateIcon fontSize="small" />
                </IconButton>
              </Tooltip>

              <Tooltip title="Reset (0)">
                <IconButton size="small" onClick={() => { setZoom(1); setRotation(0); }}>
                  <ResetIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </>
          )}

          <Divider orientation="vertical" flexItem />

          <Tooltip title="Download">
            <IconButton size="small" onClick={download}>
              <DownloadIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          <Tooltip title="Print">
            <span>
              <IconButton size="small" onClick={print} disabled={!url}>
                <PrintIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>

          <Tooltip title={fullscreen ? 'Exit full screen' : 'Full screen'}>
            <IconButton size="small" onClick={toggleFullscreen}>
              {fullscreen ? <FullscreenExitIcon fontSize="small" /> : <FullscreenIcon fontSize="small" />}
            </IconButton>
          </Tooltip>

          <Tooltip title="Close">
            <IconButton size="small" onClick={onClose}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>

        <Divider />

        {/* ------------------------------------------------------- canvas -- */}
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            position: 'relative',
            overflow: 'auto',
            display: 'grid',
            placeItems: 'center',
            bgcolor: 'action.hover',
          }}
        >
          {loading && <CircularProgress />}

          {error && !loading && (
            <Typography variant="body2" color="error.main" sx={{ p: 3, textAlign: 'center' }}>
              {error}
            </Typography>
          )}

          {url && !loading && image && (
            <Box
              component="img"
              src={url}
              alt={document_.originalName}
              sx={{
                maxWidth: '100%',
                maxHeight: '100%',
                transform: `scale(${zoom}) rotate(${rotation}deg)`,
                transition: 'transform 140ms ease',
                // Beyond 1x the image should overflow into the scroll container
                // rather than shrink to fit, or zoom would do nothing.
                ...(zoom > 1 ? { maxWidth: 'none', maxHeight: 'none' } : null),
              }}
            />
          )}

          {url && !loading && !image && (
            <Box
              component="object"
              data={url}
              type={document_.mimeType}
              sx={{ width: '100%', height: '100%' }}
            >
              <Stack spacing={1} alignItems="center" sx={{ p: 4 }}>
                <Typography variant="body2">This browser cannot display the file inline.</Typography>
                <Typography variant="caption" color="text.secondary">
                  Use Download to open it in another application.
                </Typography>
              </Stack>
            </Box>
          )}

          {/* Previous / next sit over the canvas so they stay reachable at any
              zoom level. */}
          {many && (
            <>
              <IconButton
                onClick={() => step(-1)}
                sx={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', bgcolor: 'background.paper', '&:hover': { bgcolor: 'background.paper' } }}
                aria-label="Previous document"
              >
                <PrevIcon />
              </IconButton>

              <IconButton
                onClick={() => step(1)}
                sx={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', bgcolor: 'background.paper', '&:hover': { bgcolor: 'background.paper' } }}
                aria-label="Next document"
              >
                <NextIcon />
              </IconButton>
            </>
          )}
        </Box>
      </Box>
    </Dialog>
  );
};

export default DocumentViewer;
