import { Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import DashboardPanel from '../components/DashboardPanel.jsx';
import useDashboardQuery from '../useDashboardQuery.js';
import authService from '@services/modules/auth.service.js';
import adminService from '@services/modules/admin.service.js';
import { formatDateTime, formatRelative, humanize } from '@utils/format.js';
import { PATHS } from '@routes/paths.js';

/**
 * What happened lately: the user's own sign-ins, and -- for a user who may
 * read the audit trail -- the latest changes to employee records, which the
 * server already limits to their units.
 */

const TimelineItem = ({ primary, secondary, chip = null }) => (
  <Stack direction="row" spacing={1.25} sx={{ alignItems: 'flex-start' }}>
    <Box sx={{ width: 8, height: 8, mt: 0.9, borderRadius: '50%', bgcolor: 'primary.main', flexShrink: 0 }} />
    <Box sx={{ minWidth: 0, flex: 1 }}>
      <Typography variant="body2" noWrap>
        {primary}
      </Typography>
      <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
        {secondary}
      </Typography>
    </Box>
    {chip}
  </Stack>
);

const RecentActivity = ({ seesAudit, refreshKey }) => {
  const logins = useDashboardQuery(() => authService.loginHistory({ limit: 6 }).then((r) => r.data ?? []), [refreshKey]);
  const updates = useDashboardQuery(
    () => adminService.listAuditLogs({ entity: 'Employee', limit: 6 }).then((r) => r.data ?? []),
    [refreshKey],
    { enabled: seesAudit },
  );

  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, md: seesAudit ? 6 : 12 }}>
        <DashboardPanel
          title="Recent sign-ins"
          subtitle="Your account"
          loading={logins.loading}
          error={logins.error}
          onRetry={logins.reload}
          empty={!logins.data?.length}
          emptyMessage="No sign-in activity recorded for your account."
          minHeight={180}
          action={
            <Link component={RouterLink} to={PATHS.loginHistory} variant="caption">
              View all
            </Link>
          }
        >
          <Stack spacing={1.25}>
            {(logins.data ?? []).map((entry, index) => (
              <TimelineItem
                key={`${entry.occurredAt}-${index}`}
                primary={humanize(entry.event)}
                secondary={`${formatDateTime(entry.occurredAt)} · ${entry.ip ?? 'unknown IP'}`}
                chip={<Chip size="small" variant="outlined" label={humanize(entry.status)} color={entry.status === 'SUCCESS' ? 'success' : 'error'} />}
              />
            ))}
          </Stack>
        </DashboardPanel>
      </Grid>

      {seesAudit && (
        <Grid size={{ xs: 12, md: 6 }}>
          <DashboardPanel
            title="Employee record updates"
            subtitle="Latest changes, from the audit trail"
            loading={updates.loading}
            error={updates.error}
            onRetry={updates.reload}
            empty={!updates.data?.length}
            emptyMessage="No employee changes recorded yet."
            minHeight={180}
            action={
              <Link component={RouterLink} to={PATHS.auditLogs} variant="caption">
                Audit log
              </Link>
            }
          >
            <Stack spacing={1.25}>
              {(updates.data ?? []).map((entry) => (
                <TimelineItem
                  key={entry._id}
                  primary={`${humanize(entry.action)} · ${entry.entityLabel ?? 'Employee'}`}
                  secondary={`${entry.actorEmail ?? 'system'} · ${formatRelative(entry.occurredAt)}${entry.changeCount ? ` · ${entry.changeCount} field(s)` : ''}`}
                />
              ))}
            </Stack>
          </DashboardPanel>
        </Grid>
      )}
    </Grid>
  );
};

export default RecentActivity;
