import { useEffect, useMemo, useState } from 'react';
import Chip from '@mui/material/Chip';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import FormDialog from '@components/common/FormDialog.jsx';
import CurrencyAdornment from '@components/common/CurrencyAdornment.jsx';
import organizationService from '@services/modules/organization.service.js';
import { ORGANIZATION_MASTERS, emptyForm } from '@config/organizationMasters.js';
import { getRowId } from '@utils/dataGrid.js';

/**
 * Add and edit for every organization master.
 *
 * The form is generated from the descriptor in config/organizationMasters.js,
 * so a new field on a master is one line of data rather than a new dialog. Only
 * fields the descriptor declares are ever submitted -- the server rejects
 * unknown keys, and this is the near half of that same rule.
 */
const MasterFormDialog = ({ open, master, record = null, options = {}, onClose, onSaved }) => {
  const config = ORGANIZATION_MASTERS[master];

  const [form, setForm] = useState({});
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const editing = Boolean(record);

  useEffect(() => {
    if (!open || !config) return;

    setError(null);
    setFieldErrors({});

    if (!record) {
      setForm(emptyForm(master));
      return;
    }

    // Seeded from the record so only what changes has to be retyped. Populated
    // references arrive as objects; the form needs their id.
    setForm(
      Object.fromEntries(
        config.fields.map((field) => {
          const value = record[field.key];

          if (field.type === 'switch') return [field.key, Boolean(value)];
          if (field.type === 'days') return [field.key, value ?? []];
          if (field.type === 'select') return [field.key, value ? getRowId(value) || String(value) : ''];

          return [field.key, value ?? ''];
        }),
      ),
    );
  }, [open, master, record, config]);

  const set = (field) => (event) => {
    const raw = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    const value = field.uppercase && typeof raw === 'string' ? raw.toUpperCase() : raw;

    setForm((previous) => ({ ...previous, [field.key]: value }));
    setFieldErrors((previous) => ({ ...previous, [field.key]: undefined }));
  };

  const toggleDay = (fieldKey, day) => () =>
    setForm((previous) => {
      const current = new Set(previous[fieldKey] ?? []);
      if (current.has(day)) current.delete(day);
      else current.add(day);
      return { ...previous, [fieldKey]: [...current].sort() };
    });

  /**
   * Only declared, meaningful fields are sent.
   *
   * A blank optional text field goes as `null`, not `""` -- an empty string
   * would be stored as a value, and "" is not the same as "not set" when the
   * next screen renders it.
   */
  const payload = useMemo(() => {
    if (!config) return {};

    const result = {};

    config.fields.forEach((field) => {
      const value = form[field.key];

      if (field.type === 'switch') {
        result[field.key] = Boolean(value);
        return;
      }

      if (field.type === 'days') {
        result[field.key] = value ?? [];
        return;
      }

      if (field.type === 'number' || field.type === 'money') {
        if (value === '' || value === null || value === undefined) return;
        result[field.key] = Number(value);
        return;
      }

      const text = typeof value === 'string' ? value.trim() : value;

      if (field.required) result[field.key] = text;
      else result[field.key] = text === '' || text === undefined ? null : text;
    });

    return result;
  }, [form, config]);

  const handleSubmit = async () => {
    const localErrors = config.validate?.(form) ?? null;

    if (localErrors) {
      setFieldErrors(localErrors);
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      if (editing) await organizationService.updateMaster(master, getRowId(record), payload);
      else await organizationService.createMaster(master, payload);

      onSaved(`${config.label} ${editing ? 'updated' : 'created'}`);
    } catch (rejection) {
      // The server reports field-level problems; surfacing them on the inputs
      // beats a banner that makes the user hunt for which one is wrong.
      if (Array.isArray(rejection?.details)) {
        setFieldErrors(
          Object.fromEntries(rejection.details.map((detail) => [detail.field, detail.message])),
        );
      }

      setError(rejection?.message ?? `The ${config.label.toLowerCase()} could not be saved`);
    } finally {
      setSubmitting(false);
    }
  };

  if (!config) return null;

  const incomplete = config.fields.some(
    (field) => field.required && !String(form[field.key] ?? '').trim(),
  );

  const renderField = (field) => {
    const common = {
      label: field.label,
      value: form[field.key] ?? '',
      onChange: set(field),
      fullWidth: true,
      size: 'small',
      required: field.required,
      error: Boolean(fieldErrors[field.key]),
      helperText: fieldErrors[field.key] ?? field.help,
    };

    if (field.type === 'switch') {
      return (
        <Stack>
          <FormControlLabel
            control={<Switch checked={Boolean(form[field.key])} onChange={set(field)} />}
            label={field.label}
          />
          {field.help && (
            <Typography variant="caption" color="text.secondary" sx={{ ml: 6, mt: -0.5 }}>
              {field.help}
            </Typography>
          )}
        </Stack>
      );
    }

    if (field.type === 'days') {
      return (
        <Stack spacing={0.5}>
          <Typography variant="caption" color="text.secondary">
            {field.label}
          </Typography>
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
            {field.options.map((day) => {
              const selected = (form[field.key] ?? []).includes(day.value);

              return (
                <Chip
                  key={day.value}
                  label={day.label.slice(0, 3)}
                  size="small"
                  color={selected ? 'primary' : 'default'}
                  variant={selected ? 'filled' : 'outlined'}
                  onClick={toggleDay(field.key, day.value)}
                />
              );
            })}
          </Stack>
        </Stack>
      );
    }

    if (field.type === 'select') {
      const list = options[field.optionsFrom] ?? [];

      return (
        <TextField {...common} select>
          <MenuItem value="">
            <em>None</em>
          </MenuItem>
          {list
            // A record cannot be its own parent; offering it guarantees an error.
            .filter((option) => !editing || getRowId(option) !== getRowId(record))
            .map((option) => (
              <MenuItem key={getRowId(option)} value={getRowId(option)}>
                {option.name}
              </MenuItem>
            ))}
        </TextField>
      );
    }

    if (field.type === 'time') {
      return <TextField {...common} type="time" slotProps={{ inputLabel: { shrink: true } }} />;
    }

    if (field.type === 'money') {
      return (
        <TextField
          {...common}
          type="number"
          slotProps={{
            input: {
              startAdornment: <CurrencyAdornment />,
              inputProps: { min: 0 },
            },
          }}
        />
      );
    }

    if (field.type === 'number') {
      return (
        <TextField
          {...common}
          type="number"
          slotProps={{ input: { inputProps: { min: field.min, max: field.max } } }}
        />
      );
    }

    if (field.type === 'textarea') {
      return <TextField {...common} multiline rows={2} slotProps={{ htmlInput: { maxLength: field.maxLength } }} />;
    }

    return <TextField {...common} slotProps={{ htmlInput: { maxLength: field.maxLength } }} />;
  };

  return (
    <FormDialog
      open={open}
      title={editing ? `Edit ${config.label.toLowerCase()}` : `Add ${config.label.toLowerCase()}`}
      subtitle={editing ? record?.name : config.subtitle}
      error={error}
      submitting={submitting}
      submitLabel={editing ? 'Save changes' : `Add ${config.label.toLowerCase()}`}
      disabled={incomplete}
      onSubmit={handleSubmit}
      onClose={onClose}
      maxWidth="md"
    >
      <Grid container spacing={2} sx={{ pt: 0.5 }}>
        {config.fields.map((field) => (
          <Grid key={field.key} size={{ xs: 12, sm: field.width >= 8 ? 12 : 6, md: field.width ?? 6 }}>
            {renderField(field)}
          </Grid>
        ))}
      </Grid>
    </FormDialog>
  );
};

export default MasterFormDialog;
