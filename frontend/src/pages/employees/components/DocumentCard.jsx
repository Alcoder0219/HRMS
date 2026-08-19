import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import MoreIcon from '@mui/icons-material/MoreVertOutlined';
import PreviewIcon from '@mui/icons-material/VisibilityOutlined';
import DownloadIcon from '@mui/icons-material/FileDownloadOutlined';
import ReplaceIcon from '@mui/icons-material/SwapHorizOutlined';
import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import CopyIcon from '@mui/icons-material/ContentCopyOutlined';
import PdfIcon from '@mui/icons-material/PictureAsPdfOutlined';
import AddIcon from '@mui/icons-material/AddOutlined';

import AuthenticatedImage from '@components/common/AuthenticatedImage.jsx';
import { formatDateTime, humanize } from '@utils/format.js';

/**
 * One document, as a card.
 *
 * The thumbnail is the affordance: a wall of filenames tells you nothing, and
 * the single most common question about a scanned document is "is this the
 * right one", which a 180px preview answers instantly.
 *
 * Images render their own bytes through the authenticated endpoint, lazily.
 * PDFs get a typographic tile instead of a rendered first page -- see the note
 * on `PdfTile` below.
 */

const THUMB_HEIGHT = 180;

const isImage = (mimeType) => /^image\/(jpeg|png|webp)$/.test(mimeType ?? '');

export const readableSize = (bytes) => {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * A PDF's tile.
 *
 * Not a rendered first page. Rasterising one in the browser needs pdf.js, and
 * embedding nine `<object>` viewers to act as thumbnails costs far more than
 * the recognition it buys -- each one spins up the browser's full PDF stack.
 * The filename and extension identify the file; the viewer, one click away,
 * shows the real pages.
 */
const PdfTile = ({ name }) => (
  <Box
    sx={{
      height: THUMB_HEIGHT,
      borderRadius: 1,
      bgcolor: 'action.hover',
      display: 'grid',
      placeItems: 'center',
      gap: 0.5,
      px: 2,
    }}
  >
    <PdfIcon sx={{ fontSize: 46, color: 'error.main', opacity: 0.85 }} />
    <Typography variant="caption" color="text.secondary" noWrap sx={{ maxWidth: '100%' }} title={name}>
      {name}
    </Typography>
  </Box>
);

const DocumentCard = ({
  document,
  employeeId,
  canDelete = false,
  canCopyPath = false,
  onPreview,
  onDownload,
  onReplace,
  onDelete,
  onCopyPath,
}) => {
  const [menu, setMenu] = useState(null);
  const image = isImage(document.mimeType);

  return (
    <Card variant="outlined" sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box
        onClick={() => onPreview(document)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onPreview(document);
          }
        }}
        role="button"
        tabIndex={0}
        aria-label={`Preview ${document.originalName}`}
        sx={{
          p: 1,
          cursor: 'pointer',
          '&:focus-visible': { outline: 2, outlineColor: 'primary.main', outlineOffset: -2 },
          '&:hover .doc-thumb': { opacity: 0.85 },
        }}
      >
        <Box className="doc-thumb" sx={{ transition: 'opacity 120ms' }}>
          {image ? (
            <AuthenticatedImage
              employeeId={employeeId}
              documentId={document._id}
              alt={document.originalName}
              height={THUMB_HEIGHT}
            />
          ) : (
            <PdfTile name={document.storedName} />
          )}
        </Box>
      </Box>

      <CardContent sx={{ pt: 0.5, pb: 1, flex: 1, minWidth: 0 }}>
        <Chip
          size="small"
          label={humanize(document.documentType)}
          variant="outlined"
          sx={{ height: 20, fontSize: 10, mb: 0.5 }}
        />

        <Typography variant="body2" noWrap title={document.originalName}>
          {document.originalName}
        </Typography>

        <Typography variant="caption" color="text.secondary" display="block">
          {readableSize(document.size)} · {formatDateTime(document.uploadedAt)}
        </Typography>

        <Typography variant="caption" color="text.secondary" display="block" noWrap>
          {document.uploadedByName ? `Uploaded by ${document.uploadedByName}` : 'Uploader not recorded'}
        </Typography>
      </CardContent>

      <Divider />

      <Stack direction="row" spacing={0.5} sx={{ px: 0.5, py: 0.25 }} alignItems="center">
        <Tooltip title="Preview">
          <IconButton size="small" onClick={() => onPreview(document)}>
            <PreviewIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        <Tooltip title="Download">
          <IconButton size="small" onClick={() => onDownload(document)}>
            <DownloadIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        <Tooltip title="Replace">
          <IconButton size="small" onClick={() => onReplace(document)}>
            <ReplaceIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        <Box sx={{ flex: 1 }} />

        <IconButton size="small" onClick={(event) => setMenu(event.currentTarget)} aria-label="More actions">
          <MoreIcon fontSize="small" />
        </IconButton>
      </Stack>

      <Menu anchorEl={menu} open={Boolean(menu)} onClose={() => setMenu(null)}>
        {canCopyPath && (
          <MenuItem
            onClick={() => {
              onCopyPath(document);
              setMenu(null);
            }}
          >
            <ListItemIcon>
              <CopyIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary="Copy file path" secondary={document.path} slotProps={{ secondary: { sx: { fontSize: 10 } } }} />
          </MenuItem>
        )}

        <MenuItem
          disabled={!canDelete}
          onClick={() => {
            onDelete(document);
            setMenu(null);
          }}
        >
          <ListItemIcon>
            <DeleteIcon fontSize="small" color={canDelete ? 'error' : 'disabled'} />
          </ListItemIcon>
          <ListItemText
            primary="Delete"
            secondary={canDelete ? 'Removes the file from disk too' : 'Only HR and administrators'}
            slotProps={{ secondary: { sx: { fontSize: 10 } } }}
          />
        </MenuItem>
      </Menu>
    </Card>
  );
};

/**
 * The placeholder shown where a required document has not been uploaded.
 *
 * A named prompt -- "Upload National ID (NIDA)" -- rather than an empty row, so the gap
 * itself tells the reader what is missing and is the control that fixes it.
 */
export const MissingDocumentCard = ({ label, onClick, disabled = false }) => (
  <Card
    variant="outlined"
    onClick={disabled ? undefined : onClick}
    onKeyDown={(event) => {
      if (disabled) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onClick();
      }
    }}
    role="button"
    tabIndex={disabled ? -1 : 0}
    aria-label={`Upload ${label}`}
    sx={{
      height: '100%',
      minHeight: THUMB_HEIGHT + 96,
      display: 'grid',
      placeItems: 'center',
      gap: 1,
      p: 2,
      borderStyle: 'dashed',
      cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.6 : 1,
      transition: 'border-color 120ms, background-color 120ms',
      '&:hover': disabled ? undefined : { borderColor: 'primary.main', bgcolor: 'action.hover' },
      '&:focus-visible': { outline: 2, outlineColor: 'primary.main', outlineOffset: -2 },
    }}
  >
    <Box sx={{ display: 'grid', placeItems: 'center', gap: 0.5, textAlign: 'center' }}>
      <AddIcon color={disabled ? 'disabled' : 'primary'} />
      <Typography variant="body2" fontWeight={500}>
        Upload {label}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        Not uploaded yet
      </Typography>
    </Box>
  </Card>
);

export default DocumentCard;
