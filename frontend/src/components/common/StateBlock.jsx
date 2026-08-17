import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import InboxIcon from '@mui/icons-material/InboxOutlined';
import ErrorIcon from '@mui/icons-material/ErrorOutlineOutlined';
import RefreshIcon from '@mui/icons-material/RefreshOutlined';

/**
 * The three states every data screen has between "asked" and "answered".
 *
 * Collected here so they read identically everywhere, and so the distinction
 * that matters is never lost: an empty result and a failed request look the
 * same to a user staring at a blank table, but only one of them is worth
 * retrying. `error` therefore always offers the retry; `empty` never does.
 */

export const LoadingState = ({ message = 'Loading…', minHeight = 200 }) => (
  <Stack spacing={2} alignItems="center" justifyContent="center" sx={{ minHeight, py: 4 }}>
    <CircularProgress size={28} />
    <Typography variant="body2" color="text.secondary">
      {message}
    </Typography>
  </Stack>
);

export const EmptyState = ({
  title = 'Nothing here yet',
  message = null,
  icon: Icon = InboxIcon,
  action = null,
  minHeight = 200,
}) => (
  <Stack spacing={1.5} alignItems="center" justifyContent="center" sx={{ minHeight, py: 4, px: 2 }}>
    <Box
      sx={{
        display: 'grid',
        placeItems: 'center',
        width: 48,
        height: 48,
        borderRadius: 2,
        bgcolor: 'action.hover',
        color: 'text.disabled',
      }}
    >
      <Icon />
    </Box>

    <Typography variant="body1" fontWeight={500}>
      {title}
    </Typography>

    {message && (
      <Typography variant="body2" color="text.secondary" align="center" sx={{ maxWidth: 420 }}>
        {message}
      </Typography>
    )}

    {action}
  </Stack>
);

export const ErrorState = ({ message = 'Something went wrong', onRetry = null, minHeight = 200 }) => (
  <Stack spacing={1.5} alignItems="center" justifyContent="center" sx={{ minHeight, py: 4, px: 2 }}>
    <Box
      sx={{
        display: 'grid',
        placeItems: 'center',
        width: 48,
        height: 48,
        borderRadius: 2,
        bgcolor: 'error.main',
        color: 'error.contrastText',
      }}
    >
      <ErrorIcon />
    </Box>

    <Typography variant="body1" fontWeight={500}>
      Could not load this
    </Typography>

    <Typography variant="body2" color="text.secondary" align="center" sx={{ maxWidth: 420 }}>
      {message}
    </Typography>

    {onRetry && (
      <Button size="small" startIcon={<RefreshIcon />} onClick={onRetry}>
        Try again
      </Button>
    )}
  </Stack>
);

export default { LoadingState, EmptyState, ErrorState };
