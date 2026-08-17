import { useState } from 'react';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import UploadIcon from '@mui/icons-material/UploadFileOutlined';
import DownloadIcon from '@mui/icons-material/FileDownloadOutlined';
import CheckIcon from '@mui/icons-material/CheckOutlined';

import PageHeader from '@components/common/PageHeader.jsx';
import UploadedSheets from './components/UploadedSheets.jsx';
import attendanceService from '@services/modules/attendance.service.js';
import { downloadBlob } from '@services/modules/employee.service.js';
import { PATHS } from '@routes/paths.js';

const MONTHS = Array.from({ length: 12 }, (_, index) => ({
  value: index + 1,
  label: new Date(2000, index).toLocaleString([], { month: 'long' }),
}));

const DUPLICATE_STRATEGIES = [
  { value: 'REPLACE', label: 'Replace', help: 'Overwrite the month already on file' },
  { value: 'MERGE', label: 'Merge', help: 'Keep existing days, add the ones in this file' },
  { value: 'SKIP', label: 'Skip', help: 'Leave employees who already have this month untouched' },
];

/** Problem categories, in the order the specification lists them. */
const ISSUE_CARDS = [
  { key: 'missingEmployeeId', label: 'Missing Employee ID' },
  { key: 'unknownEmployee', label: 'Unknown Employee' },
  { key: 'duplicateRows', label: 'Duplicate Rows' },
  { key: 'invalidTime', label: 'Wrong Time Format' },
  { key: 'wrongMonth', label: 'Wrong Month' },
  { key: 'inactiveEmployee', label: 'Inactive Employee' },
];

const AttendanceImportPage = () => {
  const now = new Date();

  const [tab, setTab] = useState('upload');
  const [file, setFile] = useState(null);
  const [period, setPeriod] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const [strategy, setStrategy] = useState('REPLACE');
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);

  const reset = () => {
    setFile(null);
    setReport(null);
    setError(null);
    setProgress(0);
  };

  const handleTemplate = async () => {
    try {
      const blob = await attendanceService.sheetTemplate(period);
      downloadBlob(blob, `attendance-template-${period.year}-${String(period.month).padStart(2, '0')}.xlsx`);
    } catch (rejection) {
      setError(rejection?.message ?? 'Could not download the template');
    }
  };

  const run = async (commit) => {
    setBusy(true);
    setError(null);
    setProgress(0);

    try {
      const response = await attendanceService.importSheet({
        file,
        ...period,
        duplicateStrategy: strategy,
        commit,
        onProgress: setProgress,
      });
      setReport(response.data);
    } catch (rejection) {
      setError(rejection?.message ?? 'The file could not be processed');
    } finally {
      setBusy(false);
      setProgress(0);
    }
  };

  const validated = report && !report.committed;
  const committed = report?.committed;

  const summaryCards = report
    ? [
        { label: 'Total Records', value: report.totalRows, color: 'text.primary' },
        { label: 'Valid Records', value: report.validCount, color: 'success.main' },
        { label: 'Invalid Records', value: report.invalidCount, color: 'error.main' },
        { label: 'Imported', value: report.imported ?? 0, color: 'primary.main' },
        { label: 'Skipped', value: report.skipped ?? 0, color: 'warning.main' },
      ]
    : [];

  return (
    <Box>
      <PageHeader
        title="Import attendance"
        subtitle="Upload a monthly attendance workbook, and manage what previous imports produced"
        breadcrumbs={[
          { label: 'Home', to: PATHS.dashboard },
          { label: 'Attendance', to: PATHS.attendance },
          { label: 'Import' },
        ]}
        actions={
          tab === 'upload' ? (
            <Button variant="outlined" color="inherit" startIcon={<DownloadIcon />} onClick={handleTemplate}>
              Download sample Excel
            </Button>
          ) : null
        }
      />

      {/* The uploaded sheets are what an import produces, so they belong beside
          the importer rather than on a screen of their own. */}
      <Tabs value={tab} onChange={(_event, next) => setTab(next)} sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}>
        <Tab value="upload" label="Upload a workbook" />
        <Tab value="sheets" label="Uploaded sheets" />
      </Tabs>

      {tab === 'sheets' && <UploadedSheets />}

      {tab === 'upload' && (
        <>
      <Paper variant="outlined" sx={{ p: 3, mb: 3 }}>
        <Alert severity="info" variant="outlined" sx={{ mb: 2 }}>
          The workbook carries a month name but no year, so both are selected here.
          Employees are matched on <strong>Employee ID</strong> — the name column is for
          reference only and is never used to identify anyone.
        </Alert>

        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <TextField
              select
              label="Month"
              value={period.month}
              onChange={(event) => setPeriod((prev) => ({ ...prev, month: Number(event.target.value) }))}
            >
              {MONTHS.map((month) => (
                <MenuItem key={month.value} value={month.value}>
                  {month.label}
                </MenuItem>
              ))}
            </TextField>
          </Grid>

          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <TextField
              select
              label="Year"
              value={period.year}
              onChange={(event) => setPeriod((prev) => ({ ...prev, year: Number(event.target.value) }))}
            >
              {[now.getFullYear() + 1, now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2].map(
                (year) => (
                  <MenuItem key={year} value={year}>
                    {year}
                  </MenuItem>
                ),
              )}
            </TextField>
          </Grid>

          <Grid size={{ xs: 12, sm: 12, md: 6 }}>
            <TextField
              select
              label="If the month is already uploaded"
              value={strategy}
              onChange={(event) => setStrategy(event.target.value)}
              helperText={DUPLICATE_STRATEGIES.find((item) => item.value === strategy)?.help}
            >
              {DUPLICATE_STRATEGIES.map((item) => (
                <MenuItem key={item.value} value={item.value}>
                  {item.label}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
        </Grid>

        <Box
          component="label"
          sx={{
            border: '1px dashed',
            borderColor: file ? 'primary.main' : 'divider',
            borderRadius: 2,
            p: 4,
            textAlign: 'center',
            cursor: 'pointer',
            display: 'block',
            '&:hover': { borderColor: 'primary.main', bgcolor: 'action.hover' },
          }}
        >
          <input
            type="file"
            hidden
            accept=".xlsx,.xls"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setReport(null);
              setError(null);
            }}
          />
          <UploadIcon color="action" fontSize="large" />
          <Typography variant="body1" sx={{ mt: 1 }}>
            {file ? file.name : 'Choose the attendance workbook (.xlsx)'}
          </Typography>
          {file && (
            <Typography variant="caption" color="text.secondary">
              {(file.size / 1024).toFixed(0)} KB
            </Typography>
          )}
        </Box>

        {busy && (
          <Box sx={{ mt: 2 }}>
            <LinearProgress variant={progress ? 'determinate' : 'indeterminate'} value={progress} />
            <Typography variant="caption" color="text.secondary">
              {progress ? `Uploading ${progress}%` : 'Validating…'}
            </Typography>
          </Box>
        )}

        <Stack direction="row" spacing={1} sx={{ mt: 2 }} justifyContent="flex-end">
          <Button color="inherit" onClick={reset} disabled={busy}>
            Cancel
          </Button>
          <Button variant="outlined" onClick={() => run(false)} disabled={!file || busy}>
            Preview
          </Button>
          <Button
            variant="contained"
            startIcon={<CheckIcon />}
            onClick={() => run(true)}
            // Importing is gated on a clean preview with at least one usable
            // row, so nobody commits a file they have not seen checked.
            disabled={!validated || busy || report.validCount === 0}
          >
            Import {validated ? `${report.validCount} employee(s)` : ''}
          </Button>
        </Stack>
      </Paper>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {report && (
        <>
          <Stack direction="row" spacing={2} sx={{ mb: 3, flexWrap: 'wrap', gap: 2 }}>
            {summaryCards.map((card) => (
              <Card key={card.label} variant="outlined" sx={{ px: 2.5, py: 1.5, minWidth: 140 }}>
                <Typography variant="caption" color="text.secondary" textTransform="uppercase" letterSpacing="0.06em">
                  {card.label}
                </Typography>
                <Typography variant="h3" color={card.color} sx={{ mt: 0.5 }}>
                  {card.value}
                </Typography>
              </Card>
            ))}
          </Stack>

          {committed && (
            <Alert severity={report.invalidCount ? 'warning' : 'success'} sx={{ mb: 2 }}>
              <AlertTitle>
                Imported {report.imported} employee month(s) · {report.daysWritten} daily records written
              </AlertTitle>
              {report.skipped > 0 && `${report.skipped} skipped by the duplicate rule. `}
              {report.invalidCount > 0 && `${report.invalidCount} row(s) were rejected and not imported.`}
            </Alert>
          )}

          {validated && report.duplicateMonthCount > 0 && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              {report.duplicateMonthCount} employee(s) already have this month uploaded. They will be
              handled using the <strong>{strategy.toLowerCase()}</strong> rule.
            </Alert>
          )}

          {/* Issue breakdown, one chip per category the spec calls for. */}
          <Stack direction="row" spacing={1} sx={{ mb: 3, flexWrap: 'wrap', gap: 1 }}>
            {ISSUE_CARDS.map((issue) => (
              <Chip
                key={issue.key}
                label={`${issue.label}: ${report.buckets?.[issue.key] ?? 0}`}
                color={report.buckets?.[issue.key] ? 'error' : 'default'}
                variant={report.buckets?.[issue.key] ? 'filled' : 'outlined'}
                size="small"
              />
            ))}
          </Stack>

          {report.invalid?.length > 0 && (
            <Paper variant="outlined" sx={{ mb: 3 }}>
              <Typography variant="overline" color="text.secondary" sx={{ px: 2, pt: 2, display: 'block' }}>
                Rows that will not be imported
              </Typography>
              <TableContainer sx={{ maxHeight: 320 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell width={70}>Row</TableCell>
                      <TableCell width={150}>Employee ID</TableCell>
                      <TableCell width={180}>Name</TableCell>
                      <TableCell>Problem</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {report.invalid.map((row) => (
                      <TableRow key={row.row}>
                        <TableCell>{row.row}</TableCell>
                        <TableCell>{row.employeeId || '—'}</TableCell>
                        <TableCell>{row.employeeName || '—'}</TableCell>
                        <TableCell>
                          <Typography variant="caption" color="error.main">
                            {row.errors.join('; ')}
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              {report.invalidTruncated && (
                <Typography variant="caption" color="text.secondary" sx={{ p: 2, display: 'block' }}>
                  Only the first 200 problem rows are listed.
                </Typography>
              )}
            </Paper>
          )}

          {report.preview?.length > 0 && (
            <Paper variant="outlined">
              <Typography variant="overline" color="text.secondary" sx={{ px: 2, pt: 2, display: 'block' }}>
                Preview — first {report.preview.length} valid records
              </Typography>
              <TableContainer sx={{ maxHeight: 360 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>Employee ID</TableCell>
                      <TableCell>Code</TableCell>
                      <TableCell>Name</TableCell>
                      <TableCell>Unit</TableCell>
                      <TableCell align="right">Days with punches</TableCell>
                      <TableCell>Existing</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {report.preview.map((row) => (
                      <TableRow key={row.employeeCode ?? row.employeeId}>
                        <TableCell>{row.employeeId}</TableCell>
                        <TableCell>{row.employeeCode}</TableCell>
                        <TableCell>{row.employeeName}</TableCell>
                        <TableCell>{row.unit || '—'}</TableCell>
                        <TableCell align="right">{row.daysPresent}</TableCell>
                        <TableCell>
                          {row.alreadyUploaded ? (
                            <Chip label="Already uploaded" size="small" color="warning" variant="outlined" />
                          ) : (
                            '—'
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          )}
        </>
      )}
        </>
      )}
    </Box>
  );
};

export default AttendanceImportPage;
