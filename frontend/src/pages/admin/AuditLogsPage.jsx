import { useCallback, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import PageHeader from '@components/common/PageHeader.jsx';
import DataTable from '@components/common/DataTable.jsx';
import ExportMenu from '@components/common/ExportMenu.jsx';
import useTableState from '@hooks/useTableState.js';
import adminService from '@services/modules/admin.service.js';
import { formatDateTime, humanize } from '@utils/format.js';
import { PATHS } from '@routes/paths.js';

const ACTION_COLOR = {
  CREATE: 'success',
  UPDATE: 'info',
  DELETE: 'error',
  RESTORE: 'warning',
  STATUS_CHANGE: 'secondary',
  IMPORT: 'primary',
  EXPORT: 'default',
  UPLOAD: 'default',
  BULK_UPDATE: 'warning',
};

/**
 * The audit trail: every change, its author and its before-and-after.
 *
 * Read-only by design. There is no edit and no delete on this screen, and no
 * endpoint behind one -- a log that can be corrected is not evidence of
 * anything.
 */
const AuditLogsPage = () => {
  const table = useTableState({
    initialSort: 'occurredAt',
    initialFilters: { entity: '', action: '', actorId: '', from: '', to: '' },
  });

  const [rows, setRows] = useState([]);
  const [options, setOptions] = useState({ entities: [], actions: [], actors: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    adminService
      .auditFilters()
      .then((response) => setOptions(response.data ?? { entities: [], actions: [], actors: [] }))
      .catch(() => setOptions({ entities: [], actions: [], actors: [] }));
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);

    adminService
      .listAuditLogs({
        page: table.page,
        limit: table.limit,
        search: table.search,
        ...table.filters,
      })
      .then((response) => {
        setRows(response.data ?? []);
        table.setTotal(response.meta?.total ?? 0);
      })
      .catch((rejection) => setError(rejection?.message ?? 'Could not load the audit trail'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table.page, table.limit, table.search, table.filters]);

  useEffect(() => {
    load();
  }, [load]);

  const setFilter = (field) => (event) => table.setFilters({ ...table.filters, [field]: event.target.value });

  const columns = [
    { key: 'occurredAt', label: 'When', render: (row) => formatDateTime(row.occurredAt) },
    { key: 'actorEmail', label: 'Who', render: (row) => row.actorEmail ?? 'system' },
    {
      key: 'action',
      label: 'Action',
      render: (row) => <Chip label={humanize(row.action)} size="small" color={ACTION_COLOR[row.action] ?? 'default'} />,
    },
    { key: 'entity', label: 'Type' },
    { key: 'entityLabel', label: 'Record', render: (row) => row.entityLabel ?? '—' },
    {
      key: 'changeCount',
      label: 'Fields',
      align: 'right',
      render: (row) => (row.changeCount > 0 ? row.changeCount : '—'),
    },
    { key: 'source', label: 'Source' },
  ];

  return (
    <Box>
      <PageHeader
        title="Audit Logs"
        subtitle="Every change, who made it and what it replaced"
        breadcrumbs={[{ label: 'Home', to: PATHS.dashboard }, { label: 'Administration' }, { label: 'Audit Logs' }]}
        actions={
          <ExportMenu
            columns={columns}
            rows={rows}
            filename="audit-log"
            totalCount={table.total}
            onExcel={() => adminService.exportAuditExcel({ ...table.filters, search: table.search })}
            onPdf={() => adminService.exportAuditPdf({ ...table.filters, search: table.search })}
            onError={setError}
          />
        }
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Stack direction="row" spacing={1} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap data-print="hide">
        <TextField
          size="small"
          label="Search records"
          value={table.search}
          onChange={(event) => table.setSearch(event.target.value)}
          sx={{ width: 220 }}
        />

        <TextField select size="small" label="Type" value={table.filters.entity} onChange={setFilter('entity')} sx={{ width: 180 }}>
          <MenuItem value="">All types</MenuItem>
          {options.entities.map((entity) => (
            <MenuItem key={entity} value={entity}>
              {entity}
            </MenuItem>
          ))}
        </TextField>

        <TextField select size="small" label="Action" value={table.filters.action} onChange={setFilter('action')} sx={{ width: 170 }}>
          <MenuItem value="">All actions</MenuItem>
          {options.actions.map((action) => (
            <MenuItem key={action} value={action}>
              {humanize(action)}
            </MenuItem>
          ))}
        </TextField>

        <TextField select size="small" label="Who" value={table.filters.actorId} onChange={setFilter('actorId')} sx={{ width: 230 }}>
          <MenuItem value="">Anyone</MenuItem>
          {options.actors.map((actor) => (
            <MenuItem key={actor._id} value={actor._id}>
              {actor.email} ({actor.count})
            </MenuItem>
          ))}
        </TextField>

        <TextField
          size="small"
          type="date"
          label="From"
          value={table.filters.from}
          onChange={setFilter('from')}
          slotProps={{ inputLabel: { shrink: true } }}
        />

        <TextField
          size="small"
          type="date"
          label="To"
          value={table.filters.to}
          onChange={setFilter('to')}
          slotProps={{ inputLabel: { shrink: true } }}
        />
      </Stack>

      <DataTable
        columns={columns}
        rows={rows}
        loading={loading}
        error={error}
        onRetry={load}
        onRowClick={setSelected}
        emptyTitle="Nothing matches these filters"
        emptyMessage="The audit trail only records changes made through the application."
        page={table.page}
        limit={table.limit}
        total={table.total}
        onPageChange={table.setPage}
        onLimitChange={table.setLimit}
      />

      <Dialog open={Boolean(selected)} onClose={() => setSelected(null)} maxWidth="md" fullWidth>
        <DialogTitle>
          {selected && `${humanize(selected.action)} ${selected.entity}`}
          {selected?.entityLabel && (
            <Typography variant="body2" color="text.secondary">
              {selected.entityLabel}
            </Typography>
          )}
        </DialogTitle>

        <DialogContent dividers>
          {selected && (
            <>
              <Stack direction="row" spacing={2} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
                <Chip size="small" variant="outlined" label={formatDateTime(selected.occurredAt)} />
                <Chip size="small" variant="outlined" label={selected.actorEmail ?? 'system'} />
                {selected.actorRole && <Chip size="small" variant="outlined" label={humanize(selected.actorRole)} />}
                {selected.ip && <Chip size="small" variant="outlined" label={selected.ip} />}
                <Chip size="small" variant="outlined" label={selected.source} />
              </Stack>

              <DataTable
                columns={[
                  { key: 'field', label: 'Field' },
                  { key: 'from', label: 'Was', render: (row) => row.from ?? <em>empty</em> },
                  { key: 'to', label: 'Became', render: (row) => row.to ?? <em>empty</em> },
                ]}
                rows={selected.changes ?? []}
                emptyTitle="No field-level detail"
                emptyMessage="This action records that it happened rather than a set of field changes."
              />

              {selected.metadata && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="subtitle2" gutterBottom>
                    Context
                  </Typography>
                  <Box
                    component="pre"
                    sx={{
                      m: 0,
                      p: 1.5,
                      borderRadius: 1,
                      bgcolor: 'action.hover',
                      fontSize: 12,
                      overflowX: 'auto',
                    }}
                  >
                    {JSON.stringify(selected.metadata, null, 2)}
                  </Box>
                </Box>
              )}
            </>
          )}
        </DialogContent>

        <DialogActions>
          <Button onClick={() => setSelected(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default AuditLogsPage;
