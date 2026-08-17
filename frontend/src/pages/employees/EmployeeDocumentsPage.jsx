import { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import DescriptionIcon from '@mui/icons-material/DescriptionOutlined';
import WarningIcon from '@mui/icons-material/ReportProblemOutlined';
import VerifiedIcon from '@mui/icons-material/CheckCircleOutlined';

import PageHeader from '@components/common/PageHeader.jsx';
import StatCard from '@components/common/StatCard.jsx';
import { EmptyState, ErrorState } from '@components/common/StateBlock.jsx';
import { releaseImageCache } from '@components/common/AuthenticatedImage.jsx';
import DocumentEmployeeSelector from './components/DocumentEmployeeSelector.jsx';
import DocumentManager from './components/DocumentManager.jsx';
import employeeService from '@services/modules/employee.service.js';
import { getRowId, displayName, employeeIdentifiers } from '@utils/dataGrid.js';
import { PATHS } from '@routes/paths.js';

/**
 * Document management, starting from a person.
 *
 * There is no organisation-wide documents endpoint -- files live on the
 * employee record, and the API reads and writes them there. That is also the
 * right access boundary: a flat list of every contract and identity proof in
 * the company is a far larger disclosure than one person's file, and it is not
 * a list anyone actually works from.
 *
 * Only the selected employee's documents are fetched, one page at a time. The
 * screen previously loaded the WHOLE employee record -- salary, statutory
 * details, bank account, every document -- to read one array off it, which
 * meant the most sensitive record in the system crossed the wire so that a file
 * list could be rendered. `listAttachments` returns the documents and nothing
 * else, and the header above the table is drawn from the row the selector
 * already has in hand, so no second request is needed for it either.
 */

/** Ten rows: within the shared table's own page-size options, so its control is unchanged. */
const PAGE_SIZE = 10;

const EmployeeDocumentsPage = () => {
  const [employee, setEmployee] = useState(null);
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const employeeId = employee ? getRowId(employee) : null;

  /**
   * A new employee starts at page one.
   *
   * Page three of the previous person's documents is not a meaningful place to
   * land, and on a shorter list it is an empty table that reads as "no
   * documents".
   */
  useEffect(() => {
    setPage(1);
    setData(null);
    // Previewed files are held as object URLs until revoked; browsing several
    // employees in one sitting should not accumulate their scans in memory.
    releaseImageCache();
  }, [employeeId]);

  const load = useCallback(() => {
    if (!employeeId) {
      setData(null);
      return;
    }

    setLoading(true);
    setError(null);

    employeeService
      .listAttachments(employeeId, { page, limit })
      .then((response) => {
        setData(response.data);
        // The server clamps a page that is past the end -- after deleting the
        // last row of the last page, follow it back rather than showing a blank.
        if (response.data?.page && response.data.page !== page) setPage(response.data.page);
      })
      .catch((rejection) => {
        setData(null);
        setError(rejection?.message ?? 'Could not load this employee’s documents');
      })
      .finally(() => setLoading(false));
  }, [employeeId, page, limit]);

  useEffect(() => {
    load();
  }, [load]);

  const documents = data?.documents ?? [];

  return (
    <Box>
      <PageHeader
        title="Employee Documents"
        subtitle="Identity proofs, contracts and certificates held against a person"
        breadcrumbs={[
          { label: 'Home', to: PATHS.dashboard },
          { label: 'Employee Management' },
          { label: 'Documents' },
        ]}
      />

      <Box sx={{ mb: 3 }} data-print="hide">
        <DocumentEmployeeSelector
          value={employee}
          onChange={setEmployee}
          sx={{ width: { xs: '100%', sm: 420 } }}
        />
      </Box>

      {!employee && (
        <EmptyState
          icon={DescriptionIcon}
          title="Choose an employee"
          message="Search above to see, upload, replace or remove their documents."
          minHeight={280}
        />
      )}

      {employee && error && <ErrorState message={error} onRetry={load} minHeight={280} />}

      {employee && !error && (
        <>
          <Card variant="outlined" sx={{ mb: 3 }}>
            <CardContent>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="space-between">
                <Box>
                  <Typography variant="h6">{displayName(employee)}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {employeeIdentifiers(employee)}
                    {employee.departmentId?.name ? ` · ${employee.departmentId.name}` : ''}
                    {employee.designationId?.name ? ` · ${employee.designationId.name}` : ''}
                  </Typography>
                </Box>
              </Stack>
            </CardContent>
          </Card>

          {/* Counts are of the whole set, not of the page on screen -- the
              server returns them alongside, so turning a page does not change
              the summary above it. */}
          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid size={{ xs: 12, sm: 4 }}>
              <StatCard label="Documents" value={data?.total ?? 0} icon={DescriptionIcon} />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <StatCard
                label="Verified"
                value={data?.verified ?? 0}
                caption={data?.total ? `of ${data.total}` : null}
                icon={VerifiedIcon}
                color="success"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <StatCard
                label="Expiring or expired"
                value={data?.expiring ?? 0}
                caption="Within 60 days"
                icon={WarningIcon}
                color={data?.expiring ? 'warning' : 'success'}
              />
            </Grid>
          </Grid>

          <DocumentManager
            employee={employee}
            documents={documents}
            loading={loading}
            page={data?.page ?? page}
            limit={data?.limit ?? limit}
            total={data?.total ?? 0}
            onPageChange={setPage}
            onLimitChange={(next) => {
              setLimit(next);
              setPage(1);
            }}
            onChanged={load}
          />
        </>
      )}
    </Box>
  );
};

export default EmployeeDocumentsPage;
