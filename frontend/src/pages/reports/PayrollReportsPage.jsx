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
 * organisation's NSSF and NHIF membership numbers. A narrower role sees the
 * refusal rather than a silently empty table.
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

  const NSSF_COLUMNS = [
    { key: 'employeeCode', label: 'Code' },
    { key: 'fullName', label: 'Employee' },
    { key: 'nssfNumber', label: 'NSSF number', render: (row) => row.nssfNumber ?? '—' },
    { key: 'wages', label: 'Contributory wages', align: 'right', render: (row) => formatCurrency(row.wages) },
    { key: 'employee', label: 'Employee', align: 'right', render: (row) => formatCurrency(row.employee) },
    { key: 'employer', label: 'Employer', align: 'right', render: (row) => formatCurrency(row.employer) },
    // The fund is remitted one figure per member, not two.
    { key: 'total', label: 'Remitted', align: 'right', render: (row) => <strong>{formatCurrency(row.total)}</strong> },
  ];

  // No employer column: NHIF is an employee-only contribution here, so there
  // would be nothing but zeroes to show.
  const NHIF_COLUMNS = [
    { key: 'employeeCode', label: 'Code' },
    { key: 'fullName', label: 'Employee' },
    { key: 'nhifNumber', label: 'NHIF number', render: (row) => row.nhifNumber ?? '—' },
    { key: 'gross', label: 'Gross (band)', align: 'right', render: (row) => formatCurrency(row.gross) },
    { key: 'employee', label: 'Contribution', align: 'right', render: (row) => formatCurrency(row.employee) },
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
                label="NSSF contributions"
                value={formatCurrency(data?.nssf?.totals?.total)}
                caption={`${data?.nssf?.count ?? 0} member(s) · wages ${formatCurrency(data?.nssf?.totals?.wages)}`}
                loading={loading}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <StatCard
                label="NHIF contributions"
                value={formatCurrency(data?.nhif?.totals?.employee)}
                caption={`${data?.nhif?.count ?? 0} member(s)`}
                loading={loading}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <StatCard label="PAYE" value={formatCurrency(data?.paye?.total)} loading={loading} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <StatCard
                label="SDL & WCF"
                value={formatCurrency((data?.sdl?.total ?? 0) + (data?.wcf?.total ?? 0))}
                caption={`SDL ${formatCurrency(data?.sdl?.total)} · WCF ${formatCurrency(data?.wcf?.total)}`}
                loading={loading}
              />
            </Grid>
          </Grid>

          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
            These registers carry the identifiers used for statutory filing. Treat exports accordingly. SDL and
            WCF are employer levies and have no per-employee register.
          </Typography>

          <Typography variant="h6" sx={{ mb: 1 }}>
            NSSF
          </Typography>
          <DataTable
            columns={NSSF_COLUMNS}
            rows={data?.nssf?.rows ?? []}
            loading={loading}
            getKey={(row) => row.employeeCode}
            emptyMessage="No NSSF contributions for this period."
          />

          <Typography variant="h6" sx={{ mt: 3, mb: 1 }}>
            NHIF
          </Typography>
          <DataTable
            columns={NHIF_COLUMNS}
            rows={data?.nhif?.rows ?? []}
            loading={loading}
            getKey={(row) => row.employeeCode}
            emptyMessage="No NHIF contributions for this period."
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
