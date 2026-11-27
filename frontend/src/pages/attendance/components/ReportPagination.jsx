import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

/** Rows per page; the first is the default. */
export const REPORT_PAGE_SIZES = [25, 50, 100];

/**
 * The pagination bar under an Attendance Reports table: the range shown, rows
 * per page, where you are, and previous / next. Styled as the Monthly
 * Attendance register's own bar.
 *
 * `pagination` is the server's `{ page, limit, total, totalPages }`.
 */
const ReportPagination = ({
  pagination,
  shown,
  loading = false,
  onPageChange,
  onLimitChange,
  noun = 'record',
  plural = `${noun}s`,
}) => {
  if (!pagination) return null;

  const { page, limit, total, totalPages } = pagination;
  const first = total ? (page - 1) * limit + 1 : 0;
  const last = total ? first + shown - 1 : 0;

  return (
    <Paper
      variant="outlined"
      data-print="hide"
      sx={{ mt: 1, px: 2, py: 1.25 }}
    >
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1.5}
        sx={{ alignItems: { xs: 'flex-start', sm: 'center' }, justifyContent: 'space-between' }}
      >
        <Typography variant="body2" color="text.secondary">
          {total ? `Showing ${first}–${last} of ${total} ${total === 1 ? noun : plural}` : `No ${plural}`}
        </Typography>

        <Stack direction="row" spacing={1.5} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <TextField
            select
            size="small"
            label="Per page"
            value={limit}
            onChange={(event) => onLimitChange(Number(event.target.value))}
            disabled={loading}
            sx={{ width: 110 }}
          >
            {REPORT_PAGE_SIZES.map((size) => (
              <MenuItem key={size} value={size}>
                {size}
              </MenuItem>
            ))}
          </TextField>

          <Typography variant="body2" color="text.secondary">
            Page {page} of {totalPages}
          </Typography>

          <Button
            size="small"
            variant="outlined"
            color="inherit"
            onClick={() => onPageChange(page - 1)}
            disabled={loading || page <= 1}
          >
            Previous
          </Button>
          <Button
            size="small"
            variant="outlined"
            color="inherit"
            onClick={() => onPageChange(page + 1)}
            disabled={loading || page >= totalPages}
          >
            Next
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
};

export default ReportPagination;
