import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Divider from '@mui/material/Divider';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import RefreshIcon from '@mui/icons-material/RefreshOutlined';

/**
 * One dashboard widget, with the four states it can be in.
 *
 * Every panel on this page reads a different endpoint, and one refused or
 * failing request must not take the page with it -- so the state lives per
 * panel rather than per page: this one shows "Unable to load" and a Try again,
 * and the eleven around it carry on.
 *
 * `empty` is deliberately distinct from `error`. A month with no payroll run
 * is not a failure and there is nothing to retry; saying so plainly is more
 * useful than a spinner that never resolves or a chart of zeros that looks
 * like real data.
 */
const DashboardPanel = ({
  title,
  subtitle = null,
  action = null,
  loading = false,
  error = null,
  onRetry = null,
  empty = false,
  emptyMessage = 'No data available for this period.',
  minHeight = 220,
  children,
}) => (
  <Card variant="outlined" sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
    <CardContent sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      {/* Layout via `sx`: MUI no longer takes `justifyContent`/`alignItems` as
          system props on Stack in this version and forwards them to the DOM. */}
      <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle1" fontWeight={600} noWrap>
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="caption" color="text.secondary">
              {subtitle}
            </Typography>
          )}
        </Box>
        {action}
      </Stack>

      <Divider sx={{ my: 1.5 }} />

      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        {loading && (
          // Shaped like the content it precedes, so nothing jumps when the
          // request lands.
          <Stack spacing={1} sx={{ minHeight, justifyContent: 'center' }}>
            <Skeleton variant="rounded" height={minHeight * 0.62} />
            <Skeleton variant="text" width="60%" />
            <Skeleton variant="text" width="40%" />
          </Stack>
        )}

        {!loading && error && (
          <Stack
            spacing={1}
            sx={{ minHeight, textAlign: 'center', alignItems: 'center', justifyContent: 'center' }}
          >
            <Typography variant="body2" fontWeight={500}>
              Unable to load data
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ maxWidth: 320 }}>
              {typeof error === 'string' ? error : (error.message ?? 'The request failed.')}
            </Typography>
            {onRetry && (
              <Button size="small" startIcon={<RefreshIcon />} onClick={onRetry}>
                Try again
              </Button>
            )}
          </Stack>
        )}

        {!loading && !error && empty && (
          <Stack sx={{ minHeight, px: 2, alignItems: 'center', justifyContent: 'center' }}>
            <Typography variant="body2" color="text.secondary" align="center">
              {emptyMessage}
            </Typography>
          </Stack>
        )}

        {!loading && !error && !empty && children}
      </Box>
    </CardContent>
  </Card>
);

export default DashboardPanel;
