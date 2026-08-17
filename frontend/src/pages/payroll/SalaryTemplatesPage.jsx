import { useCallback, useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import InputAdornment from '@mui/material/InputAdornment';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import SearchIcon from '@mui/icons-material/SearchOutlined';

import PageHeader from '@components/common/PageHeader.jsx';
import DataTable from '@components/common/DataTable.jsx';
import ExportMenu from '@components/common/ExportMenu.jsx';
import organizationService from '@services/modules/organization.service.js';
import { formatCurrency, emptyDash } from '@utils/format.js';
import { PATHS } from '@routes/paths.js';

const yesNo = (value) => (
  <Chip label={value ? 'Yes' : 'No'} size="small" color={value ? 'success' : 'default'} variant="outlined" />
);

/**
 * Salary templates: the reusable component splits a salary structure is built
 * from.
 *
 * Read-only, and separate from the Organization masters on purpose. The API
 * exposes these through the picker endpoint only -- there is no management
 * surface for them -- and unlike a department or a shift, a template is payroll
 * arithmetic rather than org structure. Editing one silently re-prices every
 * structure derived from it, which is a Payroll decision, not an Organization
 * one.
 */
const SalaryTemplatesPage = () => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError(null);

    organizationService
      .salaryTemplates()
      .then((response) => setRows(response.data ?? []))
      .catch((rejection) => {
        setRows([]);
        setError(rejection?.message ?? 'Could not load salary templates');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // A handful of rows, and no server search parameter to defer to.
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;

    return rows.filter((row) =>
      [row.name, row.code].filter(Boolean).some((field) => String(field).toLowerCase().includes(needle)),
    );
  }, [rows, search]);

  const columns = [
    { key: 'name', label: 'Template', exportValue: (row) => row.name },
    {
      key: 'code',
      label: 'Code',
      exportValue: (row) => row.code,
      render: (row) => (
        <Typography variant="caption" fontFamily="monospace">
          {emptyDash(row.code)}
        </Typography>
      ),
    },
    {
      key: 'basicPercent',
      label: 'Basic %',
      align: 'right',
      exportValue: (row) => row.basicPercent,
      render: (row) => `${row.basicPercent ?? 0}%`,
    },
    {
      key: 'hraPercentOfBasic',
      label: 'HRA % of basic',
      align: 'right',
      exportValue: (row) => row.hraPercentOfBasic,
      render: (row) => `${row.hraPercentOfBasic ?? 0}%`,
    },
    {
      key: 'conveyanceAmount',
      label: 'Conveyance',
      align: 'right',
      exportValue: (row) => row.conveyanceAmount,
      render: (row) => formatCurrency(row.conveyanceAmount),
    },
    {
      key: 'medicalAmount',
      label: 'Medical',
      align: 'right',
      exportValue: (row) => row.medicalAmount,
      render: (row) => formatCurrency(row.medicalAmount),
    },
    {
      key: 'pfApplicable',
      label: 'PF',
      exportValue: (row) => (row.pfApplicable ? 'Yes' : 'No'),
      render: (row) => yesNo(row.pfApplicable),
    },
    {
      key: 'esiApplicable',
      label: 'ESI',
      exportValue: (row) => (row.esiApplicable ? 'Yes' : 'No'),
      render: (row) => yesNo(row.esiApplicable),
    },
    {
      key: 'isDefault',
      label: 'Default',
      exportValue: (row) => (row.isDefault ? 'Yes' : 'No'),
      render: (row) => (row.isDefault ? <Chip label="Default" size="small" color="primary" /> : '—'),
    },
  ];

  return (
    <Box>
      <PageHeader
        title="Salary Templates"
        subtitle="Reusable component splits a salary structure can be built from"
        breadcrumbs={[{ label: 'Home', to: PATHS.dashboard }, { label: 'Payroll' }, { label: 'Salary Templates' }]}
        actions={
          <ExportMenu
            columns={columns}
            rows={visible}
            filename="salary-templates"
            totalCount={visible.length}
            onError={(message) => setError(message)}
          />
        }
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Alert severity="info" sx={{ mb: 2 }}>
        Read-only. Templates are seeded with the organisation and changing one would re-price every salary
        structure derived from it, so they are managed as a deployment rather than a setting.
      </Alert>

      <Stack direction="row" spacing={1} sx={{ mb: 2 }} data-print="hide">
        <TextField
          size="small"
          placeholder="Search templates"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          sx={{ width: { xs: '100%', sm: 300 } }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
        />
      </Stack>

      <DataTable
        columns={columns}
        rows={visible}
        loading={loading}
        error={error}
        onRetry={load}
        emptyTitle={search ? 'No templates match' : 'No salary templates configured'}
      />
    </Box>
  );
};

export default SalaryTemplatesPage;
