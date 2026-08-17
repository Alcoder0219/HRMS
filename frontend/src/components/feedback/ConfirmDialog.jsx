import { useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import TextField from '@mui/material/TextField';

/**
 * Confirmation for a destructive action, with an optional reason field.
 *
 * The reason is not ceremony: a soft delete writes it to the audit trail, and
 * "why was this record removed" is the first question asked six months later.
 */
const ConfirmDialog = ({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  confirmColor = 'error',
  requireReason = false,
  reasonLabel = 'Reason',
  loading = false,
  /**
   * An extra control shown under the message -- a checkbox for a second,
   * separately-confirmed consequence. Optional, so the nineteen existing
   * callers are unaffected.
   */
  extra = null,
  onConfirm,
  onClose,
}) => {
  const [reason, setReason] = useState('');

  const handleConfirm = () => {
    onConfirm(reason.trim() || null);
    setReason('');
  };

  const handleClose = () => {
    setReason('');
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>

      <DialogContent>
        <DialogContentText variant="body2">{message}</DialogContentText>

        {extra}

        {requireReason && (
          <TextField
            autoFocus
            fullWidth
            margin="dense"
            label={reasonLabel}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            multiline
            minRows={2}
            sx={{ mt: 2 }}
          />
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleClose} color="inherit" disabled={loading}>
          Cancel
        </Button>
        <Button
          onClick={handleConfirm}
          color={confirmColor}
          variant="contained"
          disabled={loading}
          // The spinner sits in the button rather than over the dialog, so the
          // message stays readable while the action runs.
          startIcon={loading ? <CircularProgress size={14} color="inherit" /> : null}
        >
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ConfirmDialog;
