import { Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';

import DashboardPanel from '../components/DashboardPanel.jsx';
import { CHART_COLORS, DonutChart, HorizontalBars, categoricalColors } from '../components/Charts.jsx';
import StatusChip from '@components/common/StatusChip.jsx';
import { formatDate, humanize } from '@utils/format.js';
import { PATHS } from '@routes/paths.js';

/**
 * Who works here, for the filtered unit and department: how many, where, on
 * what terms, and who joined last. Counts of the Employee records themselves,
 * currently employed people for the distributions.
 */

/** Named categories, each its own colour in the fixed order, labelled by name. */
const colored = (rows, palette, labeller = (label) => label) =>
  rows.map((row, index) => ({ label: labeller(row.label), value: row.value, color: palette[index % palette.length] }));

const EmployeeAnalytics = ({ query, recentLimit = 6 }) => {
  const theme = useTheme();
  const palette = categoricalColors(theme);
  const data = query.data;
  const common = { loading: query.loading, error: query.error, onRetry: query.reload };
  const empty = !data || data.total === 0;
  const count = (value) => `${value} employee${value === 1 ? '' : 's'}`;

  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, md: 6, lg: 4 }}>
        <DashboardPanel title="Employee strength" subtitle="Current employment status" {...common} empty={empty} emptyMessage="No employees in this selection." minHeight={240}>
          {data && (
            <Stack spacing={2}>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1.5 }}>
                {[
                  ['Employed', data.active],
                  ['Exited', data.inactive],
                  ['Joined this month', data.joinedThisMonth],
                ].map(([label, value]) => (
                  <Box key={label} sx={{ minWidth: 0 }}>
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                      {label}
                    </Typography>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                      {value}
                    </Typography>
                  </Box>
                ))}
              </Box>
              <DonutChart
                size={120}
                // The bare count: the legend sits beside the ring in a narrow panel.
                format={(value) => value}
                centerValue={data.active}
                centerLabel="Employed"
                data={[
                  { label: 'Confirmed', value: data.confirmed - data.noticePeriod, color: CHART_COLORS.present },
                  { label: 'On probation', value: data.probation, color: CHART_COLORS.leave },
                  { label: 'Notice period', value: data.noticePeriod, color: CHART_COLORS.pending },
                ]}
              />
            </Stack>
          )}
        </DashboardPanel>
      </Grid>

      <Grid size={{ xs: 12, md: 6, lg: 4 }}>
        <DashboardPanel title="By unit" subtitle="Employed people per unit" {...common} empty={!data?.byUnit?.length} emptyMessage="No employees in this selection." minHeight={240}>
          <HorizontalBars format={count} data={colored(data?.byUnit ?? [], palette)} />
        </DashboardPanel>
      </Grid>

      <Grid size={{ xs: 12, md: 6, lg: 4 }}>
        <DashboardPanel title="By department" subtitle="Largest departments" {...common} empty={!data?.byDepartment?.length} emptyMessage="No employees in this selection." minHeight={240}>
          <HorizontalBars format={count} data={colored(data?.byDepartment ?? [], palette)} />
        </DashboardPanel>
      </Grid>

      <Grid size={{ xs: 12, md: 6, lg: 4 }}>
        <DashboardPanel title="Employment type & category" subtitle="Terms of employment" {...common} empty={!data?.byEmploymentType?.length} emptyMessage="No employees in this selection." minHeight={200}>
          <Stack spacing={2}>
            <HorizontalBars format={count} data={colored(data?.byEmploymentType ?? [], palette, humanize)} />
            {data?.byCategory?.length > 0 && (
              <>
                <Typography variant="caption" color="text.secondary">
                  Category
                </Typography>
                <HorizontalBars format={count} data={colored(data.byCategory, palette.slice(2), humanize)} />
              </>
            )}
          </Stack>
        </DashboardPanel>
      </Grid>

      <Grid size={{ xs: 12, md: 6, lg: 4 }}>
        <DashboardPanel title="Gender" subtitle="As recorded on the employee master" {...common} empty={!data?.byGender?.length} emptyMessage="No employees in this selection." minHeight={200}>
          <HorizontalBars format={count} data={colored(data?.byGender ?? [], palette, humanize)} />
        </DashboardPanel>
      </Grid>

      <Grid size={{ xs: 12, md: 6, lg: 4 }}>
        <DashboardPanel
          title="Recently joined"
          subtitle="Latest joining dates"
          {...common}
          empty={!data?.recentJoiners?.length}
          emptyMessage="No employees in this selection."
          minHeight={200}
          action={
            <Link component={RouterLink} to={PATHS.employees} variant="caption">
              All employees
            </Link>
          }
        >
          <Stack spacing={1}>
            {(data?.recentJoiners ?? []).slice(0, recentLimit).map((employee) => (
              <Stack key={employee._id} direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                <Box sx={{ minWidth: 0 }}>
                  <Link component={RouterLink} to={PATHS.employeeDetail(employee._id)} variant="body2" underline="hover" noWrap sx={{ display: 'block' }}>
                    {employee.fullName}
                  </Link>
                  <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                    {[employee.employeeId ?? employee.employeeCode, employee.department, `joined ${formatDate(employee.joiningDate)}`].filter(Boolean).join(' · ')}
                  </Typography>
                </Box>
                <StatusChip status={employee.status} />
              </Stack>
            ))}
          </Stack>
        </DashboardPanel>
      </Grid>
    </Grid>
  );
};

export default EmployeeAnalytics;
