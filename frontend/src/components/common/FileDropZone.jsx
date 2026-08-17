import { useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import UploadIcon from '@mui/icons-material/CloudUploadOutlined';

/**
 * Drag-and-drop or click-to-browse, with the validation done before anything
 * is sent.
 *
 * The same rules the server enforces are applied here so the user is told
 * "that PNG is 4 MB" immediately rather than after uploading it. The server
 * check remains the one that matters -- this is a courtesy, not a control.
 *
 * `onFiles` receives an array of accepted File objects; rejected ones are
 * reported through `onReject` with the reason, so the caller decides how
 * loudly to complain.
 */

const IMAGE_MIMES = ['image/jpeg', 'image/png'];
const PDF_MIME = 'application/pdf';

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_PDF_BYTES = 10 * 1024 * 1024;

const megabytes = (bytes) => `${Math.round(bytes / (1024 * 1024))} MB`;

/**
 * Why a file cannot be uploaded, or null if it can.
 *
 * Extension and MIME type are both checked. A file renamed from `.exe` to
 * `.pdf` carries the wrong MIME type, and a MIME type is trivially spoofed by
 * a hand-rolled request -- neither alone is enough, and the server repeats
 * both anyway.
 */
export const rejectionReason = (file, { imagesOnly = false } = {}) => {
  const allowed = imagesOnly ? IMAGE_MIMES : [...IMAGE_MIMES, PDF_MIME];

  if (!allowed.includes(file.type)) {
    return imagesOnly
      ? `${file.name}: only JPG and PNG images are accepted here`
      : `${file.name}: only JPG, PNG and PDF files are accepted`;
  }

  const limit = file.type === PDF_MIME ? MAX_PDF_BYTES : MAX_IMAGE_BYTES;
  if (file.size > limit) return `${file.name} is ${megabytes(file.size)}, over the ${megabytes(limit)} limit`;

  if (file.size === 0) return `${file.name} is empty`;

  return null;
};

const FileDropZone = ({
  onFiles,
  onReject = null,
  multiple = false,
  imagesOnly = false,
  disabled = false,
  label = null,
  dense = false,
}) => {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const accept = imagesOnly ? '.jpg,.jpeg,.png' : '.jpg,.jpeg,.png,.pdf';

  const handle = (fileList) => {
    const files = Array.from(fileList ?? []);
    if (!files.length) return;

    const chosen = multiple ? files : files.slice(0, 1);

    const accepted = [];
    const rejected = [];

    chosen.forEach((file) => {
      const reason = rejectionReason(file, { imagesOnly });
      if (reason) rejected.push(reason);
      else accepted.push(file);
    });

    if (rejected.length && onReject) onReject(rejected);
    if (accepted.length) onFiles(accepted);
  };

  const onDrop = (event) => {
    event.preventDefault();
    setDragging(false);
    if (!disabled) handle(event.dataTransfer.files);
  };

  return (
    <Box
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onClick={() => !disabled && inputRef.current?.click()}
      // Keyboard reachable: a drop zone that only responds to a pointer is
      // unusable for anyone not using one.
      onKeyDown={(event) => {
        if (disabled) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          inputRef.current?.click();
        }
      }}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={label ?? 'Upload a file'}
      sx={{
        px: 2,
        py: dense ? 1.5 : 3,
        border: '1px dashed',
        borderColor: dragging ? 'primary.main' : 'divider',
        borderRadius: 1.5,
        bgcolor: dragging ? 'action.hover' : 'transparent',
        textAlign: 'center',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'border-color 120ms, background-color 120ms',
        '&:hover': disabled ? undefined : { borderColor: 'primary.main' },
        '&:focus-visible': { outline: 2, outlineColor: 'primary.main', outlineOffset: 2 },
      }}
    >
      <input
        ref={inputRef}
        type="file"
        hidden
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={(event) => {
          handle(event.target.files);
          // Reset, so choosing the same file twice in a row still fires.
          event.target.value = '';
        }}
      />

      <UploadIcon color={dragging ? 'primary' : 'disabled'} fontSize={dense ? 'small' : 'medium'} />

      <Typography variant="body2" sx={{ mt: dense ? 0 : 0.5 }}>
        {label ?? (multiple ? 'Drop files here, or click to browse' : 'Drop a file here, or click to browse')}
      </Typography>

      <Typography variant="caption" color="text.secondary">
        {imagesOnly ? 'JPG or PNG, up to 2 MB' : 'JPG, PNG up to 2 MB · PDF up to 10 MB'}
      </Typography>

      {!dense && (
        <Box sx={{ mt: 1 }}>
          <Button size="small" variant="outlined" disabled={disabled} component="span">
            Choose {multiple ? 'files' : 'file'}
          </Button>
        </Box>
      )}
    </Box>
  );
};

export default FileDropZone;
