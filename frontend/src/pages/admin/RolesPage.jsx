import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import PageHeader from '@components/common/PageHeader.jsx';
import adminService from '@services/modules/admin.service.js';
import { ACTION_LABELS } from '@utils/permissions.js';
import { SCOPE_LABELS } from '@utils/roles.js';
import { humanize } from '@utils/format.js';
import { PATHS } from '@routes/paths.js';

const SCOPE_COLOR = {
  SELF: 'default',
  TEAM: 'info',
  DEPARTMENT: 'info',
  TENANT: 'warning',
  GLOBAL: 'error',
};

/**
 * The role catalogue: an overview card per role, read from GET /administration/roles.
 *
 * This screen itself stays read-only -- it is a summary, not a form -- but the
 * roles it lists are no longer fixed in code. Edit permissions or manage
 * custom roles from Administration > Permissions.
 */
const RolesPage = () => {
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    adminService
      .listRoles()
      .then((response) => setRoles(response.data ?? []))
      .catch((rejection) => setError(rejection?.message ?? 'Could not load the roles'))
      .finally(() => setLoading(false));
  }, []);

  /** Groups a flat `resource:action` list back into one row per resource. */
  const byResource = (permissions) => {
    const grouped = new Map();

    permissions.forEach((permission) => {
      const [resource, action] = permission.split(':');
      if (!grouped.has(resource)) grouped.set(resource, []);
      grouped.get(resource).push(action);
    });

    return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));
  };

  return (
    <Box>
      <PageHeader
        title="Roles"
        subtitle="What each role can reach, and how far its data scope extends"
        breadcrumbs={[{ label: 'Home', to: PATHS.dashboard }, { label: 'Administration' }, { label: 'Roles' }]}
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {loading && <Typography variant="body2">Loading roles…</Typography>}

      <Grid container spacing={2}>
        {roles.map((role) => (
          <Grid key={role.id ?? role.role} size={{ xs: 12, md: 6 }}>
            <Card variant="outlined" sx={{ height: '100%' }}>
              <CardContent>
                <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography variant="h6">{role.label ?? humanize(role.role)}</Typography>
                    {!role.isSystem && <Chip label="Custom" size="small" variant="outlined" />}
                  </Stack>
                  <Stack direction="row" spacing={0.5}>
                    <Chip
                      label={SCOPE_LABELS[role.scope] ?? role.scope}
                      size="small"
                      color={SCOPE_COLOR[role.scope] ?? 'default'}
                    />
                    {role.crossTenant && <Chip label="Cross-tenant" size="small" color="error" variant="outlined" />}
                  </Stack>
                </Stack>

                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  {role.description}
                </Typography>

                <Divider sx={{ my: 2 }} />

                <Typography variant="caption" color="text.secondary">
                  {role.permissions.length} permission(s)
                </Typography>

                <Box sx={{ mt: 1, maxHeight: 260, overflowY: 'auto' }}>
                  {byResource(role.permissions).map(([resource, actions]) => (
                    <Stack key={resource} direction="row" spacing={1} sx={{ py: 0.5 }} alignItems="flex-start">
                      <Typography variant="caption" sx={{ minWidth: 96, fontWeight: 600 }}>
                        {humanize(resource)}
                      </Typography>
                      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                        {actions.map((action) => (
                          <Chip
                            key={action}
                            label={ACTION_LABELS[action] ?? humanize(action)}
                            size="small"
                            variant="outlined"
                            sx={{ height: 20, fontSize: 11 }}
                          />
                        ))}
                      </Stack>
                    </Stack>
                  ))}
                </Box>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
};

export default RolesPage;
