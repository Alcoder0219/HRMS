import { useEffect, useRef, useState } from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import employeeService from '@services/modules/employee.service.js';
import { getRowId, displayName, employeeIdentifiers } from '@utils/dataGrid.js';

/**
 * Employee lookup shared by the screens that act on one person at a time.
 *
 * Searches server-side rather than loading the directory: at a few thousand
 * people a full list is both slow and unusable. Extracted from the mark-
 * attendance dialog, which proved the shape.
 *
 * Identity goes through `getRowId` throughout. List responses are lean and
 * carry only `_id`, so reading `option.id` yields undefined -- which makes
 * every option compare equal to every other and the selection unusable.
 */
const EmployeePicker = ({
  value,
  onChange,
  label = 'Employee',
  placeholder = 'Search by code or name',
  required = false,
  size = 'small',
  disabled = false,
  helperText = null,
  sx = null,
}) => {
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef(null);
  const latest = useRef(0);

  useEffect(() => () => clearTimeout(timer.current), []);

  const search = (term) => {
    clearTimeout(timer.current);
    const requestId = (latest.current += 1);

    // Two characters is where the result set stops being the whole directory.
    if (!term || term.trim().length < 2) {
      setLoading(false);
      return;
    }

    setLoading(true);
    // Debounced: one request once typing pauses, not one per keystroke.
    timer.current = setTimeout(async () => {
      try {
        const response = await employeeService.list({ search: term.trim(), limit: 20 });
        // Only the latest search may fill the list; a slower earlier one is dropped.
        if (requestId !== latest.current) return;
        setOptions(response.data ?? []);
        setFailed(false);
      } catch {
        if (requestId !== latest.current) return;
        setOptions([]);
        setFailed(true);
      } finally {
        if (requestId === latest.current) setLoading(false);
      }
    }, 250);
  };

  return (
    <Autocomplete
      options={options}
      value={value}
      loading={loading}
      disabled={disabled}
      onChange={(_event, next) => onChange(next)}
      // A selection fills the input with the chosen label: that is not a search.
      onInputChange={(_event, term, reason) => {
        if (reason !== 'reset') search(term);
      }}
      noOptionsText={failed ? 'Could not load employees' : 'No matching employees'}
      loadingText="Searching…"
      getOptionLabel={(option) => `${employeeIdentifiers(option)} — ${displayName(option)}`}
      renderOption={({ key, ...props }, option) => (
        <li key={getRowId(option) ?? key} {...props}>
          <Box>
            <Typography variant="body2">{displayName(option)}</Typography>
            <Typography variant="caption" color="text.secondary">
              {[employeeIdentifiers(option), option.departmentId?.name, option.unitId?.name].filter(Boolean).join(' · ')}
            </Typography>
          </Box>
        </li>
      )}
      isOptionEqualToValue={(option, selected) => getRowId(option) === getRowId(selected)}
      // The API already ranked the matches; re-filtering client-side would drop
      // results that matched on a field the label does not show.
      filterOptions={(items) => items}
      sx={sx}
      renderInput={(params) => (
        <TextField
          {...params}
          size={size}
          label={label}
          placeholder={placeholder}
          required={required}
          helperText={helperText}
        />
      )}
    />
  );
};

export default EmployeePicker;
