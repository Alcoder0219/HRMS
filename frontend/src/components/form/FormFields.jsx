import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

/**
 * The field primitives every form in the product is built from.
 *
 * They exist to settle the decisions that were being made independently on
 * each screen and drifting apart: size, whether a date label shrinks, how an
 * error message is surfaced, what an empty select option says. The API is
 * deliberately thin -- these wrap MUI rather than replacing it, and anything
 * they do not cover is passed straight through.
 *
 * All of them take the same three props, so a form can be written without
 * looking any of them up:
 *
 *   value, onChange(value), error
 *
 * `onChange` reports the VALUE, not the event. Every call site was writing
 * `event.target.value` and a checkbox was the one that got it wrong.
 */

const shared = ({ label, error, helperText, required, disabled, size = 'small', fullWidth = true }) => ({
  label,
  required,
  disabled,
  size,
  fullWidth,
  error: Boolean(error),
  // The error replaces the hint rather than sitting under it: two lines of
  // small text below a field is where nobody reads either.
  helperText: error || helperText || undefined,
});

export const FormTextField = ({
  value,
  onChange,
  type = 'text',
  multiline = false,
  rows = 3,
  prefix = null,
  suffix = null,
  placeholder = null,
  autoFocus = false,
  inputProps = null,
  ...rest
}) => (
  <TextField
    {...shared(rest)}
    type={type}
    value={value ?? ''}
    onChange={(event) => onChange?.(event.target.value)}
    multiline={multiline}
    rows={multiline ? rows : undefined}
    placeholder={placeholder ?? undefined}
    autoFocus={autoFocus}
    slotProps={{
      input: {
        startAdornment: prefix ? <InputAdornment position="start">{prefix}</InputAdornment> : undefined,
        endAdornment: suffix ? <InputAdornment position="end">{suffix}</InputAdornment> : undefined,
        ...inputProps,
      },
    }}
  />
);

/**
 * A number field that reports numbers.
 *
 * `<input type="number">` yields a string, and every screen doing arithmetic on
 * it was coercing separately -- or forgetting to, which is how a total became
 * "1000500" instead of 1500. An empty box reports null, not 0: "not entered"
 * and "zero" are different answers.
 */
export const FormNumberField = ({ value, onChange, min = null, max = null, step = null, ...rest }) => (
  <FormTextField
    {...rest}
    type="number"
    value={value ?? ''}
    onChange={(raw) => onChange?.(raw === '' ? null : Number(raw))}
    inputProps={{ min: min ?? undefined, max: max ?? undefined, step: step ?? undefined }}
  />
);

/**
 * Date input with the label always shrunk.
 *
 * A native date input is never visually empty -- it shows dd/mm/yyyy -- so a
 * floating label overlaps its own placeholder. This was being fixed by hand on
 * roughly thirty fields, and missed on several.
 */
export const FormDateField = ({ value, onChange, min = null, max = null, ...rest }) => (
  <TextField
    {...shared(rest)}
    type="date"
    value={value ?? ''}
    onChange={(event) => onChange?.(event.target.value)}
    slotProps={{
      inputLabel: { shrink: true },
      htmlInput: { min: min ?? undefined, max: max ?? undefined },
    }}
  />
);

/**
 * A select over `[{ value, label }]` or over plain strings.
 *
 * `emptyLabel` renders the "no filter" option. Passing null omits it, which is
 * what a required field wants.
 */
export const FormSelect = ({ value, onChange, options = [], emptyLabel = 'All', renderOption = null, ...rest }) => {
  const normalised = options.map((option) =>
    typeof option === 'string' ? { value: option, label: option } : option,
  );

  return (
    <TextField
      {...shared(rest)}
      select
      value={value ?? ''}
      onChange={(event) => onChange?.(event.target.value)}
    >
      {emptyLabel !== null && <MenuItem value="">{emptyLabel}</MenuItem>}

      {normalised.map((option) => (
        <MenuItem key={option.value} value={option.value} disabled={option.disabled}>
          {renderOption ? renderOption(option) : option.label}
        </MenuItem>
      ))}
    </TextField>
  );
};

export const FormSwitch = ({ value, onChange, label, caption = null, disabled = false }) => (
  <FormControlLabel
    disabled={disabled}
    sx={{ alignItems: caption ? 'flex-start' : 'center', ml: 0 }}
    control={<Switch checked={Boolean(value)} onChange={(event) => onChange?.(event.target.checked)} />}
    label={
      caption ? (
        <Box>
          <Typography variant="body2">{label}</Typography>
          <Typography variant="caption" color="text.secondary">
            {caption}
          </Typography>
        </Box>
      ) : (
        label
      )
    }
  />
);

export const FormCheckbox = ({ value, onChange, label, disabled = false }) => (
  <FormControlLabel
    disabled={disabled}
    control={<Checkbox checked={Boolean(value)} onChange={(event) => onChange?.(event.target.checked)} />}
    label={label}
  />
);

/**
 * A titled group of fields.
 *
 * Long forms were being split with bare Typography and inconsistent spacing.
 * This makes the grouping structural, so every settings screen reads the same.
 */
export const FormSection = ({ title, caption = null, children, actions = null }) => (
  <Card variant="outlined">
    <CardContent>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: caption ? 0.5 : 2 }}>
        <Typography variant="subtitle1">{title}</Typography>
        {actions}
      </Box>

      {caption && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
          {caption}
        </Typography>
      )}

      <Grid container spacing={2}>
        {children}
      </Grid>
    </CardContent>
  </Card>
);

/**
 * One field's slot in a `FormSection` grid.
 *
 * `span` is in twelfths at `md` and above; below that every field is full width,
 * because a half-width text input on a phone is unusable and every screen was
 * re-deriving the same breakpoints.
 */
export const FormRow = ({ span = 6, children }) => (
  <Grid size={{ xs: 12, sm: span >= 6 ? 12 : 6, md: span }}>{children}</Grid>
);

export default {
  FormTextField,
  FormNumberField,
  FormDateField,
  FormSelect,
  FormSwitch,
  FormCheckbox,
  FormSection,
  FormRow,
};
