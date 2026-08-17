import { useCallback, useEffect, useRef, useState } from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import CircularProgress from '@mui/material/CircularProgress';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';

import employeeService from '@services/modules/employee.service.js';
import { getRowId, displayName, employeeIdentifiers } from '@utils/dataGrid.js';

/**
 * Employee lookup for the Documents screen.
 *
 * Local to this screen rather than a change to the shared `EmployeePicker`,
 * which the attendance, leave and payroll screens also use -- this work is
 * scoped to Employee Documents, and altering a component three other modules
 * depend on is not that. The two differ in three ways that matter here:
 *
 *   A first page is loaded as soon as the field is opened. The shared picker
 *   queries only once two characters have been typed, and `onInputChange` does
 *   not fire on open -- so the list was empty and MUI rendered its "No options"
 *   message even though the directory was full. That is the bug this fixes.
 *
 *   Typing is debounced and the responses are sequenced, so a fast typist
 *   causes one request rather than one per keystroke, and a slow early reply
 *   cannot overwrite the results of a later one.
 *
 *   The empty message says which of the three situations the reader is in:
 *   still loading, nothing matched, or the directory itself is empty.
 *
 * No status filter is applied. Documents outlive employment -- an exited
 * employee's contracts and identity proofs are exactly what HR is asked for
 * after they leave -- and in this database every employee is on PROBATION, so
 * a filter of `status=ACTIVE` would return nobody and reproduce the empty list
 * this component exists to fix.
 */

const PAGE_SIZE = 20;
const DEBOUNCE_MS = 350;

const DocumentEmployeeSelector = ({ value, onChange, disabled = false, sx = null }) => {
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [term, setTerm] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);

  /**
   * Only the newest request may write to state.
   *
   * Searches are cheap to start and arrive out of order; without this, deleting
   * a character could leave the results of the longer term on screen.
   */
  const requestId = useRef(0);

  const search = useCallback(async (value_) => {
    const id = requestId.current + 1;
    requestId.current = id;

    setLoading(true);
    setError(null);

    try {
      const response = await employeeService.list({
        search: value_ || undefined,
        limit: PAGE_SIZE,
        page: 1,
        sortBy: 'employeeCode',
        sortOrder: 'asc',
      });

      if (requestId.current !== id) return;
      setOptions(response.data ?? []);
      setLoaded(true);
    } catch (rejection) {
      if (requestId.current !== id) return;
      setOptions([]);
      setError(rejection?.message ?? 'Could not load employees');
    } finally {
      if (requestId.current === id) setLoading(false);
    }
  }, []);

  // One effect covers the first load and every subsequent search: an empty term
  // is a valid query for "the first page of the directory".
  useEffect(() => {
    const timer = setTimeout(() => search(term.trim()), term ? DEBOUNCE_MS : 0);
    return () => clearTimeout(timer);
  }, [term, search]);

  /**
   * The selected employee is always among the options.
   *
   * A search narrows the list, and once it no longer contains the current
   * selection MUI cannot match the value to an option and warns that the value
   * is invalid. Keeping it in the list costs one entry and keeps the field
   * showing who is actually selected.
   */
  const shown =
    value && !options.some((option) => getRowId(option) === getRowId(value))
      ? [value, ...options]
      : options;

  const emptyText = loading
    ? 'Loading employees…'
    : error
      ? error
      : term.trim()
        ? 'No matching employees found'
        : loaded
          ? 'No employees found'
          : 'Loading employees…';

  return (
    <Autocomplete
      options={shown}
      value={value}
      loading={loading}
      disabled={disabled}
      onChange={(_event, next) => onChange(next)}
      /**
       * Only a real edit re-queries. MUI also raises this when an option is
       * chosen and when the field is cleared on blur; treating those as
       * searches would fire a request for the selected employee's own label.
       */
      onInputChange={(_event, next, reason) => {
        if (reason === 'input') setTerm(next);
        if (reason === 'clear') setTerm('');
      }}
      getOptionLabel={(option) => `${employeeIdentifiers(option)} — ${displayName(option)}`}
      isOptionEqualToValue={(option, selected) => getRowId(option) === getRowId(selected)}
      // The API ranked and filtered these already; filtering again in the
      // browser would drop rows that matched on a field the label omits.
      filterOptions={(items) => items}
      noOptionsText={emptyText}
      loadingText="Loading employees…"
      sx={sx}
      renderOption={(props, option) => {
        const { key, ...rest } = props;
        return (
          <Box component="li" key={key} {...rest}>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" noWrap>
                {employeeIdentifiers(option)} — {displayName(option)}
              </Typography>
              {option.departmentId?.name && (
                <Typography variant="caption" color="text.secondary" noWrap>
                  {option.departmentId.name}
                  {option.designationId?.name ? ` · ${option.designationId.name}` : ''}
                </Typography>
              )}
            </Box>
          </Box>
        );
      }}
      renderInput={(params) => {
        /**
         * Autocomplete hands the input's props down in `params.slotProps.input`.
         * Older versions passed `params.InputProps`; both are read so the
         * spinner is appended to whichever the installed version supplies, and
         * neither is assumed to be there.
         */
        const inputSlotProps = params.slotProps?.input ?? params.InputProps ?? {};

        return (
          <TextField
            {...params}
            size="small"
            label="Employee"
            placeholder="Search by code or name"
            error={Boolean(error)}
            helperText={
              error ?? 'Documents are held on the employee record — pick someone to begin'
            }
            /**
             * Spread first, then override only `input`.
             *
             * `params.slotProps` also carries `htmlInput`, which holds the
             * field's actual wiring -- value, change handler, refs, ARIA --
             * and `inputLabel`. Passing a `slotProps` of our own without them
             * would replace the whole object and leave a field that renders
             * but does not type or open.
             */
            slotProps={{
              ...params.slotProps,
              input: {
                ...inputSlotProps,
                endAdornment: (
                  <>
                    {loading ? <CircularProgress size={16} /> : null}
                    {/* The clear and dropdown buttons Autocomplete supplies. */}
                    {inputSlotProps.endAdornment}
                  </>
                ),
              },
            }}
          />
        );
      }}
    />
  );
};

export default DocumentEmployeeSelector;
