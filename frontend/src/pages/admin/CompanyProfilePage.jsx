import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import SaveIcon from '@mui/icons-material/SaveOutlined';

import PageHeader from '@components/common/PageHeader.jsx';
import { FormSection, FormRow, FormTextField, FormSelect } from '@components/form/FormFields.jsx';
import { FormSkeleton } from '@components/common/Skeletons.jsx';
import { ErrorState } from '@components/common/StateBlock.jsx';
import adminService from '@services/modules/admin.service.js';
import { useToast } from '@contexts/ToastContext.jsx';
import { PATHS } from '@routes/paths.js';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * The legal entity behind the payslips.
 *
 * Grouped by who asks for each field rather than by data type: an accountant
 * looking for the NSSF code should not have to read past the postal address.
 */
const SECTIONS = [
  {
    title: 'Identity',
    caption: 'What the company is called on documents it issues',
    fields: [
      { key: 'name', label: 'Trading name', size: 6 },
      { key: 'legalName', label: 'Registered legal name', size: 6 },
      { key: 'registrationNumber', label: 'Company registration number', size: 6 },
      { key: 'website', label: 'Website', size: 6 },
    ],
  },
  {
    title: 'Statutory registrations',
    caption: 'Printed on payslips and used by the statutory reports',
    fields: [
      { key: 'taxNumber', label: 'VAT registration number', size: 4 },
      { key: 'tinNumber', label: 'TIN', size: 4 },
      { key: 'nssfCode', label: 'NSSF employer code', size: 4 },
      { key: 'nhifCode', label: 'NHIF employer code', size: 4 },
      { key: 'wcfCode', label: 'WCF employer code', size: 4 },
    ],
  },
  {
    title: 'Contact',
    caption: 'Where correspondence about the company goes',
    fields: [
      { key: 'email', label: 'Email', size: 6, type: 'email' },
      { key: 'phone', label: 'Phone', size: 6 },
      { key: 'addressLine1', label: 'Address line 1', size: 12 },
      { key: 'addressLine2', label: 'Address line 2', size: 12 },
      { key: 'city', label: 'City', size: 3 },
      { key: 'state', label: 'Region', size: 3 },
      { key: 'country', label: 'Country', size: 3 },
      { key: 'postalCode', label: 'Postal code', size: 3 },
    ],
  },
  {
    title: 'Conventions',
    caption: 'How dates, money and the financial year are handled across the product',
    fields: [
      { key: 'financialYearStartMonth', label: 'Tax year starts', size: 4, select: 'month' },
      { key: 'currency', label: 'Currency code', size: 4 },
      { key: 'timezone', label: 'Timezone', size: 4 },
      { key: 'dateFormat', label: 'Date format', size: 4 },
    ],
  },
];

const CompanyProfilePage = () => {
  const [form, setForm] = useState(null);
  const [original, setOriginal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const toast = useToast();

  const load = () => {
    setLoading(true);
    setError(null);

    adminService
      .getSettings()
      .then((response) => {
        const company = response.data?.company ?? {};
        setForm(company);
        setOriginal(company);
      })
      .catch((rejection) => setError(rejection?.message ?? 'Could not load the company profile'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  // The form primitives report the value, not the event.
  const set = (field) => (value) => setForm((previous) => ({ ...previous, [field]: value }));

  // Only what actually changed is sent, so an untouched form is a no-op rather
  // than an audit entry saying every field was rewritten to its own value.
  const changed =
    form && original
      ? Object.fromEntries(Object.entries(form).filter(([key, value]) => value !== original[key]))
      : {};

  const dirty = Object.keys(changed).length > 0;

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    try {
      const response = await adminService.updateCompany(changed);
      setForm(response.data);
      setOriginal(response.data);
      toast.success('Company profile saved');
    } catch (rejection) {
      setError(rejection?.message ?? 'The profile could not be saved');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box>
      <PageHeader
        title="Company Profile"
        subtitle="The legal entity behind payslips, letters and statutory filings"
        breadcrumbs={[{ label: 'Home', to: PATHS.dashboard }, { label: 'Administration' }, { label: 'Company Profile' }]}
        actions={
          <Button
            size="small"
            variant="contained"
            startIcon={<SaveIcon />}
            onClick={handleSave}
            disabled={!dirty || saving}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        }
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Shaped like the form it precedes, so the page does not jump when the
          values arrive under the reader's cursor. */}
      {loading && (
        <Stack spacing={2}>
          {SECTIONS.map((section) => (
            <FormSection key={section.title} title={section.title} caption={section.caption}>
              <FormRow span={12}>
                <FormSkeleton fields={section.fields.length} />
              </FormRow>
            </FormSection>
          ))}
        </Stack>
      )}

      {!loading && !form && <ErrorState message={error ?? 'Nothing to show'} onRetry={load} minHeight={300} />}

      {!loading && form && (
        <Stack spacing={2}>
          {SECTIONS.map((section) => (
            <FormSection key={section.title} title={section.title} caption={section.caption}>
              {section.fields.map((field) => (
                <FormRow key={field.key} span={field.size}>
                  {field.select === 'month' ? (
                    <FormSelect
                      label={field.label}
                      value={form[field.key] ?? 4}
                      onChange={set(field.key)}
                      options={MONTHS.map((month, index) => ({ value: index + 1, label: month }))}
                      emptyLabel={null}
                    />
                  ) : (
                    <FormTextField
                      label={field.label}
                      type={field.type ?? 'text'}
                      value={form[field.key]}
                      onChange={set(field.key)}
                    />
                  )}
                </FormRow>
              ))}
            </FormSection>
          ))}

          {dirty && (
            <Alert severity="info">
              {Object.keys(changed).length} unsaved change(s): {Object.keys(changed).join(', ')}
            </Alert>
          )}
        </Stack>
      )}
    </Box>
  );
};

export default CompanyProfilePage;
