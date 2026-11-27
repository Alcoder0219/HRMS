import { Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import PaymentsIcon from '@mui/icons-material/PaymentsOutlined';
import WalletIcon from '@mui/icons-material/AccountBalanceWalletOutlined';
import RemoveIcon from '@mui/icons-material/RemoveCircleOutlineOutlined';
import ScheduleIcon from '@mui/icons-material/ScheduleOutlined';
import GroupsIcon from '@mui/icons-material/GroupsOutlined';
import FactCheckIcon from '@mui/icons-material/FactCheckOutlined';

import DashboardPanel from '../components/DashboardPanel.jsx';
import KpiCard from '../components/KpiCard.jsx';
import { BarChart, CHART_COLORS, DonutChart, HorizontalBars, categoricalColors, compactCurrency } from '../components/Charts.jsx';
import useCurrency from '@hooks/useCurrency.js';
import { compactAmountIn } from '@utils/currency.js';
import { formatCurrency, humanize } from '@utils/format.js';
import { PATHS } from '@routes/paths.js';

/**
 * The month's payroll and the year around it, from the salary register -- the
 * stored payslips, as the Payroll Runs screen shows them -- narrowed by the
 * dashboard's filters. Nothing is estimated: a month without a run says so.
 */

const SHORT_MONTH = (month) => new Date(2000, month - 1).toLocaleString(['en-TZ', 'en-GB'], { month: 'short' });

const change = (current, previous) => {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
};

const Comparison = ({ label, current, previous, format }) => {
  const delta = change(current, previous);
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', justifyContent: 'space-between', py: 0.75 }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Box sx={{ textAlign: 'right' }}>
        <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
          {format(current)}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {previous === null ? 'no earlier run' : `was ${format(previous)}`}
          {delta !== null && ` · ${delta > 0 ? '+' : ''}${delta}%`}
        </Typography>
      </Box>
    </Stack>
  );
};

const PayrollAnalytics = ({ query, periodLabel, year }) => {
  const theme = useTheme();
  const currency = useCurrency();
  const palette = categoricalColors(theme);
  const data = query.data;
  const run = data?.run ?? null;
  const common = { loading: query.loading, error: query.error, onRetry: query.reload };
  const noRun = `No payroll run for ${periodLabel}. Figures appear once the month is processed.`;

  const bandLabel = (band) => {
    const amount = (value) => compactAmountIn(value, currency.code);
    if (band.min === 0) return `< ${amount(band.max)}`;
    if (band.max === null) return `> ${amount(band.min)}`;
    return `${amount(band.min)}–${amount(band.max)}`;
  };

  return (
    <Stack spacing={2}>
      <Grid container spacing={2}>
        {[
          { label: 'Gross salary', value: run ? formatCurrency(run.gross) : '—', caption: run ? periodLabel : 'No run this month', icon: PaymentsIcon, color: 'primary' },
          { label: 'Net salary', value: run ? formatCurrency(run.net) : '—', caption: 'Take-home, after deductions', icon: WalletIcon, color: 'success' },
          { label: 'Deductions', value: run ? formatCurrency(run.deductions) : '—', caption: 'Withheld from pay', icon: RemoveIcon, color: 'error' },
          { label: 'Overtime paid', value: run ? formatCurrency(run.overtime) : '—', caption: 'Overtime lines on payslips', icon: ScheduleIcon, color: 'warning' },
          { label: 'In salary register', value: run ? run.employees : '—', caption: run ? 'Payslips this month' : 'No run this month', icon: GroupsIcon, color: 'info' },
          {
            label: 'Run status',
            value: run ? humanize(run.status) : '—',
            caption: data ? `${data.awaitingApproval} run(s) awaiting approval` : '',
            icon: FactCheckIcon,
            color: run?.status === 'PAID' ? 'success' : 'secondary',
          },
        ].map((card) => (
          <Grid key={card.label} size={{ xs: 12, sm: 6, md: 4, xl: 2 }}>
            <KpiCard {...card} loading={query.loading} to={PATHS.payrollRuns} />
          </Grid>
        ))}
      </Grid>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, lg: 8 }}>
          <DashboardPanel
            title="Gross vs net salary"
            subtitle={`${year} · per payroll run`}
            {...common}
            empty={!data?.trend?.length}
            emptyMessage={`No payroll has been processed in ${year}.`}
            minHeight={240}
            action={
              <Link component={RouterLink} to={PATHS.payrollRuns} variant="caption">
                Payroll runs
              </Link>
            }
          >
            <BarChart
              height={220}
              format={compactCurrency}
              series={[
                { label: 'Gross', color: CHART_COLORS.gross },
                { label: 'Net', color: CHART_COLORS.net },
              ]}
              data={(data?.trend ?? []).map((entry) => ({ label: SHORT_MONTH(entry.month), values: [entry.gross, entry.net] }))}
            />
          </DashboardPanel>
        </Grid>

        <Grid size={{ xs: 12, lg: 4 }}>
          <DashboardPanel
            title="Monthly comparison"
            subtitle={data?.previous ? `${periodLabel} against ${data.previous.period}` : periodLabel}
            {...common}
            empty={!run}
            emptyMessage={noRun}
            minHeight={240}
          >
            {run && (
              <Stack divider={<Box sx={{ borderTop: 1, borderColor: 'divider' }} />}>
                <Comparison label="Gross" current={run.gross} previous={data.previous?.gross ?? null} format={formatCurrency} />
                <Comparison label="Net" current={run.net} previous={data.previous?.net ?? null} format={formatCurrency} />
                <Comparison label="Employees paid" current={run.employees} previous={data.previous?.employees ?? null} format={(value) => value} />
              </Stack>
            )}
          </DashboardPanel>
        </Grid>

        <Grid size={{ xs: 12, md: 6, lg: 4 }}>
          <DashboardPanel title="Salary breakdown" subtitle={`${periodLabel} · gross, by where it went`} {...common} empty={!run} emptyMessage={noRun} minHeight={220}>
            {run?.breakdown && (
              <DonutChart
                size={120}
                // Compact figures, so the labels have room beside the ring; the
                // exact amount is in each segment's tooltip and the cards above.
                format={(value) => compactCurrency(value)}
                centerValue={compactCurrency(run.gross)}
                centerLabel="Gross"
                data={[
                  { label: 'Net pay', value: run.net, color: CHART_COLORS.net },
                  { label: 'NSSF (employee)', value: run.breakdown.nssf, color: CHART_COLORS.nssf },
                  { label: 'NHIF', value: run.breakdown.nhif, color: CHART_COLORS.nhif },
                  { label: 'PAYE', value: run.breakdown.paye, color: CHART_COLORS.tax },
                  { label: 'Other deductions', value: run.breakdown.other, color: CHART_COLORS.other },
                ]}
              />
            )}
          </DashboardPanel>
        </Grid>

        <Grid size={{ xs: 12, md: 6, lg: 4 }}>
          <DashboardPanel title="Department-wise salary" subtitle={`${periodLabel} · gross by department`} {...common} empty={!data?.byDepartment?.length} emptyMessage={noRun} minHeight={220}>
            <Box sx={{ maxHeight: 300, overflowY: 'auto', pr: 0.5 }}>
              <HorizontalBars
                format={formatCurrency}
                data={(data?.byDepartment ?? []).map((row, index) => ({
                  label: row.label,
                  value: row.value,
                  caption: `${row.employees} employee(s)`,
                  color: palette[index % palette.length],
                }))}
              />
            </Box>
          </DashboardPanel>
        </Grid>

        <Grid size={{ xs: 12, md: 12, lg: 4 }}>
          <DashboardPanel
            title="Salary bands"
            subtitle={`${periodLabel} · employees per monthly gross band (${currency.symbol})`}
            {...common}
            empty={!run || !data?.bands?.some((band) => band.employees > 0)}
            emptyMessage={noRun}
            minHeight={220}
          >
            <BarChart
              height={190}
              showLegend={false}
              format={(value) => Math.round(value)}
              // Bands are an ordered scale of one measure, so one hue, not one per band.
              series={[{ label: 'Employees', color: CHART_COLORS.gross }]}
              data={(data?.bands ?? []).map((band) => ({ label: bandLabel(band), values: [band.employees] }))}
            />
          </DashboardPanel>
        </Grid>
      </Grid>
    </Stack>
  );
};

export default PayrollAnalytics;
