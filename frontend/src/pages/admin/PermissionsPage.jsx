import { useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import FormControlLabel from '@mui/material/FormControlLabel';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CheckIcon from '@mui/icons-material/CheckOutlined';

import PageHeader from '@components/common/PageHeader.jsx';
import usePermissions from '@hooks/usePermissions.js';
import authService from '@services/modules/auth.service.js';
import { ACTIONS, ACTION_LABELS, RESOURCES, toPermission } from '@utils/permissions.js';
import { ROLE_LABELS } from '@utils/roles.js';
import { humanize } from '@utils/format.js';
import { PATHS } from '@routes/paths.js';

const RESOURCE_LIST = Object.values(RESOURCES);
const ACTION_LIST = Object.values(ACTIONS);

/**
 * The permission matrix: every resource against every action, for every role.
 *
 * This is the same 15 × 9 grid the server derives its answers from, rendered so
 * a question like "can Accounts approve a payroll run" is one glance rather
 * than a support ticket.
 */
const PermissionsPage = () => {
  const { permissions: mine } = usePermissions();

  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [onlyMine, setOnlyMine] = useState(false);

  useEffect(() => {
    authService
      .roleDefinitions()
      .then((response) => setRoles(response.data ?? []))
      .catch((rejection) => setError(rejection?.message ?? 'Could not load the permission matrix'))
      .finally(() => setLoading(false));
  }, []);

  // A Set per role, so a 15 × 9 × 10 render is lookups rather than scans.
  const held = useMemo(
    () => new Map(roles.map((role) => [role.role, new Set(role.permissions)])),
    [roles],
  );

  const columns = onlyMine ? [] : roles;

  return (
    <Box>
      <PageHeader
        title="Permissions"
        subtitle="Every resource and action, against every role"
        breadcrumbs={[{ label: 'Home', to: PATHS.dashboard }, { label: 'Administration' }, { label: 'Permissions' }]}
        actions={
          <FormControlLabel
            control={<Switch checked={onlyMine} onChange={(event) => setOnlyMine(event.target.checked)} />}
            label="Only mine"
          />
        }
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {loading && <Typography variant="body2">Loading matrix…</Typography>}

      <Paper variant="outlined" sx={{ overflowX: 'auto' }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell sx={{ minWidth: 140 }}>Resource</TableCell>
              <TableCell sx={{ minWidth: 130 }}>Action</TableCell>
              {onlyMine ? (
                <TableCell align="center">You</TableCell>
              ) : (
                columns.map((role) => (
                  <TableCell key={role.role} align="center" sx={{ whiteSpace: 'nowrap' }}>
                    <Tooltip title={role.description ?? ''}>
                      <Typography variant="caption" fontWeight={600}>
                        {ROLE_LABELS[role.role] ?? humanize(role.role)}
                      </Typography>
                    </Tooltip>
                  </TableCell>
                ))
              )}
            </TableRow>
          </TableHead>

          <TableBody>
            {RESOURCE_LIST.flatMap((resource) =>
              ACTION_LIST.map((action, actionIndex) => {
                const permission = toPermission(resource, action);

                return (
                  <TableRow key={permission} hover>
                    {/* The resource name is written once and spans its nine
                        action rows, so the grid reads as blocks. */}
                    {actionIndex === 0 && (
                      <TableCell
                        rowSpan={ACTION_LIST.length}
                        sx={{ verticalAlign: 'top', fontWeight: 600, borderRight: 1, borderColor: 'divider' }}
                      >
                        {humanize(resource)}
                      </TableCell>
                    )}

                    <TableCell>
                      <Typography variant="caption">{ACTION_LABELS[action] ?? humanize(action)}</Typography>
                    </TableCell>

                    {onlyMine ? (
                      <TableCell align="center">
                        {mine.has(permission) ? <CheckIcon fontSize="small" color="success" /> : '—'}
                      </TableCell>
                    ) : (
                      columns.map((role) => (
                        <TableCell key={role.role} align="center">
                          {held.get(role.role)?.has(permission) ? (
                            <CheckIcon fontSize="small" color="success" />
                          ) : (
                            <Typography variant="caption" color="text.disabled">
                              —
                            </Typography>
                          )}
                        </TableCell>
                      ))
                    )}
                  </TableRow>
                );
              }),
            )}
          </TableBody>
        </Table>
      </Paper>

      <Stack direction="row" spacing={1} sx={{ mt: 2 }} alignItems="center">
        <Chip label={`${RESOURCE_LIST.length} resources`} size="small" variant="outlined" />
        <Chip label={`${ACTION_LIST.length} actions`} size="small" variant="outlined" />
        <Chip label={`${roles.length} roles`} size="small" variant="outlined" />
        <Typography variant="caption" color="text.secondary">
          A tick here is what the API checks on every request — it is not a display rule.
        </Typography>
      </Stack>
    </Box>
  );
};

export default PermissionsPage;
