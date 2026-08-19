import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { DataGrid } from '@mui/x-data-grid';

import AddIcon from '@mui/icons-material/AddOutlined';
import UploadIcon from '@mui/icons-material/UploadFileOutlined';
import DownloadIcon from '@mui/icons-material/FileDownloadOutlined';
import MoreIcon from '@mui/icons-material/MoreVertOutlined';
import EditIcon from '@mui/icons-material/EditOutlined';
import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import VisibilityIcon from '@mui/icons-material/VisibilityOutlined';

import PageHeader from '@components/common/PageHeader.jsx';
import StatusChip from '@components/common/StatusChip.jsx';
import ConfirmDialog from '@components/feedback/ConfirmDialog.jsx';
import EmployeeAvatar from '@components/common/EmployeeAvatar.jsx';
import EmployeeFilters from './components/EmployeeFilters.jsx';
import ImportDialog from './components/ImportDialog.jsx';

import { useAppDispatch, useAppSelector } from '@hooks/useRedux.js';
import usePermissions from '@hooks/usePermissions.js';
import { RESOURCES, ACTIONS } from '@utils/permissions.js';
import { formatDate, humanize } from '@utils/format.js';
import { ROLE_LABELS } from '@utils/roles.js';
import { getRowId, displayName, toSortParams } from '@utils/dataGrid.js';
import employeeService, { downloadBlob } from '@services/modules/employee.service.js';
import {
  fetchEmployees,
  fetchSummary,
  fetchMasters,
  deleteEmployee,
  setPage,
  setLimit,
  setSort,
  setFilters,
  resetFilters,
  selectEmployees,
} from '@redux/slices/employeeSlice.js';
import { PATHS } from '@routes/paths.js';

const SUMMARY_CARDS = [
  { key: 'total', label: 'Total', color: 'text.primary' },
  { key: 'ACTIVE', label: 'Active', color: 'success.main' },
  { key: 'PROBATION', label: 'Probation', color: 'info.main' },
  { key: 'NOTICE_PERIOD', label: 'On notice', color: 'warning.main' },
];

const EmployeeListPage = () => {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { can } = usePermissions();

  const { items, total, page, limit, sortBy, sortOrder, filters, summary, masters, status, error } =
    useAppSelector(selectEmployees);

  const [menu, setMenu] = useState({ anchor: null, row: null });
  const [confirmDelete, setConfirmDelete] = useState(null);
  // Reset every time the dialog opens or closes, so a previous "yes" cannot
  // carry over to the next employee someone deletes.
  const [purgeAttachments, setPurgeAttachments] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState(null);

  const canCreate = can(RESOURCES.EMPLOYEE, ACTIONS.CREATE);
  const canUpdate = can(RESOURCES.EMPLOYEE, ACTIONS.UPDATE);
  const canDelete = can(RESOURCES.EMPLOYEE, ACTIONS.DELETE);
  const canExport = can(RESOURCES.EMPLOYEE, ACTIONS.EXPORT);

  useEffect(() => {
    dispatch(fetchEmployees());
  }, [dispatch, page, limit, sortBy, sortOrder, filters]);

  useEffect(() => {
    dispatch(fetchMasters());
    if (can(RESOURCES.EMPLOYEE, ACTIONS.DASHBOARD)) dispatch(fetchSummary());
  }, [dispatch, can]);

  const handleFilters = useCallback((patch) => dispatch(setFilters(patch)), [dispatch]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const blob = await employeeService.exportExcel(filters);
      downloadBlob(blob, `employees-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (rejection) {
      setNotice({ severity: 'error', message: rejection?.message ?? 'Export failed' });
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = async (reason) => {
    const target = confirmDelete;
    const purge = purgeAttachments;

    setConfirmDelete(null);
    setPurgeAttachments(false);

    try {
      // Mongo documents key on `_id`; list rows carry no `id`.
      await dispatch(deleteEmployee({ id: getRowId(target), reason, purgeAttachments: purge })).unwrap();

      setNotice({
        severity: 'success',
        message: purge
          ? `${target.employeeCode} deleted. Its documents were permanently removed.`
          : `${target.employeeCode} deleted. It and its documents can be restored.`,
      });

      dispatch(fetchSummary());
    } catch (rejection) {
      setNotice({ severity: 'error', message: rejection?.message ?? 'Delete failed' });
    }
  };

  const columns = useMemo(
    () => [
      {
        field: 'employeeId',
        headerName: 'Employee ID',
        width: 130,
        renderCell: ({ row }) => (
          <Typography variant="body2" fontWeight={600} fontFamily="ui-monospace, monospace">
            {/*
              Employees created before the ID was issued automatically may not
              have one. Shown as a dash rather than blank so the column reads as
              "none recorded" instead of looking like a rendering fault.
            */}
            {row.employeeId ?? '—'}
          </Typography>
        ),
      },
      {
        field: 'employeeCode',
        headerName: 'Code',
        width: 120,
        renderCell: ({ row }) => (
          <Typography variant="body2" fontWeight={600} fontFamily="ui-monospace, monospace">
            {row.employeeCode}
          </Typography>
        ),
      },
      {
        field: 'firstName',
        headerName: 'Employee',
        flex: 1.4,
        minWidth: 240,
        renderCell: ({ row }) => (
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ height: '100%' }}>
            {/*
              No `photoDocumentId` here on purpose.

              A photo held in the attachments folder needs an authenticated
              request each, and a page of rows would fire one per employee. The
              list uses the statically-served legacy avatar when there is one
              and initials otherwise -- which is what it did before, now with
              the fallback shared rather than repeated.
            */}
            <EmployeeAvatar employee={row} size={32} sx={{ bgcolor: 'primary.light' }} />
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" fontWeight={500} noWrap>
                {/* `fullName` is a virtual and absent from lean list rows. */}
                {displayName(row)}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap>
                {row.workEmail ?? row.personalEmail ?? '—'}
              </Typography>
            </Box>
          </Stack>
        ),
      },
      {
        field: 'departmentId',
        headerName: 'Department',
        flex: 1,
        minWidth: 150,
        sortable: false,
        valueGetter: (value) => value?.name ?? '—',
      },
      {
        field: 'designationId',
        headerName: 'Designation',
        flex: 1,
        minWidth: 150,
        sortable: false,
        valueGetter: (value) => value?.name ?? '—',
      },
      {
        field: 'employmentType',
        headerName: 'Type',
        width: 130,
        renderCell: ({ value }) => <Chip label={humanize(value)} size="small" variant="outlined" />,
      },
      {
        /**
         * Whether this person can sign in, and as what.
         *
         * Here rather than on a separate Users screen: portal access is granted
         * from the Employee form now, so who holds it belongs beside everything
         * else about them.
         *
         * Not sortable -- `userId` is a populated reference, and asking Mongo to
         * order by it would sort on the ObjectId rather than on the role or the
         * status anyone actually means.
         */
        field: 'userId',
        headerName: 'Portal',
        width: 150,
        sortable: false,
        renderCell: ({ value }) => {
          if (!value) {
            return <Chip label="No access" size="small" variant="outlined" />;
          }

          // DEACTIVATED and SUSPENDED both mean "cannot sign in"; the account
          // still exists, which is why neither reads as "No access".
          if (value.status !== 'ACTIVE') {
            return (
              <Chip label={humanize(value.status)} size="small" color="error" variant="outlined" />
            );
          }

          return (
            <Chip
              label={ROLE_LABELS[value.role] ?? humanize(value.role)}
              size="small"
              color="success"
              variant="outlined"
            />
          );
        },
      },
      {
        field: 'joiningDate',
        headerName: 'Joined',
        width: 130,
        valueFormatter: (value) => formatDate(value),
      },
      {
        field: 'status',
        headerName: 'Status',
        width: 140,
        renderCell: ({ value }) => <StatusChip status={value} />,
      },
      {
        field: 'actions',
        headerName: '',
        width: 60,
        sortable: false,
        filterable: false,
        align: 'right',
        renderCell: ({ row }) => (
          <IconButton
            size="small"
            onClick={(event) => {
              event.stopPropagation();
              setMenu({ anchor: event.currentTarget, row });
            }}
            aria-label="Row actions"
          >
            <MoreIcon fontSize="small" />
          </IconButton>
        ),
      },
    ],
    [],
  );

  return (
    <Box>
      <PageHeader
        title="Employees"
        subtitle="Master records, employment details and lifecycle"
        breadcrumbs={[{ label: 'Home', to: PATHS.dashboard }, { label: 'Employees' }]}
        actions={
          <>
            {canExport && (
              <Button
                variant="outlined"
                color="inherit"
                startIcon={<DownloadIcon />}
                onClick={handleExport}
                disabled={exporting}
              >
                {exporting ? 'Exporting…' : 'Export'}
              </Button>
            )}
            {canCreate && (
              <Button
                variant="outlined"
                color="inherit"
                startIcon={<UploadIcon />}
                onClick={() => setImportOpen(true)}
              >
                Import
              </Button>
            )}
            {canCreate && (
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => navigate(PATHS.employeeNew)}
              >
                Add employee
              </Button>
            )}
          </>
        }
      />

      {notice && (
        <Alert severity={notice.severity} sx={{ mb: 2 }} onClose={() => setNotice(null)}>
          {notice.message}
        </Alert>
      )}

      {summary && (
        <Stack direction="row" spacing={2} sx={{ mb: 3, flexWrap: 'wrap', gap: 2 }}>
          {SUMMARY_CARDS.map(({ key, label, color }) => (
            <Card key={key} variant="outlined" sx={{ px: 2.5, py: 1.5, minWidth: 132, flex: '0 0 auto' }}>
              <Typography variant="caption" color="text.secondary" textTransform="uppercase" letterSpacing="0.06em">
                {label}
              </Typography>
              <Typography variant="h3" color={color} sx={{ mt: 0.5 }}>
                {summary[key] ?? 0}
              </Typography>
            </Card>
          ))}
        </Stack>
      )}

      <EmployeeFilters
        filters={filters}
        masters={masters}
        onChange={handleFilters}
        onReset={() => dispatch(resetFilters())}
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error.message}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
        <DataGrid
          rows={items}
          columns={columns}
          // Mongo keys on `_id`. Shared so every grid resolves identity the
          // same way -- and so row selection, which is keyed by this value,
          // stays consistent with the ids used for navigation and deletion.
          getRowId={getRowId}
          loading={status === 'loading'}
          // Server-side everything: the grid reports intent, the API decides.
          // Client-side paging would silently page only the current 25 rows.
          paginationMode="server"
          sortingMode="server"
          filterMode="server"
          rowCount={total}
          paginationModel={{ page: page - 1, pageSize: limit }}
          onPaginationModelChange={(model) => {
            if (model.pageSize !== limit) dispatch(setLimit(model.pageSize));
            else dispatch(setPage(model.page + 1));
          }}
          sortModel={[{ field: sortBy, sort: sortOrder }]}
          onSortModelChange={(model) =>
            // Clearing the sort falls back to employee code rather than to no
            // sort at all: an unsorted paginated list can repeat and skip rows
            // between pages.
            dispatch(setSort(toSortParams(model, { sortBy: 'employeeCode', sortOrder: 'asc' })))
          }
          pageSizeOptions={[10, 25, 50, 100]}
          disableRowSelectionOnClick
          disableColumnMenu
          onRowClick={({ row }) => navigate(PATHS.employeeDetail(getRowId(row)))}
          rowHeight={60}
          sx={{
            border: 0,
            '& .MuiDataGrid-row': { cursor: 'pointer' },
            '& .MuiDataGrid-columnHeaders': { bgcolor: 'background.default' },
            '& .MuiDataGrid-cell:focus, & .MuiDataGrid-cell:focus-within': { outline: 'none' },
          }}
          slotProps={{
            loadingOverlay: { variant: 'linear-progress', noRowsVariant: 'skeleton' },
          }}
        />
      </Paper>

      <Menu
        anchorEl={menu.anchor}
        open={Boolean(menu.anchor)}
        onClose={() => setMenu({ anchor: null, row: null })}
      >
        <MenuItem
          onClick={() => {
            navigate(PATHS.employeeDetail(getRowId(menu.row)));
            setMenu({ anchor: null, row: null });
          }}
        >
          <VisibilityIcon fontSize="small" sx={{ mr: 1.5 }} /> View
        </MenuItem>

        {canUpdate && (
          <MenuItem
            onClick={() => {
              navigate(PATHS.employeeEdit(getRowId(menu.row)));
              setMenu({ anchor: null, row: null });
            }}
          >
            <EditIcon fontSize="small" sx={{ mr: 1.5 }} /> Edit
          </MenuItem>
        )}

        {canDelete && (
          <MenuItem
            onClick={() => {
              setConfirmDelete(menu.row);
              setMenu({ anchor: null, row: null });
            }}
            sx={{ color: 'error.main' }}
          >
            <DeleteIcon fontSize="small" sx={{ mr: 1.5 }} /> Delete
          </MenuItem>
        )}
      </Menu>

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title="Delete employee?"
        message={`${confirmDelete?.employeeCode ?? ''} will be removed from listings. The record is retained and can be restored.`}
        confirmLabel="Delete"
        requireReason
        reasonLabel="Reason (recorded in the audit trail)"
        // Asked separately from the delete itself, because it is the one part
        // that Restore cannot undo.
        extra={
          <FormControlLabel
            sx={{ mt: 1, alignItems: 'flex-start' }}
            control={
              <Checkbox
                size="small"
                checked={purgeAttachments}
                onChange={(event) => setPurgeAttachments(event.target.checked)}
              />
            }
            label={
              <Box>
                <Typography variant="body2">Also delete the attachments folder</Typography>
                <Typography variant="caption" color="error.main">
                  Removes attachments/{confirmDelete?.employeeCode ?? ''} and every file in it. Restoring the employee
                  will not bring the documents back.
                </Typography>
              </Box>
            }
          />
        }
        onConfirm={handleDelete}
        onClose={() => {
          setConfirmDelete(null);
          setPurgeAttachments(false);
        }}
      />

      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => {
          dispatch(fetchEmployees());
          dispatch(fetchSummary());
        }}
      />
    </Box>
  );
};

export default EmployeeListPage;
