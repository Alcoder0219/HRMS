import Box from '@mui/material/Box';
import LinearProgress from '@mui/material/LinearProgress';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TablePagination from '@mui/material/TablePagination';
import TableRow from '@mui/material/TableRow';
import TableSortLabel from '@mui/material/TableSortLabel';

import { EmptyState, ErrorState } from './StateBlock.jsx';
import { TableSkeleton } from './Skeletons.jsx';
import { rowKey } from '@utils/dataGrid.js';

/**
 * Read-oriented table shared by the module list screens.
 *
 * Every list in the app was repeating the same Paper / Table / empty-row /
 * pagination block. Collapsing it here keeps the screens visually identical and
 * means an empty, loading or error state is never accidentally omitted.
 *
 * Rows are keyed through `rowKey`, the same `_id`-first rule the DataGrid
 * screens use, so a Mongo document identifies itself the same way everywhere.
 *
 *   columns: [{ key, label, align?, width?, sortable?, render?(row), exportValue?(row) }]
 *
 * Pagination is optional and controlled -- pass `page` (1-based), `limit`,
 * `total` and the handlers, or omit them for a plain table.
 *
 * `getKey` overrides the identity rule for rows that are not documents. The
 * report endpoints return computed rows keyed by `employeeId` or by a group
 * name, and asking `rowKey` for an `_id` that was never there logs a false
 * alarm on every render.
 *
 * Sorting is server-side: the header reports intent through `onSort` and the
 * API decides the order. Sorting the current page in the browser would order
 * 25 rows out of 900 and look like a bug.
 */
const DataTable = ({
  columns,
  rows = [],
  loading = false,
  error = null,
  onRetry = null,
  emptyTitle = null,
  emptyMessage = null,
  emptyAction = null,
  getKey = null,
  onRowClick = null,
  sortBy = null,
  sortOrder = 'asc',
  onSort = null,
  page = null,
  limit = 25,
  total = 0,
  onPageChange = null,
  onLimitChange = null,
  dense = true,
  toolbar = null,
  // Turns on a sticky header. Off by default: a scroll container is only right
  // when the table is the tallest thing on the page.
  maxHeight = null,
}) => {
  const paginated = page !== null && typeof onPageChange === 'function';

  /**
   * Columns that stay put while the table scrolls sideways.
   *
   * A column opts in with `sticky: <pixels from the left>`. A wide register is
   * unreadable without it -- scroll far enough right and every row is an
   * anonymous line of numbers -- so the identifying columns hold their place.
   *
   * The background is opaque and set explicitly: a sticky cell renders over the
   * scrolling ones, and the default transparent cell would let them show
   * through. `zIndex` keeps a sticky header cell above a sticky body cell,
   * which would otherwise cover it when the header is also sticky.
   */
  const stickySx = (column, { header = false } = {}) =>
    column.sticky === undefined
      ? undefined
      : {
          position: 'sticky',
          left: column.sticky,
          zIndex: header ? 3 : 2,
          bgcolor: 'background.paper',
          // Marks where the frozen columns end and the scrolling ones begin.
          ...(column.stickyEdge ? { borderRight: 1, borderColor: 'divider' } : {}),
        };

  /**
   * A failed request replaces the table entirely rather than rendering an empty
   * one: a blank grid reads as "no records", which is a different and much more
   * damaging statement than "this did not load".
   */
  if (error) {
    return (
      <Paper variant="outlined">
        {toolbar}
        <ErrorState message={error} onRetry={onRetry} />
      </Paper>
    );
  }

  /**
   * Only on the first load. A refetch keeps the current rows visible under the
   * progress bar, so the page does not collapse every time a filter changes.
   *
   * The placeholder is shaped like the table it precedes -- same column count,
   * same density -- so the layout does not shift when the rows arrive and the
   * button someone was reaching for stays where it was.
   */
  if (loading && rows.length === 0) {
    return (
      <Paper variant="outlined">
        {toolbar}
        <TableSkeleton columns={columns.length} rows={Math.min(limit, 8)} dense={dense} />
      </Paper>
    );
  }

  return (
    <Paper variant="outlined" data-print="table">
      {toolbar}

      {/* Reserves its own height so the table does not jump when a fetch starts. */}
      <Box sx={{ height: 4 }}>{loading && <LinearProgress />}</Box>

      {rows.length === 0 ? (
        // Callers that pass only `emptyMessage` -- the original single-prop
        // shape -- get it as the headline rather than as a caption under a
        // generic one.
        <EmptyState
          title={emptyTitle ?? emptyMessage ?? 'Nothing to show'}
          message={emptyTitle ? emptyMessage : null}
          action={emptyAction}
        />
      ) : (
        <Box sx={{ overflowX: 'auto', maxHeight: maxHeight ?? undefined }}>
          <Table size={dense ? 'small' : 'medium'} stickyHeader={Boolean(maxHeight)}>
            <TableHead>
              <TableRow>
                {columns.map((column) => {
                  const sortable = Boolean(onSort && column.sortable);

                  return (
                    <TableCell
                      key={column.key}
                      align={column.align ?? 'left'}
                      width={column.width}
                      sortDirection={sortBy === column.key ? sortOrder : false}
                      sx={stickySx(column, { header: true })}
                    >
                      {sortable ? (
                        <TableSortLabel
                          active={sortBy === column.key}
                          direction={sortBy === column.key ? sortOrder : 'asc'}
                          onClick={() => onSort(column.key)}
                        >
                          {column.label}
                        </TableSortLabel>
                      ) : (
                        column.label
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            </TableHead>

            <TableBody>
              {rows.map((row, index) => (
                <TableRow
                  key={(getKey ? getKey(row) : rowKey(row)) || index}
                  hover={Boolean(onRowClick)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  // A clickable row that only responds to a mouse is unusable
                  // from the keyboard, and these rows are the primary way into
                  // most detail screens.
                  tabIndex={onRowClick ? 0 : undefined}
                  role={onRowClick ? 'button' : undefined}
                  onKeyDown={
                    onRowClick
                      ? (event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            onRowClick(row);
                          }
                        }
                      : undefined
                  }
                  sx={
                    onRowClick
                      ? { cursor: 'pointer', '&:focus-visible': { outline: 2, outlineColor: 'primary.main', outlineOffset: -2 } }
                      : undefined
                  }
                >
                  {columns.map((column) => (
                    <TableCell key={column.key} align={column.align ?? 'left'} sx={stickySx(column)}>
                      {column.render ? column.render(row) : (row[column.key] ?? '—')}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}

      {paginated && rows.length > 0 && (
        <TablePagination
          component="div"
          count={total}
          // MUI counts from zero; the API counts from one.
          page={Math.max(0, page - 1)}
          onPageChange={(_event, next) => onPageChange(next + 1)}
          rowsPerPage={limit}
          onRowsPerPageChange={(event) => onLimitChange?.(Number(event.target.value))}
          rowsPerPageOptions={[10, 25, 50, 100]}
        />
      )}
    </Paper>
  );
};

export default DataTable;
