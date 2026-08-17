import { useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import ArrowIcon from '@mui/icons-material/ArrowForwardOutlined';

import FormDialog from '@components/common/FormDialog.jsx';
import EmployeePicker from '@components/common/EmployeePicker.jsx';
import employeeService from '@services/modules/employee.service.js';
import { getRowId, displayName } from '@utils/dataGrid.js';

/**
 * Executes a transfer or a promotion.
 *
 * Both are a `PATCH /employees/:id` -- the movement IS the change to the
 * employee's placement, and the audit entry it writes is what the history reads
 * back. Nothing separate is recorded, so the two can never disagree.
 *
 * The difference between the two modes is only which fields are offered:
 * transfers move a person sideways, promotions move them up.
 */

const TRANSFER_FIELDS = [
  { key: 'unitId', label: 'Unit', optionsFrom: 'units' },
  { key: 'departmentId', label: 'Department', optionsFrom: 'departments' },
  { key: 'designationId', label: 'Designation', optionsFrom: 'designations' },
];

const PROMOTION_FIELDS = [
  { key: 'designationId', label: 'Designation', optionsFrom: 'designations' },
  { key: 'gradeId', label: 'Grade', optionsFrom: 'grades' },
];

const MovementDialog = ({ open, mode = 'transfer', masters = {}, onClose, onSaved }) => {
  const isPromotion = mode === 'promotion';

  const [employee, setEmployee] = useState(null);
  const [record, setRecord] = useState(null);
  const [form, setForm] = useState({});
  const [manager, setManager] = useState(null);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [loadingRecord, setLoadingRecord] = useState(false);

  const fields = isPromotion ? PROMOTION_FIELDS : TRANSFER_FIELDS;

  useEffect(() => {
    if (!open) return;

    setEmployee(null);
    setRecord(null);
    setForm({});
    setManager(null);
    setError(null);
  }, [open, mode]);

  // The current placement has to be read before it can be changed -- the form
  // shows what each field is moving from, which is the whole point of the
  // screen.
  useEffect(() => {
    if (!employee) {
      setRecord(null);
      return;
    }

    setLoadingRecord(true);

    employeeService
      .getOne(getRowId(employee))
      .then((response) => {
        setRecord(response.data);
        setForm({});
        setManager(null);
      })
      .catch((rejection) => setError(rejection?.message ?? 'Could not load the employee'))
      .finally(() => setLoadingRecord(false));
  }, [employee]);

  const currentId = (key) => {
    const value = record?.[key];
    return value ? (getRowId(value) || String(value)) : '';
  };

  const currentName = (key) => record?.[key]?.name ?? '—';

  /** Only fields that actually change are sent. */
  const payload = useMemo(() => {
    const result = {};

    fields.forEach((field) => {
      const next = form[field.key];
      if (next === undefined || next === '') return;
      if (next === currentId(field.key)) return;

      result[field.key] = next;
    });

    if (!isPromotion && manager !== null) {
      const nextManager = manager ? getRowId(manager) : null;
      if (nextManager !== currentId('reportingManagerId')) result.reportingManagerId = nextManager;
    }

    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, manager, record, isPromotion]);

  const changeCount = Object.keys(payload).length;

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);

    try {
      await employeeService.update(getRowId(employee), payload);
      onSaved(isPromotion ? 'Promotion recorded' : 'Transfer recorded');
    } catch (rejection) {
      setError(rejection?.message ?? `The ${mode} could not be saved`);
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * A promotion should move someone up. The server does not enforce this --
   * a sideways designation change is legitimate -- so this warns rather than
   * blocks, and the history will classify it honestly either way.
   */
  const levelWarning = useMemo(() => {
    if (!isPromotion || !form.designationId || !record) return null;

    const list = masters.designations ?? [];
    const from = list.find((option) => getRowId(option) === currentId('designationId'));
    const to = list.find((option) => getRowId(option) === form.designationId);

    if (!from || !to || from.level === undefined || to.level === undefined) return null;
    if (to.level > from.level) return null;

    return `${to.name} is at level ${to.level}, which is not above ${from.name} (level ${from.level}). This will be recorded as a lateral transfer, not a promotion.`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPromotion, form.designationId, record, masters.designations]);

  return (
    <FormDialog
      open={open}
      title={isPromotion ? 'Record a promotion' : 'Record a transfer'}
      subtitle={
        isPromotion
          ? 'Moves the employee up a designation or grade'
          : 'Moves the employee between units, departments, roles or reporting lines'
      }
      error={error}
      submitting={submitting}
      submitLabel={isPromotion ? 'Promote' : 'Transfer'}
      disabled={!employee || changeCount === 0}
      onSubmit={handleSubmit}
      onClose={onClose}
      maxWidth="md"
    >
      <Grid container spacing={2} sx={{ pt: 0.5 }}>
        <Grid size={12}>
          <EmployeePicker value={employee} onChange={setEmployee} label="Employee" size="medium" required />
        </Grid>

        {employee && !loadingRecord && record && (
          <>
            <Grid size={12}>
              <Divider sx={{ my: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  Current placement
                </Typography>
              </Divider>

              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Chip size="small" variant="outlined" label={`Unit: ${currentName('unitId')}`} />
                <Chip size="small" variant="outlined" label={`Department: ${currentName('departmentId')}`} />
                <Chip size="small" variant="outlined" label={`Designation: ${currentName('designationId')}`} />
                <Chip size="small" variant="outlined" label={`Grade: ${currentName('gradeId')}`} />
                <Chip
                  size="small"
                  variant="outlined"
                  label={`Reports to: ${record.reportingManagerId ? displayName(record.reportingManagerId) : '—'}`}
                />
              </Stack>
            </Grid>

            <Grid size={12}>
              <Divider sx={{ my: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  Move to
                </Typography>
              </Divider>
            </Grid>

            {fields.map((field) => (
              <Grid key={field.key} size={{ xs: 12, sm: 6 }}>
                <TextField
                  select
                  size="small"
                  fullWidth
                  label={field.label}
                  value={form[field.key] ?? ''}
                  onChange={(event) =>
                    setForm((previous) => ({ ...previous, [field.key]: event.target.value }))
                  }
                  helperText={`Currently ${currentName(field.key)}`}
                >
                  <MenuItem value="">
                    <em>No change</em>
                  </MenuItem>
                  {(masters[field.optionsFrom] ?? []).map((option) => (
                    <MenuItem key={getRowId(option)} value={getRowId(option)}>
                      {option.name}
                      {option.level !== undefined ? ` (level ${option.level})` : ''}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
            ))}

            {!isPromotion && (
              <Grid size={{ xs: 12, sm: 6 }}>
                <EmployeePicker
                  value={manager}
                  onChange={setManager}
                  label="Reporting manager"
                  helperText={`Currently ${record.reportingManagerId ? displayName(record.reportingManagerId) : 'not set'}`}
                />
              </Grid>
            )}

            {levelWarning && (
              <Grid size={12}>
                <Alert severity="warning">{levelWarning}</Alert>
              </Grid>
            )}

            {changeCount > 0 && (
              <Grid size={12}>
                <Alert severity="info" icon={<ArrowIcon fontSize="small" />}>
                  {changeCount} field(s) will change. The movement is recorded in the audit trail and appears
                  in the history immediately.
                </Alert>
              </Grid>
            )}

            {!isPromotion && (
              <Grid size={12}>
                <Typography variant="caption" color="text.secondary">
                  A reporting line that would create a loop is refused by the server.
                </Typography>
              </Grid>
            )}
          </>
        )}

        {employee && loadingRecord && (
          <Grid size={12}>
            <Typography variant="body2" color="text.secondary">
              Loading current placement…
            </Typography>
          </Grid>
        )}
      </Grid>
    </FormDialog>
  );
};

export default MovementDialog;
