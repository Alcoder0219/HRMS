import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import PageHeader from '@components/common/PageHeader.jsx';
import DataTable from '@components/common/DataTable.jsx';
import StatCard from '@components/common/StatCard.jsx';
import StatusChip from '@components/common/StatusChip.jsx';
import ExportMenu from '@components/common/ExportMenu.jsx';
import ReportChart from '@components/charts/ReportChart.jsx';
import { ErrorState } from '@components/common/StateBlock.jsx';
import ReportFilters from './ReportFilters.jsx';
import reportService from '@services/modules/report.service.js';
import { formatCurrency, formatDate, formatDateTime, formatNumber } from '@utils/format.js';
import { PATHS } from '@routes/paths.js';

/**
 * One screen for every report.
 *
 * The server sends the filters, the summary cards, the charts and the column
 * definitions along with the rows, so this component renders whatever it is
 * given rather than knowing anything about employees, loans or settlements. A
 * ninth report needs a server-side descriptor and nothing here.
 *
 * Filters live in the URL. A report someone spent a minute narrowing down is
 * worth linking to, and it survives a refresh.
 */

const RESERVED = new Set(['page', 'limit', 'sortBy', 'sortOrder']);

const renderCell = (row, column) => {
  const value = row[column.key];

  if (value === null || value === undefined || value === '') return '—';

  switch (column.format) {
    case 'currency':
      return formatCurrency(value);
    case 'date':
      return formatDate(value);
    case 'percent':
      return `${formatNumber(value)}%`;
    case 'hours':
      return `${formatNumber(value)} h`;
    case 'days':
      return `${formatNumber(value)} d`;
    case 'years':
      return `${formatNumber(value)} y`;
    case 'status':
      return <StatusChip status={value} />;
    default:
      return typeof value === 'number' ? formatNumber(value) : value;
  }
};

const formatCard = (entry) => {
  switch (entry.format) {
    case 'currency':
      return formatCurrency(entry.value);
    case 'percent':
      return `${formatNumber(entry.value)}%`;
    case 'hours':
      return `${formatNumber(entry.value)} h`;
    case 'days':
      return `${formatNumber(entry.value)} d`;
    case 'years':
      return `${formatNumber(entry.value)} y`;
    default:
      return formatNumber(entry.value);
  }
};

const ReportViewerPage = () => {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [catalog, setCatalog] = useState([]);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const params = useMemo(() => Object.fromEntries(searchParams.entries()), [searchParams]);

  const page = Number(params.page) || 1;
  const limit = Number(params.limit) || 25;
  const sortBy = params.sortBy ?? null;
  const sortOrder = params.sortOrder ?? 'desc';

  useEffect(() => {
    reportService
      .catalog()
      .then((response) => setCatalog(response.data ?? []))
      .catch(() => setCatalog([]));
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);

    reportService
      .run(slug, params)
      .then((response) => setReport(response.data))
      .catch((rejection) => {
        setReport(null);
        setError(rejection?.message ?? 'Could not build this report');
      })
      .finally(() => setLoading(false));
  }, [slug, params]);

  useEffect(() => {
    load();
  }, [load]);

  /** Any change other than paging returns to page one; page 4 of a new filter is meaningless. */
  const patchParams = (changes, { resetPage = true } = {}) => {
    const next = new URLSearchParams(searchParams);

    Object.entries(changes).forEach(([key, value]) => {
      if (value === '' || value === null || value === undefined) next.delete(key);
      else next.set(key, String(value));
    });

    if (resetPage) next.delete('page');

    setSearchParams(next, { replace: true });
  };

  const resetFilters = () => {
    const next = new URLSearchParams();
    if (params.limit) next.set('limit', params.limit);
    setSearchParams(next, { replace: true });
  };

  const handleSort = (key) => {
    const flip = sortBy === key && sortOrder === 'asc' ? 'desc' : 'asc';
    patchParams({ sortBy: key, sortOrder: flip });
  };

  const columns = useMemo(
    () =>
      (report?.columns ?? []).map((column) => ({
        key: column.key,
        label: column.label,
        align: column.align ?? 'left',
        sortable: true,
        render: (row) => renderCell(row, column),
      })),
    [report],
  );

  // The CSV fallback in ExportMenu writes raw values, so it gets the plain
  // column list rather than the render functions above.
  const rawColumns = useMemo(
    () => (report?.columns ?? []).map((column) => ({ key: column.key, label: column.label })),
    [report],
  );

  const current = catalog.find((entry) => entry.slug === slug);
  const title = report?.label ?? current?.label ?? 'Report';

  return (
    <Box>
      <PageHeader
        title={title}
        subtitle={report?.description ?? current?.description ?? 'Loading…'}
        breadcrumbs={[
          { label: 'Home', to: PATHS.dashboard },
          { label: 'Reports', to: PATHS.reports },
          { label: title },
        ]}
        actions={
          <Stack direction="row" spacing={1} alignItems="center">
            {catalog.length > 0 && (
              <TextField
                select
                size="small"
                label="Report"
                value={slug}
                onChange={(event) => navigate(PATHS.report(event.target.value))}
                sx={{ width: 210 }}
                data-print="hide"
              >
                {catalog.map((entry) => (
                  <MenuItem key={entry.slug} value={entry.slug}>
                    {entry.label}
                  </MenuItem>
                ))}
              </TextField>
            )}

            <ExportMenu
              columns={rawColumns}
              rows={report?.rows ?? []}
              filename={slug}
              totalCount={report?.meta?.total ?? 0}
              disabled={!report}
              onExcel={() => reportService.exportExcel(slug, params)}
              onPdf={() => reportService.exportPdf(slug, params)}
              onError={setError}
            />
          </Stack>
        }
      />

      {error && !loading && <ErrorState message={error} onRetry={load} minHeight={200} />}

      {!error && (
        <>
          <Grid container spacing={2} sx={{ mb: 3 }}>
            {(report?.summary ?? Array.from({ length: 6 }, () => null)).map((entry, index) => (
              <Grid key={entry?.label ?? index} size={{ xs: 6, sm: 4, md: 2 }}>
                <StatCard
                  label={entry?.label ?? ''}
                  value={entry ? formatCard(entry) : ''}
                  caption={entry?.caption}
                  color={entry?.color === 'default' ? 'primary' : entry?.color}
                  loading={loading}
                />
              </Grid>
            ))}
          </Grid>

          {(report?.filters ?? current?.filters ?? []).length > 0 && (
            <ReportFilters
              filters={report?.filters ?? current?.filters ?? []}
              values={params}
              onChange={(key, value) => patchParams({ [key]: value })}
              onReset={resetFilters}
            />
          )}

          <Grid container spacing={2} sx={{ mb: 3 }}>
            {(report?.charts ?? Array.from({ length: 4 }, () => null)).map((entry, index) => (
              <Grid key={entry?.key ?? index} size={{ xs: 12, md: 6, lg: 3 }}>
                <ReportChart chart={entry} loading={loading} />
              </Grid>
            ))}
          </Grid>

          {(report?.breakdowns ?? []).map((breakdown) => (
            <Box key={breakdown.key} sx={{ mb: 3 }}>
              <Typography variant="h6" sx={{ mb: 1 }}>
                {breakdown.title}
              </Typography>
              <DataTable
                columns={breakdown.columns.map((column) => ({
                  key: column.key,
                  label: column.label,
                  align: column.align ?? 'left',
                  render: (row) => renderCell(row, column),
                }))}
                rows={breakdown.rows}
                emptyTitle="Nothing to show"
              />
            </Box>
          ))}

          <Typography variant="h6" sx={{ mb: 1 }}>
            Records
          </Typography>

          <DataTable
            columns={columns}
            rows={report?.rows ?? []}
            loading={loading}
            // Not every report row is a document -- the attendance report is a
            // per-employee rollup. Returning undefined lets DataTable fall back
            // to the row index rather than keying every row on the same value.
            getKey={(row) => row._id ?? row.employeeId ?? row.assetCode ?? row.loanNumber ?? undefined}
            emptyTitle="Nothing matches these filters"
            emptyMessage="Widen the filters, or pick a different period."
            sortBy={sortBy}
            sortOrder={sortOrder}
            onSort={handleSort}
            page={page}
            limit={limit}
            total={report?.meta?.total ?? 0}
            onPageChange={(next) => patchParams({ page: next }, { resetPage: false })}
            onLimitChange={(next) => patchParams({ limit: next })}
          />

          {report?.generatedAt && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
              Generated {formatDateTime(report.generatedAt)} · {formatNumber(report.meta?.total ?? 0)} matching record(s)
              {' · '}
              Excel and PDF exports contain every matching record, not just this page.
            </Typography>
          )}
        </>
      )}
    </Box>
  );
};

export default ReportViewerPage;
