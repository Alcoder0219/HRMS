import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, Link as RouterLink } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import BackIcon from '@mui/icons-material/ArrowBackOutlined';
import AssignIcon from '@mui/icons-material/AssignmentIndOutlined';
import ReturnIcon from '@mui/icons-material/AssignmentReturnOutlined';
import LostIcon from '@mui/icons-material/ReportProblemOutlined';

import PageHeader from '@components/common/PageHeader.jsx';
import DataTable from '@components/common/DataTable.jsx';
import { LoadingState, ErrorState } from '@components/common/StateBlock.jsx';
import usePermissions from '@hooks/usePermissions.js';
import { RESOURCES, ACTIONS } from '@utils/permissions.js';
import payrollService from '@services/modules/payroll.service.js';
import { AssetAssignDialog, AssetReturnDialog, AssetLostDialog } from './components/AssetDialogs.jsx';
import { formatCurrency, formatDate, humanize } from '@utils/format.js';
import { displayName, employeeIdentifiers } from '@utils/dataGrid.js';
import { PATHS } from '@routes/paths.js';

const STATUS_COLOR = {
  AVAILABLE: 'success',
  ASSIGNED: 'primary',
  RETURNED: 'default',
  LOST: 'error',
  DAMAGED: 'warning',
  RETIRED: 'default',
};

/**
 * One asset: its details, who holds it, and every issue and return it has been
 * through.
 *
 * The assignment history is the point of the screen. "Who has this laptop" is
 * answerable from the list; "who had it in March, and what condition did they
 * give it back in" is only answerable here, and it is the question that arrives
 * when a recovery is disputed.
 */
const AssetDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = usePermissions();

  const canUpdate = can(RESOURCES.PAYROLL, ACTIONS.UPDATE);
  const canApprove = can(RESOURCES.PAYROLL, ACTIONS.APPROVE);

  const [asset, setAsset] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [dialog, setDialog] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);

    payrollService
      .getAsset(id)
      .then((response) => setAsset(response.data))
      .catch((rejection) => setError(rejection?.message ?? 'Could not load the asset'))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSaved = (message) => {
    setDialog(null);
    setNotice({ severity: 'success', message });
    load();
  };

  const line = (label, value) => (
    <Stack direction="row" justifyContent="space-between" sx={{ py: 0.75 }} spacing={2}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" fontWeight={500} align="right">
        {value}
      </Typography>
    </Stack>
  );

  const historyColumns = [
    {
      key: 'employeeId',
      label: 'Held by',
      render: (row) =>
        row.employeeId?._id || row.employeeId ? (
          <Box>
            <Typography variant="body2">{displayName(row.employeeId) || '—'}</Typography>
            <Typography variant="caption" color="text.secondary">
              {employeeIdentifiers(row.employeeId)}
            </Typography>
          </Box>
        ) : (
          '—'
        ),
    },
    { key: 'assignedOn', label: 'Issued', render: (row) => formatDate(row.assignedOn) },
    {
      key: 'conditionOnIssue',
      label: 'On issue',
      render: (row) => <Chip label={humanize(row.conditionOnIssue)} size="small" variant="outlined" />,
    },
    {
      key: 'returnedOn',
      label: 'Returned',
      render: (row) =>
        row.returnedOn ? formatDate(row.returnedOn) : <Chip label="Still held" size="small" color="primary" />,
    },
    {
      key: 'conditionOnReturn',
      label: 'On return',
      render: (row) =>
        row.conditionOnReturn ? (
          <Chip label={humanize(row.conditionOnReturn)} size="small" variant="outlined" />
        ) : (
          '—'
        ),
    },
    {
      key: 'recoveryAmount',
      label: 'Recovered',
      align: 'right',
      render: (row) => (row.recoveryAmount ? formatCurrency(row.recoveryAmount) : '—'),
    },
    {
      key: 'remarks',
      label: 'Remarks',
      render: (row) => (
        <Typography variant="caption" color="text.secondary">
          {row.remarks || '—'}
        </Typography>
      ),
    },
  ];

  if (loading) return <LoadingState message="Loading asset…" minHeight={320} />;

  if (error) {
    return (
      <Box>
        <PageHeader title="Asset" breadcrumbs={[{ label: 'Home', to: PATHS.dashboard }, { label: 'Assets', to: PATHS.employeeAssets }]} />
        <ErrorState message={error} onRetry={load} />
      </Box>
    );
  }

  const isAssigned = asset.status === 'ASSIGNED';
  const isAvailable = asset.status === 'AVAILABLE';

  return (
    <Box>
      <PageHeader
        title={asset.name}
        subtitle={`${asset.assetCode} · ${humanize(asset.category)}`}
        breadcrumbs={[
          { label: 'Home', to: PATHS.dashboard },
          { label: 'Employee Management' },
          { label: 'Assets', to: PATHS.employeeAssets },
          { label: asset.assetCode },
        ]}
        actions={
          <Stack direction="row" spacing={1} data-print="hide">
            <Button size="small" startIcon={<BackIcon />} onClick={() => navigate(PATHS.employeeAssets)}>
              Back
            </Button>

            {canUpdate && isAvailable && (
              <Button size="small" variant="contained" startIcon={<AssignIcon />} onClick={() => setDialog('assign')}>
                Issue
              </Button>
            )}

            {canUpdate && isAssigned && (
              <Button size="small" variant="contained" startIcon={<ReturnIcon />} onClick={() => setDialog('return')}>
                Return
              </Button>
            )}

            {canApprove && asset.status !== 'LOST' && (
              <Button size="small" color="error" startIcon={<LostIcon />} onClick={() => setDialog('lost')}>
                Write off
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

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card variant="outlined" sx={{ height: '100%' }}>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography variant="h6">Details</Typography>
                <Chip label={humanize(asset.status)} color={STATUS_COLOR[asset.status] ?? 'default'} size="small" />
              </Stack>

              <Divider sx={{ my: 2 }} />

              {line('Asset code', asset.assetCode)}
              {line('Category', humanize(asset.category))}
              {line('Make / model', [asset.make, asset.model].filter(Boolean).join(' ') || '—')}
              {line('Serial number', asset.serialNumber || '—')}
              {line('Condition', humanize(asset.condition))}
              {line('Purchased', formatDate(asset.purchaseDate))}
              {line('Purchase cost', formatCurrency(asset.purchaseCost))}
              {line('Recovery value', formatCurrency(asset.recoveryValue))}
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <Card variant="outlined" sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6">Current holder</Typography>
              <Divider sx={{ my: 2 }} />

              {asset.currentHolderId ? (
                <>
                  <Link
                    component={RouterLink}
                    to={PATHS.employeeDetail(asset.currentHolderId._id ?? asset.currentHolderId)}
                    variant="body1"
                    underline="hover"
                  >
                    {displayName(asset.currentHolderId) || 'Employee'}
                  </Link>
                  <Typography variant="caption" color="text.secondary" display="block">
                    {employeeIdentifiers(asset.currentHolderId)}
                  </Typography>
                </>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  In stock — not currently issued to anyone.
                </Typography>
              )}

              {asset.notes && (
                <>
                  <Divider sx={{ my: 2 }} />
                  <Typography variant="caption" color="text.secondary">
                    Notes
                  </Typography>
                  <Typography variant="body2">{asset.notes}</Typography>
                </>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Typography variant="h6" sx={{ mb: 1 }}>
        Assignment history
      </Typography>

      <DataTable
        columns={historyColumns}
        rows={[...(asset.assignments ?? [])].reverse()}
        getKey={(row) => row._id ?? `${row.employeeId}-${row.assignedOn}`}
        emptyTitle="Never issued"
        emptyMessage="This asset has not been given to anyone yet."
      />

      <AssetAssignDialog open={dialog === 'assign'} asset={asset} onClose={() => setDialog(null)} onSaved={handleSaved} />
      <AssetReturnDialog open={dialog === 'return'} asset={asset} onClose={() => setDialog(null)} onSaved={handleSaved} />
      <AssetLostDialog open={dialog === 'lost'} asset={asset} onClose={() => setDialog(null)} onSaved={handleSaved} />
    </Box>
  );
};

export default AssetDetailPage;
