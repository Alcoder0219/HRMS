import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Grid from '@mui/material/Grid';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';

/**
 * Placeholders shaped like the thing that is loading.
 *
 * A centred spinner tells the reader that something is happening and nothing
 * about what. Worse, it occupies a different amount of space than the content
 * it precedes, so the page jumps when the data lands and whatever the reader
 * was about to click moves. These reserve the real layout.
 *
 * Widths vary per cell from a fixed pattern rather than at random: a random
 * width changes on every render, which reads as flicker.
 */

const WIDTHS = ['70%', '45%', '85%', '55%', '65%', '40%', '75%', '50%'];

export const TableSkeleton = ({ columns = 5, rows = 8, dense = true, withHeader = true }) => (
  <Box sx={{ overflowX: 'auto' }}>
    <Table size={dense ? 'small' : 'medium'}>
      {withHeader && (
        <TableHead>
          <TableRow>
            {Array.from({ length: columns }, (_, index) => (
              <TableCell key={index}>
                <Skeleton variant="text" width={WIDTHS[index % WIDTHS.length]} />
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
      )}

      <TableBody>
        {Array.from({ length: rows }, (_, rowIndex) => (
          <TableRow key={rowIndex}>
            {Array.from({ length: columns }, (_, cellIndex) => (
              <TableCell key={cellIndex}>
                <Skeleton variant="text" width={WIDTHS[(rowIndex + cellIndex) % WIDTHS.length]} />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  </Box>
);

export const CardSkeleton = ({ lines = 3, height = null }) => (
  <Card variant="outlined" sx={height ? { height } : undefined}>
    <CardContent>
      <Skeleton variant="text" width="45%" sx={{ fontSize: '1.1rem' }} />
      <Stack spacing={0.5} sx={{ mt: 1.5 }}>
        {Array.from({ length: lines }, (_, index) => (
          <Skeleton key={index} variant="text" width={WIDTHS[index % WIDTHS.length]} />
        ))}
      </Stack>
    </CardContent>
  </Card>
);

/** A row of summary cards, matching the six-across layout the reports use. */
export const StatCardsSkeleton = ({ count = 4, span = 3 }) => (
  <Grid container spacing={2}>
    {Array.from({ length: count }, (_, index) => (
      <Grid key={index} size={{ xs: 6, sm: 4, md: span }}>
        <Card variant="outlined">
          <CardContent>
            <Skeleton variant="text" width="60%" />
            <Skeleton variant="text" width="40%" sx={{ fontSize: '2rem' }} />
          </CardContent>
        </Card>
      </Grid>
    ))}
  </Grid>
);

/** Label-and-value pairs, for detail panes. */
export const DetailSkeleton = ({ fields = 8, columns = 2 }) => (
  <Grid container spacing={2}>
    {Array.from({ length: fields }, (_, index) => (
      <Grid key={index} size={{ xs: 12, sm: 12 / columns }}>
        <Skeleton variant="text" width="35%" sx={{ fontSize: '0.75rem' }} />
        <Skeleton variant="text" width={WIDTHS[index % WIDTHS.length]} />
      </Grid>
    ))}
  </Grid>
);

export const FormSkeleton = ({ fields = 6 }) => (
  <Grid container spacing={2}>
    {Array.from({ length: fields }, (_, index) => (
      <Grid key={index} size={{ xs: 12, sm: 6 }}>
        <Skeleton variant="rounded" height={40} />
      </Grid>
    ))}
  </Grid>
);

export default { TableSkeleton, CardSkeleton, StatCardsSkeleton, DetailSkeleton, FormSkeleton };
