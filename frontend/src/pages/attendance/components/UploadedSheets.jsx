import { useCallback, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ClearIcon from '@mui/icons-material/ClearOutlined';
import ViewIcon from '@mui/icons-material/VisibilityOutlined';
import DeleteIcon from '@mui/icons-material/DeleteOutlineOutlined';

import DataTable from '@components/common/DataTable.jsx';
import ExportMenu from '@components/common/ExportMenu.jsx';
import ConfirmDialog from '@components/feedback/ConfirmDialog.jsx';
import SheetDetailDialog from './SheetDetailDialog.jsx';
import useTableState from '@hooks/useTableState.js';
import usePermissions from '@hooks/usePermissions.js';
import { RESOURCES, ACTIONS } from '@utils/permissions.js';
import attendanceService from '@services/modules/attendance.service.js';
import { formatDateTime } from '@utils/format.js';
import { getRowId } from '@utils/dataGrid.js';

const MONTHS = Array.from({ length: 12 }, (_, index) => ({
  value: index + 1,
  label: new Date(2000, index).toLocaleString([], { month: 'long' }),
}));

const now = new Date();
const YEARS = Array.from({ length: 5 }, (_, index) => now.getFullYear() - 3 + index);

/**
 * The monthly sheets an import produced -- one row per employee per month.
 *
 * These are the artifact the importer writes and the monthly views read, and
 * until now nothing could see them. Without this an import that landed on the
 * wrong month could only be found by noticing the numbers were wrong.
 */
const UploadedSheets = () => {
  const { can } = usePermissions();

  const canEdit = can(RESOURCES.ATTENDANCE, ACTIONS.APPROVE);
  const canDelete = can(RESOURCES.ATTENDANCE, ACTIONS.DELETE);

  const table = useTableState({
    initialFilters: { year: '', month: '', employeeId: '', importBatchId: '' },
    initialSort: 'uploadedAt',
  });

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [detail, setDetail] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);

  const { params, setTotal } = table;

  const load = useCallback(() => {
    setLoading(true);
    setError(null);

    attendanceService
      .sheets(params)
      .then((response) => {
        setRows(response.data ?? []);
        setTotal(response.meta?.total ?? 0);
      })
      .catch((rejection) => {
        setRows([]);
        setError(rejection?.message ?? 'Could not load the uploaded sheets');
      })
      .finally(() => setLoading(false));
  }, [params, setTotal]);

  useEffect(() => {
    load();
  }, [load]);

  const handleDelete = async () => {
    const target = pendingDelete;
    setPendingDelete(null);

    try {
      await attendanceService.deleteSheet(getRowId(target));
      setNotice({ severity: 'success', message: 'Sheet deleted' });
      load();
    } catch (rejection) {
      setNotice({ severity: 'error', message: rejection?.message ?? 'The sheet could not be deleted' });
    }
  };

  const columns = [
    {
      key: 'period',
      label: 'Period',
      width: 130,
      sortable: true,
      exportValue: (row) => `${row.year}-${String(row.month).padStart(2, '0')}`,
      render: (row) => (
        <Typography variant="body2">
          {MONTHS[row.month - 1]?.label} {row.year}
        </Typography>
      ),
    },
    {
      key: 'employee',
      label: 'Employee',
      exportValue: (row) => row.employeeName ?? row.employeeId,
      render: (row) => (
        <Box>
          <Typography variant="body2">{row.employeeName ?? '—'}</Typography>
          <Typography variant="caption" color="text.secondary" fontFamily="monospace">
            {row.employeeId ?? '—'}
          </Typography>
        </Box>
      ),
    },
    { key: 'unit', label: 'Unit', exportValue: (row) => row.unit, render: (row) => row.unit ?? '—' },
    // Field names mirror the summary sub-schema on the model: `present`,
    // `absent`, `halfDay` — not the `*Days` forms.
    {
      key: 'present',
      label: 'Present',
      align: 'right',
      exportValue: (row) => row.summary?.present,
      render: (row) => row.summary?.present ?? '—',
    },
    {
      key: 'absent',
      label: 'Absent',
      align: 'right',
      exportValue: (row) => row.summary?.absent,
      render: (row) => row.summary?.absent ?? '—',
    },
    {
      key: 'payableDays',
      label: 'Payable',
      align: 'right',
      exportValue: (row) => row.summary?.payableDays,
      render: (row) => <strong>{row.summary?.payableDays?.toFixed?.(1) ?? row.summary?.payableDays ?? '—'}</strong>,
    },
    {
      key: 'overtimeMinutes',
      label: 'Overtime',
      align: 'right',
      exportValue: (row) => row.summary?.overtimeMinutes,
      render: (row) => {
        const minutes = row.summary?.overtimeMinutes ?? 0;
        return minutes ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : '—';
      },
    },
    {
      key: 'uploadedAt',
      label: 'Uploaded',
      sortable: true,
      exportValue: (row) => formatDateTime(row.uploadedAt ?? row.createdAt),
      render: (row) => (
        <Typography variant="caption" color="text.secondary">
          {formatDateTime(row.uploadedAt ?? row.createdAt)}
        </Typography>
      ),
    },
    {
      key: 'importBatchId',
      label: 'Batch',
      exportValue: (row) => row.importBatchId,
      render: (row) =>
        row.importBatchId ? (
          <Tooltip title={row.importBatchId}>
            {/* Truncated: the batch id is a uuid, and its value is as a filter
                rather than as something to read. */}
            <Chip
              label={String(row.importBatchId).slice(0, 8)}
              size="small"
              variant="outlined"
              onClick={() => table.setFilter('importBatchId', row.importBatchId)}
            />
          </Tooltip>
        ) : (
          '—'
        ),
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      width: 100,
      render: (row) => (
        <Stack direction="row" spacing={0.25} justifyContent="flex-end" onClick={(event) => event.stopPropagation()}>
          <Tooltip title="View days">
            <IconButton size="small" onClick={() => setDetail(row)}>
              <ViewIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          {canDelete && (
            <Tooltip title="Delete sheet">
              <IconButton size="small" color="error" onClick={() => setPendingDelete(row)}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Stack>
      ),
    },
  ];

  const hasFilters = table.activeFilterCount > 0;

  return (
    <Box>
      {notice && (
        <Alert severity={notice.severity} sx={{ mb: 2 }} onClose={() => setNotice(null)}>
          {notice.message}
        </Alert>
      )}

      <Stack direction="row" spacing={1} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap data-print="hide">
        <TextField
          select
          size="small"
          label="Year"
          value={table.filters.year}
          onChange={(event) => table.setFilter('year', event.target.value)}
          sx={{ width: 120 }}
        >
          <MenuItem value="">All</MenuItem>
          {YEARS.map((year) => (
            <MenuItem key={year} value={year}>
              {year}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          select
          size="small"
          label="Month"
          value={table.filters.month}
          onChange={(event) => table.setFilter('month', event.target.value)}
          sx={{ width: 150 }}
        >
          <MenuItem value="">All</MenuItem>
          {MONTHS.map((month) => (
            <MenuItem key={month.value} value={month.value}>
              {month.label}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          size="small"
          label="Employee ID"
          value={table.filters.employeeId}
          onChange={(event) => table.setFilter('employeeId', event.target.value)}
          sx={{ width: 180 }}
          helperText="As it appears in the workbook"
        />

        {table.filters.importBatchId && (
          <Chip
            label={`Batch ${String(table.filters.importBatchId).slice(0, 8)}`}
            size="small"
            color="primary"
            onDelete={() => table.setFilter('importBatchId', '')}
            sx={{ alignSelf: 'center' }}
          />
        )}

        {hasFilters && (
          <Button size="small" color="inherit" startIcon={<ClearIcon />} onClick={table.resetFilters}>
            Clear
          </Button>
        )}

        <Box sx={{ flex: 1 }} />

        <ExportMenu
          columns={columns}
          rows={rows}
          filename="attendance-sheets"
          totalCount={table.total}
          onError={(message) => setNotice({ severity: 'error', message })}
        />
      </Stack>

      <DataTable
        columns={columns}
        rows={rows}
        loading={loading}
        error={error}
        onRetry={load}
        sortBy={table.sortBy}
        sortOrder={table.sortOrder}
        onSort={table.toggleSort}
        onRowClick={(row) => setDetail(row)}
        emptyTitle={hasFilters ? 'No sheets match these filters' : 'Nothing imported yet'}
        emptyMessage={
          hasFilters
            ? 'Try clearing a filter, or choose another period.'
            : 'Sheets appear here once a monthly workbook has been imported.'
        }
        page={table.page}
        limit={table.limit}
        total={table.total}
        onPageChange={table.setPage}
        onLimitChange={table.setLimit}
      />

      <SheetDetailDialog
        sheet={detail}
        canEdit={canEdit}
        onClose={() => setDetail(null)}
        onSaved={(message) => {
          setDetail(null);
          setNotice({ severity: 'success', message });
          load();
        }}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete this sheet?"
        message={`The monthly sheet for ${pendingDelete?.employeeName ?? pendingDelete?.employeeId ?? 'this employee'} is removed. Daily attendance records created from it are not affected.`}
        confirmLabel="Delete"
        confirmColor="error"
        onConfirm={handleDelete}
        onClose={() => setPendingDelete(null)}
      />
    </Box>
  );
};

export default UploadedSheets;
