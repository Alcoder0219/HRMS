import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import RefreshIcon from '@mui/icons-material/RefreshOutlined';

import { getRowId } from '@utils/dataGrid.js';

/**
 * The dashboard's filters in one compact row: Unit, Month, Year, Department,
 * a refresh, and when the figures were last read.
 *
 * The unit list is the Units master as the server returns it -- already only
 * the units this user may see. "All Units" is offered when there is a choice;
 * a user with one unit is shown that unit. The server enforces the same rule,
 * whatever is chosen here.
 */
const MONTHS = Array.from({ length: 12 }, (_, index) => ({
  value: index + 1,
  label: new Date(2000, index).toLocaleString(['en-TZ', 'en-GB'], { month: 'long' }),
}));

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, index) => CURRENT_YEAR - index);

const DashboardToolbar = ({ filters, onChange, units = [], departments = [], seesAllUnits = false, onRefresh, refreshing = false, updatedAt = null }) => {
  const singleUnit = !seesAllUnits && units.length === 1;
  const set = (field) => (event) => onChange({ [field]: event.target.value });

  return (
    <Paper variant="outlined" sx={{ p: 1.5, mb: 2.5 }} data-print="hide">
      {/* A grid rather than a wrapping row: four fields and the refresh line up
          on a desktop, pair up on a tablet and stack on a phone. */}
      <Box
        sx={{
          display: 'grid',
          gap: 1.5,
          alignItems: 'center',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'minmax(0, 2fr) minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 2fr) auto' },
        }}
      >
          <TextField
            select
            size="small"
            label="Unit"
            value={singleUnit ? getRowId(units[0]) : filters.unitId}
            onChange={set('unitId')}
            disabled={singleUnit}
            fullWidth
            // Shows "All Units" for the empty choice rather than an empty box.
            slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
          >
            {!singleUnit && <MenuItem value="">All Units</MenuItem>}
            {units.map((unit) => (
              <MenuItem key={getRowId(unit)} value={getRowId(unit)}>
                {unit.name}
              </MenuItem>
            ))}
          </TextField>

          <TextField select size="small" fullWidth label="Month" value={filters.month} onChange={(event) => onChange({ month: Number(event.target.value) })}>
            {MONTHS.map((entry) => (
              <MenuItem key={entry.value} value={entry.value}>
                {entry.label}
              </MenuItem>
            ))}
          </TextField>

          <TextField select size="small" fullWidth label="Year" value={filters.year} onChange={(event) => onChange({ year: Number(event.target.value) })}>
            {YEARS.map((entry) => (
              <MenuItem key={entry} value={entry}>
                {entry}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            select
            size="small"
            label="Department"
            value={filters.departmentId}
            onChange={set('departmentId')}
            fullWidth
            slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
          >
            <MenuItem value="">All departments</MenuItem>
            {departments.map((department) => (
              <MenuItem key={getRowId(department)} value={getRowId(department)}>
                {department.name}
              </MenuItem>
            ))}
          </TextField>

        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: { xs: 'space-between', lg: 'flex-end' } }}>
          <Typography variant="caption" color="text.secondary" noWrap>
            {updatedAt ? `Updated ${updatedAt.toLocaleTimeString(['en-TZ', 'en-GB'], { hour: '2-digit', minute: '2-digit' })}` : 'Loading…'}
          </Typography>
          <Tooltip title="Refresh dashboard">
            <span>
              <IconButton size="small" onClick={onRefresh} disabled={refreshing} aria-label="Refresh dashboard">
                <RefreshIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      </Box>
    </Paper>
  );
};

export default DashboardToolbar;
