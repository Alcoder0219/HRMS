import { useCallback, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import PageHeader from '@components/common/PageHeader.jsx';
import DataTable from '@components/common/DataTable.jsx';
import StatCard from '@components/common/StatCard.jsx';
import payrollService from '@services/modules/payroll.service.js';
import { formatCurrency, formatNumber } from '@utils/format.js';
import { PATHS } from '@routes/paths.js';

const MONTHS = Array.from({ length: 12 }, (_, index) => ({
  value: index + 1,
  label: new Date(2000, index).toLocaleString([], { month: 'long' }),
}));

const monthName = (month) => MONTHS.find((entry) => entry.value === month)?.label ?? month;

const now = new Date();
const YEARS = Array.from({ length: 5 }, (_, index) => now.getFullYear() - 3 + index);

/**
 * The three payroll analytics endpoints, behind one screen.
 *
 * The statutory register additionally demands TENANT reach on the server, not
 * just `payroll:read` -- every employee holds that action so they can see their
 * own payslip, which is far too coarse for a return listing the whole
 * organisation's UAN and ESI numbers. A narrower role sees the refusal rather
 * than a silently empty table.
 */
const PayrollReportsPage = () => {
  const [tab, setTab] = useState('statutory');
  const [params, setParams] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);

    const request =
      tab === 'statutory'
        ? payrollService.statutoryReport(params)
        : tab === 'department'
          ? payrollService.costByDepartment(params)
          : payrollService.yearlyTrend({ year: params.year });

    request
      .then((response) => setData(response.data ?? null))
      .catch((rejection) => {
        setData(null);
        setError(rejection?.message ?? 'Could not load the report');
      })
      .finally(() => setLoading(false));
  }, [tab, params]);

  useEffect(() => {
    load();
  }, [load]);

  const set = (field) => (event) => setParams((previous) => ({ ...previous, [field]: Number(event.target.value) }));

  /* ------------------------------------------------------------ columns -- */

  const PF_COLUMNS = [
    { key: 'employeeCode', label: 'Code' },
    { key: 'fullName', label: 'Employee' },
    { key: 'uan', label: 'UAN', render: (row) => row.uan ?? '—' },
    { key: 'pfNumber', label: 'PF number', render: (row) => row.pfNumber ?? '—' },
    { key: 'wages', label: 'PF wages', align: 'right', render: (row) => formatCurrency(row.wages) },
    { key: 'employee', label: 'Employee', align: 'right', render: (row) => formatCurrency(row.employee) },
    { key: 'employer', label: 'Employer', align: 'right', render: (row) => formatCurrency(row.employer) },
    { key: 'pension', label: 'Pension (EPS)', align: 'right', render: (row) => formatCurrency(row.pension) },
  ];

  const ESI_COLUMNS = [
    { key: 'employeeCode', label: 'Code' },
    { key: 'fullName', label: 'Employee' },
    { key: 'esiNumber', label: 'ESI number', render: (row) => row.esiNumber ?? '—' },
    { key: 'gross', label: 'Gross', align: 'right', render: (row) => formatCurrency(row.gross) },
    { key: 'employee', label: 'Employee', align: 'right', render: (row) => formatCurrency(row.employee) },
    { key: 'employer', label: 'Employer', align: 'right', render: (row) => formatCurrency(row.employer) },
  ];

  const DEPARTMENT_COLUMNS = [
    { key: 'department', label: 'Department' },
    { key: 'headcount', label: 'Headcount', align: 'right', render: (row) => formatNumber(row.headcount) },
    { key: 'gross', label: 'Gross', align: 'right', render: (row) => formatCurrency(row.gross) },
    { key: 'deductions', label: 'Deductions', align: 'right', render: (row) => formatCurrency(row.deductions) },
    { key: 'net', label: 'Net', align: 'right', render: (row) => <strong>{formatCurrency(row.net)}</strong> },
    { key: 'employerCost', label: 'Employer side', align: 'right', render: (row) => formatCurrency(row.employerCost) },
    {
      key: 'totalCost',
      label: 'Total cost',
      align: 'right',
      render: (row) => <strong>{formatCurrency(row.totalCost)}</strong>,
    },
  ];

  const TREND_COLUMNS = [
    { key: 'month', label: 'Month', render: (row) => monthName(row.month) },
    { key: 'headcount', label: 'Payslips', align: 'right', render: (row) => formatNumber(row.headcount) },
    { key: 'gross', label: 'Gross', align: 'right', render: (row) => formatCurrency(row.gross) },
    { key: 'net', label: 'Net', align: 'right', render: (row) => <strong>{formatCurrency(row.net)}</strong> },
    { key: 'employerCost', label: 'Employer side', align: 'right', render: (row) => formatCurrency(row.employerCost) },
  ];

  return (
    <Box>
      <PageHeader
        title="Payroll Reports"
        subtitle="Statutory registers, cost by department, and the yearly trend"
        breadcrumbs={[{ label: 'Home', to: PATHS.dashboard }, { label: 'Reports' }, { label: 'Payroll' }]}
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Tabs value={tab} onChange={(_event, next) => setTab(next)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Tab value="statutory" label="Statutory registers" />
        <Tab value="department" label="Cost by department" />
        <Tab value="trend" label="Yearly trend" />
      </Tabs>

      <Stack direction="row" spacing={1} sx={{ mb: 2 }} alignItems="center" flexWrap="wrap" useFlexGap>
        <TextField select size="small" label="Year" value={params.year} onChange={set('year')} sx={{ width: 130 }}>
          {YEARS.map((year) => (
            <MenuItem key={year} value={year}>
              {year}
            </MenuItem>
          ))}
        </TextField>

        {tab !== 'trend' && (
          <TextField select size="small" label="Month" value={params.month} onChange={set('month')} sx={{ width: 150 }}>
            {MONTHS.map((month) => (
              <MenuItem key={month.value} value={month.value}>
                {month.label}
              </MenuItem>
            ))}
          </TextField>
        )}
      </Stack>

      {/* ------------------------------------------------------- statutory -- */}
      {tab === 'statutory' && (
        <>
          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <StatCard
                label="PF contributions"
                value={formatCurrency((data?.pf?.totals?.employee ?? 0) + (data?.pf?.totals?.employer ?? 0))}
                caption={`${data?.pf?.count ?? 0} employee(s) · wages ${formatCurrency(data?.pf?.totals?.wages)}`}
                loading={loading}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <StatCard
                label="ESI contributions"
                value={formatCurrency((data?.esi?.totals?.employee ?? 0) + (data?.esi?.totals?.employer ?? 0))}
                caption={`${data?.esi?.count ?? 0} employee(s)`}
                loading={loading}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <StatCard label="Professional tax" value={formatCurrency(data?.professionalTax?.total)} loading={loading} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <StatCard label="TDS" value={formatCurrency(data?.tds?.total)} loading={loading} />
            </Grid>
          </Grid>

          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
            These registers carry the identifiers used for statutory filing. Treat exports accordingly.
          </Typography>

          <Typography variant="h6" sx={{ mb: 1 }}>
            Provident fund
          </Typography>
          <DataTable
            columns={PF_COLUMNS}
            rows={data?.pf?.rows ?? []}
            loading={loading}
            getKey={(row) => row.employeeCode}
            emptyMessage="No PF contributions for this period."
          />

          <Typography variant="h6" sx={{ mt: 3, mb: 1 }}>
            ESI
          </Typography>
          <DataTable
            columns={ESI_COLUMNS}
            rows={data?.esi?.rows ?? []}
            loading={loading}
            getKey={(row) => row.employeeCode}
            emptyMessage="No ESI contributions for this period."
          />
        </>
      )}

      {/* ------------------------------------------------------ department -- */}
      {tab === 'department' && (
        <>
          <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
            <Chip label={`${data?.rows?.length ?? 0} department(s)`} size="small" variant="outlined" />
          </Stack>

          <DataTable
            columns={DEPARTMENT_COLUMNS}
            rows={data?.rows ?? []}
            loading={loading}
            getKey={(row) => row.department}
            emptyMessage="No payroll was processed for this period."
          />
        </>
      )}

      {/* ----------------------------------------------------------- trend -- */}
      {tab === 'trend' && (
        <DataTable
          columns={TREND_COLUMNS}
          rows={data?.months ?? []}
          loading={loading}
          getKey={(row) => row.month}
          emptyMessage={`No payroll was processed in ${params.year}.`}
        />
      )}
    </Box>
  );
};

export default PayrollReportsPage;
