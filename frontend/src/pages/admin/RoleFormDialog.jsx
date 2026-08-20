import { useEffect, useState } from 'react';
import Grid from '@mui/material/Grid';

import FormDialog from '@components/common/FormDialog.jsx';
import { FormTextField, FormSelect } from '@components/form/FormFields.jsx';
import adminService from '@services/modules/admin.service.js';

/**
 * Create or rename a custom role.
 *
 * Only custom roles reach the "edit" path -- the matrix screen never offers
 * this dialog for a system role, so there is no `isSystem` branch to guard
 * against here.
 */
const RoleFormDialog = ({ open, role = null, roles = [], onClose, onSaved }) => {
  const editing = Boolean(role);

  const [form, setForm] = useState({ label: '', description: '', cloneFromCode: '' });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;

    setError(null);
    setForm(
      editing
        ? { label: role.label ?? '', description: role.description ?? '', cloneFromCode: '' }
        : { label: '', description: '', cloneFromCode: '' },
    );
  }, [open, editing, role]);

  const set = (field) => (value) => setForm((previous) => ({ ...previous, [field]: value }));

  const duplicate = roles.some(
    (candidate) =>
      candidate.label.trim().toLowerCase() === (form.label ?? '').trim().toLowerCase() &&
      candidate.id !== role?.id,
  );

  const handleSubmit = async () => {
    setSaving(true);
    setError(null);

    try {
      if (editing) {
        await adminService.updateRole(role.id, {
          label: form.label.trim(),
          description: form.description?.trim() ?? '',
        });
      } else {
        await adminService.createRole({
          label: form.label.trim(),
          description: form.description?.trim() ?? '',
          cloneFromCode: form.cloneFromCode || undefined,
        });
      }

      onSaved();
      onClose();
    } catch (rejection) {
      setError(rejection?.message ?? 'The role could not be saved');
    } finally {
      setSaving(false);
    }
  };

  const complete = Boolean(form.label?.trim()) && !duplicate;

  return (
    <FormDialog
      open={open}
      title={editing ? `Edit ${role?.label ?? 'role'}` : 'New role'}
      submitLabel={editing ? 'Save' : 'Create role'}
      onClose={onClose}
      onSubmit={handleSubmit}
      submitting={saving}
      disabled={!complete}
      error={error}
      maxWidth="sm"
    >
      <Grid container spacing={2}>
        <Grid size={12}>
          <FormTextField
            label="Role name"
            value={form.label}
            onChange={set('label')}
            required
            autoFocus
            error={duplicate ? 'A role with that name already exists' : null}
          />
        </Grid>

        <Grid size={12}>
          <FormTextField
            label="Description"
            value={form.description}
            onChange={set('description')}
            multiline
            rows={2}
          />
        </Grid>

        {!editing && (
          <Grid size={12}>
            <FormSelect
              label="Clone permissions from"
              value={form.cloneFromCode ?? ''}
              onChange={set('cloneFromCode')}
              options={roles.map((candidate) => ({ value: candidate.code, label: candidate.label }))}
              emptyLabel="None — start with nothing checked"
            />
          </Grid>
        )}
      </Grid>
    </FormDialog>
  );
};

export default RoleFormDialog;
