import { useState } from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';

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

  const search = async (term) => {
    // Two characters is where the result set stops being the whole directory.
    if (!term || term.length < 2) return;

    setLoading(true);
    try {
      const response = await employeeService.list({ search: term, limit: 20 });
      setOptions(response.data ?? []);
    } catch {
      setOptions([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Autocomplete
      options={options}
      value={value}
      loading={loading}
      disabled={disabled}
      onChange={(_event, next) => onChange(next)}
      onInputChange={(_event, term) => search(term)}
      getOptionLabel={(option) => `${employeeIdentifiers(option)} — ${displayName(option)}`}
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
