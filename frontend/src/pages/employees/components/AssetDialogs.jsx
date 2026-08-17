import { useEffect, useState } from 'react';
import Grid from '@mui/material/Grid';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import FormDialog from '@components/common/FormDialog.jsx';
import EmployeePicker from '@components/common/EmployeePicker.jsx';
import CurrencyAdornment from '@components/common/CurrencyAdornment.jsx';
import payrollService from '@services/modules/payroll.service.js';
import { humanize } from '@utils/format.js';
import { getRowId, displayName } from '@utils/dataGrid.js';

/** Mirrors ASSET_CATEGORY / ASSET_CONDITION in backend/utils/constants.js. */
export const ASSET_CATEGORIES = [
  'LAPTOP',
  'DESKTOP',
  'MOBILE',
  'SIM',
  'ACCESS_CARD',
  'VEHICLE',
  'FURNITURE',
  'TOOL',
  'OTHER',
];

export const ASSET_CONDITIONS = ['NEW', 'GOOD', 'FAIR', 'DAMAGED', 'UNUSABLE'];

const today = () => new Date().toISOString().slice(0, 10);

const EMPTY_ASSET = {
  assetCode: '',
  name: '',
  category: 'LAPTOP',
  serialNumber: '',
  make: '',
  model: '',
  purchaseDate: '',
  purchaseCost: '',
  recoveryValue: '',
  condition: 'NEW',
  notes: '',
};

/**
 * Add an item to the asset register.
 *
 * `assetCode` is optional -- the server generates one when it is left blank,
 * and duplicating that rule in the browser would let the two drift.
 */
export const AssetFormDialog = ({ open, onClose, onSaved }) => {
  const [form, setForm] = useState(EMPTY_ASSET);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(EMPTY_ASSET);
      setError(null);
    }
  }, [open]);

  const set = (field) => (event) => setForm((previous) => ({ ...previous, [field]: event.target.value }));

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);

    try {
      // Empty strings are dropped rather than sent: the validator allows null
      // for the optional fields but rejects an empty date.
      await payrollService.createAsset({
        ...(form.assetCode.trim() ? { assetCode: form.assetCode.trim().toUpperCase() } : {}),
        name: form.name.trim(),
        category: form.category,
        serialNumber: form.serialNumber.trim() || null,
        make: form.make.trim() || null,
        model: form.model.trim() || null,
        ...(form.purchaseDate ? { purchaseDate: form.purchaseDate } : {}),
        purchaseCost: Number(form.purchaseCost) || 0,
        recoveryValue: Number(form.recoveryValue) || 0,
        condition: form.condition,
        notes: form.notes.trim() || null,
      });

      onSaved('Asset added to the register');
    } catch (rejection) {
      setError(rejection?.message ?? 'The asset could not be saved');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <FormDialog
      open={open}
      title="Add asset"
      subtitle="Company property that can be issued to an employee"
      error={error}
      submitting={submitting}
      submitLabel="Add asset"
      disabled={form.name.trim().length < 2}
      onSubmit={handleSubmit}
      onClose={onClose}
      maxWidth="md"
    >
      <Grid container spacing={2} sx={{ pt: 0.5 }}>
        <Grid size={{ xs: 12, sm: 8 }}>
          <TextField label="Name" value={form.name} onChange={set('name')} fullWidth required autoFocus />
        </Grid>

        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField
            label="Asset code"
            value={form.assetCode}
            onChange={set('assetCode')}
            fullWidth
            helperText="Leave blank to generate"
          />
        </Grid>

        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField select label="Category" value={form.category} onChange={set('category')} fullWidth>
            {ASSET_CATEGORIES.map((category) => (
              <MenuItem key={category} value={category}>
                {humanize(category)}
              </MenuItem>
            ))}
          </TextField>
        </Grid>

        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField label="Make" value={form.make} onChange={set('make')} fullWidth />
        </Grid>

        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField label="Model" value={form.model} onChange={set('model')} fullWidth />
        </Grid>

        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField label="Serial number" value={form.serialNumber} onChange={set('serialNumber')} fullWidth />
        </Grid>

        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            select
            label="Condition"
            value={form.condition}
            onChange={set('condition')}
            fullWidth
          >
            {ASSET_CONDITIONS.map((condition) => (
              <MenuItem key={condition} value={condition}>
                {humanize(condition)}
              </MenuItem>
            ))}
          </TextField>
        </Grid>

        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField
            label="Purchase date"
            type="date"
            value={form.purchaseDate}
            onChange={set('purchaseDate')}
            fullWidth
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </Grid>

        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField
            label="Purchase cost"
            type="number"
            value={form.purchaseCost}
            onChange={set('purchaseCost')}
            fullWidth
            slotProps={{
              input: {
                startAdornment: <CurrencyAdornment />,
                inputProps: { min: 0 },
              },
            }}
          />
        </Grid>

        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField
            label="Recovery value"
            type="number"
            value={form.recoveryValue}
            onChange={set('recoveryValue')}
            fullWidth
            helperText="Charged on exit if not returned"
            slotProps={{
              input: {
                startAdornment: <CurrencyAdornment />,
                inputProps: { min: 0 },
              },
            }}
          />
        </Grid>

        <Grid size={12}>
          <TextField label="Notes" value={form.notes} onChange={set('notes')} fullWidth multiline rows={2} />
        </Grid>
      </Grid>
    </FormDialog>
  );
};

/** Issue an available asset to someone. */
export const AssetAssignDialog = ({ open, asset, onClose, onSaved }) => {
  const [employee, setEmployee] = useState(null);
  const [form, setForm] = useState({ assignedOn: today(), condition: 'GOOD', remarks: '' });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setEmployee(null);
      setForm({ assignedOn: today(), condition: asset?.condition ?? 'GOOD', remarks: '' });
      setError(null);
    }
  }, [open, asset]);

  const set = (field) => (event) => setForm((previous) => ({ ...previous, [field]: event.target.value }));

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);

    try {
      await payrollService.assignAsset(getRowId(asset), {
        employeeId: getRowId(employee),
        assignedOn: form.assignedOn,
        condition: form.condition,
        remarks: form.remarks.trim() || null,
      });

      onSaved(`${asset.name} issued to ${displayName(employee)}`);
    } catch (rejection) {
      setError(rejection?.message ?? 'The asset could not be assigned');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <FormDialog
      open={open}
      title="Issue asset"
      subtitle={asset ? `${asset.assetCode} — ${asset.name}` : ''}
      error={error}
      submitting={submitting}
      submitLabel="Issue"
      disabled={!employee}
      onSubmit={handleSubmit}
      onClose={onClose}
    >
      <Grid container spacing={2} sx={{ pt: 0.5 }}>
        <Grid size={12}>
          <EmployeePicker value={employee} onChange={setEmployee} label="Issue to" size="medium" required />
        </Grid>

        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            label="Issued on"
            type="date"
            value={form.assignedOn}
            onChange={set('assignedOn')}
            fullWidth
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </Grid>

        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField select label="Condition on issue" value={form.condition} onChange={set('condition')} fullWidth>
            {ASSET_CONDITIONS.map((condition) => (
              <MenuItem key={condition} value={condition}>
                {humanize(condition)}
              </MenuItem>
            ))}
          </TextField>
        </Grid>

        <Grid size={12}>
          <TextField label="Remarks" value={form.remarks} onChange={set('remarks')} fullWidth multiline rows={2} />
        </Grid>
      </Grid>
    </FormDialog>
  );
};

/** Take an asset back, optionally recovering a cost for damage. */
export const AssetReturnDialog = ({ open, asset, onClose, onSaved }) => {
  const [form, setForm] = useState({ returnedOn: today(), condition: 'GOOD', recoveryAmount: '', remarks: '' });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({ returnedOn: today(), condition: 'GOOD', recoveryAmount: '', remarks: '' });
      setError(null);
    }
  }, [open]);

  const set = (field) => (event) => setForm((previous) => ({ ...previous, [field]: event.target.value }));

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);

    try {
      await payrollService.returnAsset(getRowId(asset), {
        returnedOn: form.returnedOn,
        condition: form.condition,
        recoveryAmount: Number(form.recoveryAmount) || 0,
        remarks: form.remarks.trim() || null,
      });

      onSaved(`${asset.name} returned to stock`);
    } catch (rejection) {
      setError(rejection?.message ?? 'The return could not be recorded');
    } finally {
      setSubmitting(false);
    }
  };

  const damaged = ['DAMAGED', 'UNUSABLE'].includes(form.condition);

  return (
    <FormDialog
      open={open}
      title="Return asset"
      subtitle={asset ? `${asset.assetCode} — ${asset.name}` : ''}
      error={error}
      submitting={submitting}
      submitLabel="Record return"
      onSubmit={handleSubmit}
      onClose={onClose}
    >
      <Grid container spacing={2} sx={{ pt: 0.5 }}>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            label="Returned on"
            type="date"
            value={form.returnedOn}
            onChange={set('returnedOn')}
            fullWidth
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </Grid>

        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField select label="Condition on return" value={form.condition} onChange={set('condition')} fullWidth>
            {ASSET_CONDITIONS.map((condition) => (
              <MenuItem key={condition} value={condition}>
                {humanize(condition)}
              </MenuItem>
            ))}
          </TextField>
        </Grid>

        <Grid size={12}>
          <TextField
            label="Recovery amount"
            type="number"
            value={form.recoveryAmount}
            onChange={set('recoveryAmount')}
            fullWidth
            helperText={
              damaged
                ? 'Deducted from the final settlement if the employee is exiting'
                : 'Usually zero for an undamaged return'
            }
            slotProps={{
              input: {
                startAdornment: <CurrencyAdornment />,
                inputProps: { min: 0 },
              },
            }}
          />
        </Grid>

        <Grid size={12}>
          <TextField label="Remarks" value={form.remarks} onChange={set('remarks')} fullWidth multiline rows={2} />
        </Grid>
      </Grid>
    </FormDialog>
  );
};

/** Write an asset off as lost. Approval-grade on the server. */
export const AssetLostDialog = ({ open, asset, onClose, onSaved }) => {
  const [form, setForm] = useState({ recoveryAmount: '', remarks: '' });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({ recoveryAmount: String(asset?.recoveryValue ?? ''), remarks: '' });
      setError(null);
    }
  }, [open, asset]);

  const set = (field) => (event) => setForm((previous) => ({ ...previous, [field]: event.target.value }));

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);

    try {
      await payrollService.markAssetLost(getRowId(asset), {
        recoveryAmount: Number(form.recoveryAmount) || 0,
        remarks: form.remarks.trim() || null,
      });

      onSaved(`${asset.name} written off`);
    } catch (rejection) {
      setError(rejection?.message ?? 'The write-off could not be recorded');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <FormDialog
      open={open}
      title="Write off as lost"
      subtitle={asset ? `${asset.assetCode} — ${asset.name}` : ''}
      error={error}
      submitting={submitting}
      submitLabel="Write off"
      submitColor="error"
      onSubmit={handleSubmit}
      onClose={onClose}
    >
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        The asset leaves the available register. Any recovery amount is charged to the holder&apos;s final
        settlement.
      </Typography>

      <Grid container spacing={2}>
        <Grid size={12}>
          <TextField
            label="Recovery amount"
            type="number"
            value={form.recoveryAmount}
            onChange={set('recoveryAmount')}
            fullWidth
            slotProps={{
              input: {
                startAdornment: <CurrencyAdornment />,
                inputProps: { min: 0 },
              },
            }}
          />
        </Grid>

        <Grid size={12}>
          <TextField label="Remarks" value={form.remarks} onChange={set('remarks')} fullWidth multiline rows={2} />
        </Grid>
      </Grid>
    </FormDialog>
  );
};

export default { AssetFormDialog, AssetAssignDialog, AssetReturnDialog, AssetLostDialog };
