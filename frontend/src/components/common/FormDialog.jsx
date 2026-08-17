import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';

/**
 * Shell for the create and edit dialogs.
 *
 * Owns the parts that are identical everywhere and easy to get subtly wrong:
 * the error banner sits inside the scrolling body so a long form does not hide
 * its own validation message; the submit button is disabled while in flight so
 * a slow network cannot produce two records; and the dialog goes full screen on
 * a phone, where a centred modal with a form in it is unusable.
 *
 * The caller owns the fields and the state -- this deliberately does not
 * abstract the form itself, because the six forms that use it share no shape.
 */
const FormDialog = ({
  open,
  title,
  subtitle = null,
  error = null,
  submitting = false,
  submitLabel = 'Save',
  submitColor = 'primary',
  disabled = false,
  onSubmit,
  onClose,
  maxWidth = 'sm',
  children,
}) => {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!disabled && !submitting) onSubmit();
  };

  return (
    <Dialog
      open={open}
      // A stray click outside must not discard a half-filled form; the Cancel
      // button is the way out.
      onClose={(_event, reason) => {
        if (reason !== 'backdropClick') onClose();
      }}
      fullWidth
      maxWidth={maxWidth}
      fullScreen={fullScreen}
    >
      {/* A real form element, so Enter submits and browsers offer autofill. */}
      <form onSubmit={handleSubmit} noValidate>
        <DialogTitle sx={{ pb: subtitle ? 0.5 : 2 }}>
          {title}
          {subtitle && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {subtitle}
            </Typography>
          )}
        </DialogTitle>

        <DialogContent dividers>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          {children}
        </DialogContent>

        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={onClose} color="inherit" disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="contained"
            color={submitColor}
            disabled={disabled || submitting}
            startIcon={submitting ? <CircularProgress size={14} color="inherit" /> : null}
          >
            {submitting ? 'Saving…' : submitLabel}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
};

export default FormDialog;
