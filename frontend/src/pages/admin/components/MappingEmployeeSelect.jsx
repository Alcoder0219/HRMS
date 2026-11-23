import { useEffect, useMemo, useRef, useState } from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';

import employeeService from '@services/modules/employee.service.js';
import { employeeName, matchesPhrase, serverSearchTerm } from '@utils/employeeSearch.js';

/**
 * The Employee picker of the Map Users dialog.
 *
 * It used to be a plain select over one request for the first 200 employees --
 * the employee list's largest page -- so everyone after the 200th by code
 * (about EMP00215) could never be chosen. Now it pages through the same
 * employee list API on demand:
 *
 *   - opened with nothing typed, it lists employees by code, 50 at a time,
 *     loading the next 50 as the list is scrolled to its end;
 *   - typing searches the server by employee code, employee ID or name, with
 *     the same paging, after a short pause.
 *
 * Its value is an employee code, as the mapping stores it. `known` names the
 * employee behind an already-saved code, so a mapping to someone on any page
 * reads correctly when the dialog is reopened.
 */

const PAGE_SIZE = 50;
const DEBOUNCE_MS = 300;

const labelOf = (employee) => (employee ? `${employee.employeeCode} — ${employeeName(employee)}`.replace(/ — $/, '') : '');

// A full name ("Abdalla Ali") is searched by its first word, then narrowed.
const serverTerm = serverSearchTerm;

const MappingEmployeeSelect = ({ value, known = null, onChange, error = false }) => {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [term, setTerm] = useState('');
  const [options, setOptions] = useState([]);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const request = useRef(0);

  // The search follows the typing after a pause, not on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setTerm(input), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input]);

  const load = async (nextPage, searchTerm, append) => {
    const id = (request.current += 1);
    setLoading(true);
    setFailed(false);
    try {
      const response = await employeeService.list({
        page: nextPage,
        limit: PAGE_SIZE,
        sortBy: 'employeeCode',
        sortOrder: 'asc',
        ...(serverTerm(searchTerm) ? { search: serverTerm(searchTerm) } : {}),
      });
      if (id !== request.current) return; // a newer search has started
      const rows = response.data ?? [];
      setOptions((previous) => {
        const merged = append ? [...previous, ...rows] : rows;
        // One option per employee, however the pages overlap.
        return [...new Map(merged.map((employee) => [employee.employeeCode, employee])).values()];
      });
      setPage(nextPage);
      setTotal(response.meta?.total ?? rows.length);
    } catch {
      if (id === request.current) {
        setFailed(true);
        if (!append) setOptions([]);
      }
    } finally {
      if (id === request.current) setLoading(false);
    }
  };

  // A fresh first page whenever the list opens or the search changes.
  useEffect(() => {
    if (open) load(1, term, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, term]);

  const hasMore = options.length < total && page * PAGE_SIZE < total;

  /** The selected employee, as an option: from the loaded page, or the saved mapping. */
  const selected = useMemo(() => {
    if (!value) return null;
    return options.find((employee) => employee.employeeCode === value) ?? (known?.employeeCode === value ? known : { employeeCode: value });
  }, [value, options, known]);

  const shown = useMemo(() => options.filter((employee) => matchesPhrase(employee, term)), [options, term]);

  return (
    <Autocomplete
      size="small"
      fullWidth
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      value={selected}
      // The selected employee is always an option, so it never reads as invalid.
      options={selected && !shown.some((employee) => employee.employeeCode === selected.employeeCode) ? [selected, ...shown] : shown}
      loading={loading}
      getOptionLabel={labelOf}
      isOptionEqualToValue={(option, chosen) => option.employeeCode === chosen.employeeCode}
      // The server already searched; filtering again here would drop matches on
      // fields the label does not show.
      filterOptions={(items) => items}
      onChange={(_event, next) => onChange(next?.employeeCode ?? '')}
      inputValue={open ? input : labelOf(selected)}
      onInputChange={(_event, next, reason) => {
        if (reason === 'input') setInput(next);
        if (reason === 'clear' || reason === 'reset') setInput('');
      }}
      noOptionsText={failed ? 'Employees could not be loaded — try again' : term ? 'No employee matches' : 'No employees'}
      slotProps={{
        listbox: {
          onScroll: (event) => {
            const list = event.currentTarget;
            if (!loading && hasMore && list.scrollTop + list.clientHeight >= list.scrollHeight - 40) {
              load(page + 1, term, true);
            }
          },
        },
      }}
      renderOption={(props, employee) => {
        // React keys cannot be spread; the code is unique per employee.
        // eslint-disable-next-line no-unused-vars
        const { key, ...rest } = props;
        return (
          <li key={employee.employeeCode} {...rest}>
            {labelOf(employee)}
          </li>
        );
      }}
      // `loading` above shows the "Loading…" row while a page is fetched.
      loadingText="Loading employees…"
      renderInput={(params) => (
        <TextField {...params} placeholder="Not mapped — search by code, ID or name" error={error} />
      )}
    />
  );
};

export default MappingEmployeeSelect;
