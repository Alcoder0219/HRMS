import { useEffect, useState } from 'react';
import Chip from '@mui/material/Chip';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';

import { useAppDispatch, useAppSelector } from '@hooks/useRedux.js';
import { fetchMasters, selectMasters } from '@redux/slices/employeeSlice.js';
import leaveService from '@services/modules/leave.service.js';
import recruitmentService from '@services/modules/recruitment.service.js';
import { humanize } from '@utils/format.js';
import { getRowId } from '@utils/dataGrid.js';

/**
 * Filter controls built from the server's filter descriptors.
 *
 * The report says what it can be filtered by; this renders the matching
 * control. A new filter on the server therefore appears here with no frontend
 * change, which is the whole reason the descriptors travel with the report.
 *
 * The option sources that need their own request -- leave types, job openings
 * -- are fetched once and only when a report actually asks for them.
 */

const YEARS = (() => {
  const current = new Date().getFullYear();
  return Array.from({ length: 6 }, (_, index) => current - index);
})();

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const ReportFilters = ({ filters = [], values = {}, onChange, onReset }) => {
  const dispatch = useAppDispatch();
  const masters = useAppSelector(selectMasters);

  const [leaveTypes, setLeaveTypes] = useState([]);
  const [jobOpenings, setJobOpenings] = useState([]);

  const kinds = filters.map((filter) => filter.type);
  const needsMasters = kinds.includes('department') || kinds.includes('unit');
  const needsLeaveTypes = kinds.includes('leaveType');
  const needsJobs = kinds.includes('jobOpening');

  useEffect(() => {
    if (needsMasters) dispatch(fetchMasters());
  }, [dispatch, needsMasters]);

  useEffect(() => {
    if (!needsLeaveTypes) return;

    leaveService
      .listTypes({ limit: 100 })
      .then((response) => setLeaveTypes(response.data ?? []))
      .catch(() => setLeaveTypes([]));
  }, [needsLeaveTypes]);

  useEffect(() => {
    if (!needsJobs) return;

    recruitmentService
      .listJobs({ limit: 100 })
      .then((response) => setJobOpenings(response.data ?? []))
      .catch(() => setJobOpenings([]));
  }, [needsJobs]);

  const set = (key) => (event) => onChange(key, event.target.value);

  const optionsFor = (filter) => {
    if (filter.type === 'department') return masters?.departments ?? [];
    if (filter.type === 'unit') return masters?.units ?? [];
    if (filter.type === 'leaveType') return leaveTypes;
    if (filter.type === 'jobOpening') return jobOpenings;
    return [];
  };

  const applied = filters.filter((filter) => values[filter.key] !== undefined && values[filter.key] !== '');

  const renderControl = (filter) => {
    if (filter.type === 'date') {
      return (
        <TextField
          key={filter.key}
          size="small"
          type="date"
          label={filter.label}
          value={values[filter.key] ?? ''}
          onChange={set(filter.key)}
          slotProps={{ inputLabel: { shrink: true } }}
          sx={{ width: 175 }}
        />
      );
    }

    if (filter.type === 'year') {
      return (
        <TextField
          key={filter.key}
          select
          size="small"
          label={filter.label}
          value={values[filter.key] ?? ''}
          onChange={set(filter.key)}
          sx={{ width: 120 }}
        >
          <MenuItem value="">Current</MenuItem>
          {/* Strings, not numbers: these values round-trip through the URL, and
              a numeric option would never match the string coming back. */}
          {YEARS.map((year) => (
            <MenuItem key={year} value={String(year)}>
              {year}
            </MenuItem>
          ))}
        </TextField>
      );
    }

    if (filter.type === 'month') {
      return (
        <TextField
          key={filter.key}
          select
          size="small"
          label={filter.label}
          value={values[filter.key] ?? ''}
          onChange={set(filter.key)}
          sx={{ width: 150 }}
        >
          <MenuItem value="">Current</MenuItem>
          {MONTHS.map((month, index) => (
            <MenuItem key={month} value={String(index + 1)}>
              {month}
            </MenuItem>
          ))}
        </TextField>
      );
    }

    if (filter.type === 'select') {
      return (
        <TextField
          key={filter.key}
          select
          size="small"
          label={filter.label}
          value={values[filter.key] ?? ''}
          onChange={set(filter.key)}
          sx={{ width: 190 }}
        >
          <MenuItem value="">All</MenuItem>
          {(filter.options ?? []).map((option) => (
            <MenuItem key={option.value} value={option.value}>
              {humanize(option.label)}
            </MenuItem>
          ))}
        </TextField>
      );
    }

    // The remaining kinds are all "pick a record", differing only in source.
    const records = optionsFor(filter);

    return (
      <TextField
        key={filter.key}
        select
        size="small"
        label={filter.label}
        value={values[filter.key] ?? ''}
        onChange={set(filter.key)}
        sx={{ width: 210 }}
        disabled={records.length === 0}
        helperText={records.length === 0 ? 'None available' : undefined}
      >
        <MenuItem value="">All</MenuItem>
        {records.map((record) => (
          <MenuItem key={getRowId(record)} value={getRowId(record)}>
            {record.name ?? record.title}
          </MenuItem>
        ))}
      </TextField>
    );
  };

  return (
    <Stack spacing={1.5} sx={{ mb: 2 }} data-print="hide">
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="flex-start">
        {filters.map(renderControl)}
      </Stack>

      {applied.length > 0 && (
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
          <Chip label={`${applied.length} filter(s) applied`} size="small" color="primary" variant="outlined" />
          <Chip label="Clear all" size="small" onClick={onReset} />
        </Stack>
      )}
    </Stack>
  );
};

export default ReportFilters;
