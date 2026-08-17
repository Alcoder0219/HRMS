import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import BackIcon from '@mui/icons-material/ArrowBackOutlined';
import EditIcon from '@mui/icons-material/EditOutlined';
import DeleteIcon from '@mui/icons-material/DeleteOutlineOutlined';

import PageHeader from '@components/common/PageHeader.jsx';
import AuditTrail from '@components/common/AuditTrail.jsx';
import ConfirmDialog from '@components/feedback/ConfirmDialog.jsx';
import { LoadingState, ErrorState } from '@components/common/StateBlock.jsx';
import MasterFormDialog from './components/MasterFormDialog.jsx';
import usePermissions from '@hooks/usePermissions.js';
import { RESOURCES, ACTIONS } from '@utils/permissions.js';
import organizationService from '@services/modules/organization.service.js';
import { ORGANIZATION_MASTERS, WEEK_DAYS } from '@config/organizationMasters.js';
import { formatCurrency, formatDateTime, emptyDash } from '@utils/format.js';
import { getRowId } from '@utils/dataGrid.js';
import { PATHS } from '@routes/paths.js';

/**
 * One organization master record: its fields, what depends on it, and its
 * audit trail.
 *
 * The usage panel is the reason this page is worth opening. "Can I delete this
 * department" is not answerable from a list, and finding out by attempting the
 * delete and reading a 409 is a poor way to ask.
 */
const MasterDetailPage = ({ master }) => {
  const config = ORGANIZATION_MASTERS[master];
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = usePermissions();

  const canUpdate = can(RESOURCES.ORGANIZATION, ACTIONS.UPDATE);
  const canDelete = can(RESOURCES.ORGANIZATION, ACTIONS.DELETE);

  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [tab, setTab] = useState(0);
  const [audit, setAudit] = useState([]);
  const [auditMeta, setAuditMeta] = useState({ page: 1, limit: 20, total: 0 });
  const [auditLoading, setAuditLoading] = useState(false);

  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [parents, setParents] = useState([]);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);

    organizationService
      .getMaster(master, id)
      .then((response) => setRecord(response.data))
      .catch((rejection) => setError(rejection?.message ?? `Could not load this ${config.label.toLowerCase()}`))
      .finally(() => setLoading(false));
  }, [master, id, config]);

  useEffect(() => {
    load();
  }, [load]);

  // Fetched only when the tab is opened -- most visits never look at it.
  useEffect(() => {
    if (tab !== 1) return;

    setAuditLoading(true);

    organizationService
      .masterAudit(master, id, { page: auditMeta.page, limit: auditMeta.limit })
      .then((response) => {
        setAudit(response.data ?? []);
        setAuditMeta((previous) => ({ ...previous, total: response.meta?.total ?? 0 }));
      })
      .catch(() => setAudit([]))
      .finally(() => setAuditLoading(false));
  }, [tab, master, id, auditMeta.page, auditMeta.limit]);

  useEffect(() => {
    if (!['departments', 'designations'].includes(master)) return;

    organizationService
      .departments()
      .then((response) => setParents(response.data ?? []))
      .catch(() => setParents([]));
  }, [master]);

  const toggleStatus = async () => {
    try {
      const response = await organizationService.setMasterStatus(master, id, !record.isActive);
      setRecord((previous) => ({ ...previous, ...response.data }));
      setNotice({ severity: 'success', message: record.isActive ? 'Deactivated' : 'Activated' });
    } catch (rejection) {
      setNotice({ severity: 'error', message: rejection?.message ?? 'The status could not be changed' });
    }
  };

  const handleDelete = async () => {
    setConfirmDelete(false);

    try {
      await organizationService.deleteMaster(master, id);
      navigate(config.path, { replace: true });
    } catch (rejection) {
      setNotice({ severity: 'warning', message: rejection?.message ?? 'Could not delete' });
    }
  };

  /** Renders a field using the same descriptor the form is generated from. */
  const displayValue = (field) => {
    const value = record[field.key];

    if (field.type === 'switch') return value ? 'Yes' : 'No';
    if (field.type === 'money') return formatCurrency(value);
    if (field.type === 'select') return emptyDash(value?.name);
    if (field.type === 'days') {
      return value?.length ? value.map((day) => WEEK_DAYS[day]?.label).join(', ') : '—';
    }

    return emptyDash(value);
  };

  if (loading) return <LoadingState message="Loading…" minHeight={320} />;

  if (error) {
    return (
      <Box>
        <PageHeader
          title={config.label}
          breadcrumbs={[
            { label: 'Home', to: PATHS.dashboard },
            { label: 'Organization' },
            { label: config.plural, to: config.path },
          ]}
        />
        <ErrorState message={error} onRetry={load} />
      </Box>
    );
  }

  const usage = record.usage ?? { total: 0, breakdown: [] };

  return (
    <Box>
      <PageHeader
        title={record.name}
        subtitle={`${config.label} · ${record.code}`}
        breadcrumbs={[
          { label: 'Home', to: PATHS.dashboard },
          { label: 'Organization' },
          { label: config.plural, to: config.path },
          { label: record.name },
        ]}
        actions={
          <Stack direction="row" spacing={1} data-print="hide">
            <Button size="small" startIcon={<BackIcon />} onClick={() => navigate(config.path)}>
              Back
            </Button>

            {canUpdate && (
              <>
                <Button size="small" onClick={toggleStatus} color={record.isActive ? 'warning' : 'success'}>
                  {record.isActive ? 'Deactivate' : 'Activate'}
                </Button>
                <Button size="small" variant="contained" startIcon={<EditIcon />} onClick={() => setEditing(true)}>
                  Edit
                </Button>
              </>
            )}

            {canDelete && (
              <Button size="small" color="error" startIcon={<DeleteIcon />} onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            )}
          </Stack>
        }
      />

      {notice && (
        <Alert severity={notice.severity} sx={{ mb: 2 }} onClose={() => setNotice(null)}>
          {notice.message}
        </Alert>
      )}

      {!record.isActive && (
        <Alert severity="info" sx={{ mb: 2 }}>
          This {config.label.toLowerCase()} is inactive. It stays on existing records but is no longer offered
          when someone fills in a form.
        </Alert>
      )}

      <Tabs value={tab} onChange={(_event, next) => setTab(next)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Tab label="Details" />
        <Tab label="Audit trail" />
      </Tabs>

      {tab === 0 && (
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 7 }}>
            <Card variant="outlined" sx={{ height: '100%' }}>
              <CardContent>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="h6">Details</Typography>
                  <Chip
                    label={record.isActive ? 'Active' : 'Inactive'}
                    size="small"
                    color={record.isActive ? 'success' : 'default'}
                  />
                </Stack>

                <Divider sx={{ my: 2 }} />

                {config.fields.map((field) => (
                  <Stack
                    key={field.key}
                    direction="row"
                    justifyContent="space-between"
                    spacing={2}
                    sx={{ py: 0.75 }}
                  >
                    <Typography variant="body2" color="text.secondary">
                      {field.label}
                    </Typography>
                    <Typography variant="body2" fontWeight={500} align="right">
                      {displayValue(field)}
                    </Typography>
                  </Stack>
                ))}

                <Divider sx={{ my: 2 }} />

                <Stack direction="row" justifyContent="space-between" sx={{ py: 0.5 }}>
                  <Typography variant="caption" color="text.secondary">
                    Created
                  </Typography>
                  <Typography variant="caption">{formatDateTime(record.createdAt)}</Typography>
                </Stack>
                <Stack direction="row" justifyContent="space-between" sx={{ py: 0.5 }}>
                  <Typography variant="caption" color="text.secondary">
                    Last updated
                  </Typography>
                  <Typography variant="caption">{formatDateTime(record.updatedAt)}</Typography>
                </Stack>
              </CardContent>
            </Card>
          </Grid>

          <Grid size={{ xs: 12, md: 5 }}>
            <Card variant="outlined" sx={{ height: '100%' }}>
              <CardContent>
                <Typography variant="h6">In use by</Typography>
                <Typography variant="caption" color="text.secondary">
                  What would be orphaned if this were deleted
                </Typography>

                <Divider sx={{ my: 2 }} />

                {usage.total === 0 ? (
                  <Alert severity="success" variant="outlined">
                    Nothing references this {config.label.toLowerCase()}. It can be deleted safely.
                  </Alert>
                ) : (
                  <>
                    <Typography variant="h3" sx={{ mb: 1 }}>
                      {usage.total}
                    </Typography>

                    <Stack spacing={1}>
                      {usage.breakdown.map((entry) => (
                        <Stack key={entry.label} direction="row" justifyContent="space-between">
                          <Typography variant="body2" color="text.secondary">
                            {entry.label}
                            {entry.count === 1 ? '' : 's'}
                          </Typography>
                          <Chip label={entry.count} size="small" />
                        </Stack>
                      ))}
                    </Stack>

                    <Alert severity="warning" variant="outlined" sx={{ mt: 2 }}>
                      Deleting is refused while these exist. Deactivate instead, or reassign them first.
                    </Alert>
                  </>
                )}
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {tab === 1 && (
        <AuditTrail
          entries={audit}
          loading={auditLoading}
          page={auditMeta.page}
          limit={auditMeta.limit}
          total={auditMeta.total}
          onPageChange={(page) => setAuditMeta((previous) => ({ ...previous, page }))}
          onLimitChange={(limit) => setAuditMeta((previous) => ({ ...previous, limit, page: 1 }))}
        />
      )}

      <MasterFormDialog
        open={editing}
        master={master}
        record={editing ? record : null}
        options={{ departments: parents }}
        onClose={() => setEditing(false)}
        onSaved={(message) => {
          setEditing(false);
          setNotice({ severity: 'success', message });
          load();
        }}
      />

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${record.name}?`}
        message={
          usage.total > 0
            ? `${usage.total} record(s) still reference this ${config.label.toLowerCase()}, so the delete will be refused. Deactivate it instead.`
            : `This removes the ${config.label.toLowerCase()} permanently.`
        }
        confirmLabel="Delete"
        confirmColor="error"
        onConfirm={handleDelete}
        onClose={() => setConfirmDelete(false)}
      />
    </Box>
  );
};

export default MasterDetailPage;
