import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import PeopleIcon from '@mui/icons-material/PeopleAltOutlined';
import AttendanceIcon from '@mui/icons-material/FactCheckOutlined';
import LeaveIcon from '@mui/icons-material/BeachAccessOutlined';
import PayrollIcon from '@mui/icons-material/PaymentsOutlined';
import RecruitmentIcon from '@mui/icons-material/PersonSearchOutlined';
import AssetIcon from '@mui/icons-material/DevicesOtherOutlined';
import LoanIcon from '@mui/icons-material/AccountBalanceOutlined';
import SettlementIcon from '@mui/icons-material/LogoutOutlined';
import ReportIcon from '@mui/icons-material/AssessmentOutlined';

import PageHeader from '@components/common/PageHeader.jsx';
import { LoadingState, ErrorState } from '@components/common/StateBlock.jsx';
import reportService from '@services/modules/report.service.js';
import { PATHS } from '@routes/paths.js';

/**
 * The reporting index.
 *
 * Built from the server's catalog rather than a hardcoded list, so this page
 * cannot offer a report that no longer exists or omit one that was just added.
 * The icons are the only thing chosen here, keyed off the descriptor.
 */
const ICONS = {
  people: PeopleIcon,
  attendance: AttendanceIcon,
  leave: LeaveIcon,
  payroll: PayrollIcon,
  recruitment: RecruitmentIcon,
  assets: AssetIcon,
  loans: LoanIcon,
  settlements: SettlementIcon,
};

const ReportsHubPage = () => {
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = () => {
    setLoading(true);
    setError(null);

    reportService
      .catalog()
      .then((response) => setCatalog(response.data ?? []))
      .catch((rejection) => setError(rejection?.message ?? 'Could not load the report catalog'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  return (
    <Box>
      <PageHeader
        title="Reports"
        subtitle="Every module, filtered and exportable"
        breadcrumbs={[{ label: 'Home', to: PATHS.dashboard }, { label: 'Reports' }]}
      />

      {loading && <LoadingState message="Loading the report catalog…" minHeight={280} />}
      {error && !loading && <ErrorState message={error} onRetry={load} minHeight={280} />}

      {!loading && !error && (
        <Grid container spacing={2}>
          {catalog.map((report) => {
            const Icon = ICONS[report.icon] ?? ReportIcon;

            return (
              <Grid key={report.slug} size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
                <Card variant="outlined" sx={{ height: '100%' }}>
                  <CardActionArea component={RouterLink} to={PATHS.report(report.slug)} sx={{ height: '100%' }}>
                    <CardContent>
                      <Stack direction="row" spacing={1.5} alignItems="flex-start">
                        <Box
                          sx={{
                            p: 1,
                            borderRadius: 1.5,
                            bgcolor: 'action.hover',
                            display: 'flex',
                            color: 'primary.main',
                          }}
                        >
                          <Icon />
                        </Box>

                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="subtitle1" noWrap>
                            {report.label}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            {report.description}
                          </Typography>
                        </Box>
                      </Stack>

                      <Stack direction="row" spacing={0.5} sx={{ mt: 2 }} flexWrap="wrap" useFlexGap>
                        <Chip label={`${report.filters.length} filters`} size="small" variant="outlined" />
                        <Chip label={`${report.columns.length} columns`} size="small" variant="outlined" />
                      </Stack>
                    </CardContent>
                  </CardActionArea>
                </Card>
              </Grid>
            );
          })}
        </Grid>
      )}
    </Box>
  );
};

export default ReportsHubPage;
