import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Collapse from '@mui/material/Collapse';
import Grid from '@mui/material/Grid';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Badge from '@mui/material/Badge';
import SearchIcon from '@mui/icons-material/SearchOutlined';
import FilterIcon from '@mui/icons-material/FilterListOutlined';

import { EMPLOYEE_STATUS_OPTIONS, EMPLOYMENT_TYPE_OPTIONS } from '@utils/employeeOptions.js';

/**
 * Search box plus a collapsible filter panel.
 *
 * The search term is debounced locally rather than dispatched per keystroke --
 * every change resets to page 1 and refetches, and firing that on each letter
 * would issue a request per character and race the responses.
 */
const EmployeeFilters = ({ filters, masters, onChange, onReset }) => {
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState(filters.search);

  useEffect(() => {
    if (search === filters.search) return undefined;
    const timer = setTimeout(() => onChange({ search }), 350);
    return () => clearTimeout(timer);
  }, [search, filters.search, onChange]);

  // Keeps the input honest when "Clear all" resets state from outside.
  useEffect(() => setSearch(filters.search), [filters.search]);

  const activeCount = Object.entries(filters).filter(
    ([key, value]) => key !== 'search' && value,
  ).length;

  const select = (label, field, options, getLabel = (option) => option.label, getValue = (option) => option.value) => (
    <Grid size={{ xs: 12, sm: 6, md: 3 }}>
      <TextField
        select
        label={label}
        value={filters[field] ?? ''}
        onChange={(event) => onChange({ [field]: event.target.value })}
      >
        <MenuItem value="">All</MenuItem>
        {options.map((option) => (
          <MenuItem key={getValue(option)} value={getValue(option)}>
            {getLabel(option)}
          </MenuItem>
        ))}
      </TextField>
    </Grid>
  );

  return (
    <Box sx={{ mb: 2 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
        <TextField
          placeholder="Search by code, name, email or mobile"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          sx={{ maxWidth: { sm: 420 } }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
        />

        <Badge badgeContent={activeCount} color="primary">
          <Button
            variant="outlined"
            color="inherit"
            startIcon={<FilterIcon />}
            onClick={() => setExpanded((previous) => !previous)}
          >
            Filters
          </Button>
        </Badge>

        {(activeCount > 0 || filters.search) && (
          <Button color="inherit" onClick={onReset}>
            Clear all
          </Button>
        )}
      </Stack>

      <Collapse in={expanded}>
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          {select('Status', 'status', EMPLOYEE_STATUS_OPTIONS)}
          {select('Employment type', 'employmentType', EMPLOYMENT_TYPE_OPTIONS)}
          {select(
            'Department',
            'departmentId',
            masters.departments,
            (option) => option.name,
            (option) => option._id,
          )}
          {select(
            'Designation',
            'designationId',
            masters.designations,
            (option) => option.name,
            (option) => option._id,
          )}

          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <TextField
              type="date"
              label="Joined from"
              value={filters.joinedFrom ?? ''}
              onChange={(event) => onChange({ joinedFrom: event.target.value })}
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Grid>

          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <TextField
              type="date"
              label="Joined to"
              value={filters.joinedTo ?? ''}
              onChange={(event) => onChange({ joinedTo: event.target.value })}
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Grid>
        </Grid>
      </Collapse>
    </Box>
  );
};

export default EmployeeFilters;
