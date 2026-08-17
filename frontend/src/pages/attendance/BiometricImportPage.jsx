import { useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import UploadIcon from '@mui/icons-material/UploadFileOutlined';
import SendIcon from '@mui/icons-material/SendOutlined';
import FingerprintIcon from '@mui/icons-material/FingerprintOutlined';

import PageHeader from '@components/common/PageHeader.jsx';
import DataTable from '@components/common/DataTable.jsx';
import StatCard from '@components/common/StatCard.jsx';
import attendanceService from '@services/modules/attendance.service.js';
import { formatDateTime } from '@utils/format.js';
import { PATHS } from '@routes/paths.js';

const DIRECTIONS = ['UNKNOWN', 'IN', 'OUT'];

const SAMPLE = `EMP0001, 2026-08-06 09:04, IN
EMP0001, 2026-08-06 18:12, OUT
EMP0002, 2026-08-06 09:31, IN`;

/**
 * Ingests raw punches from a biometric device.
 *
 * `POST /attendance/biometric` has existed since the Attendance module was
 * built but had no screen, so punches could only be pushed by a device
 * integration. This gives the same endpoint a manual path -- for a device with
 * no network route, or for the exports produced when one has been offline.
 *
 * Deliberately not a spreadsheet importer. Device exports are punch streams,
 * not attendance rows: direction is often absent and the rules engine infers it
 * from what is already recorded. The monthly Excel importer is the other screen
 * and solves the other problem.
 */
const BiometricImportPage = () => {
  const [tab, setTab] = useState('paste');
  const [deviceId, setDeviceId] = useState('');
  const [raw, setRaw] = useState('');
  const [defaultDirection, setDefaultDirection] = useState('UNKNOWN');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  /**
   * Parses `code, timestamp, direction` per line.
   *
   * Comma, tab and semicolon all separate, because device exports disagree.
   * Direction is optional -- when it is missing the server infers it from the
   * day already recorded, which is more reliable than a guess made here.
   */
  const parsed = useMemo(() => {
    const rows = [];
    const errors = [];

    raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line, index) => {
        const lineNumber = index + 1;
        const parts = line.split(/[,;\t]/).map((part) => part.trim());

        const [employeeCode, timestamp, direction] = parts;

        if (!employeeCode || !timestamp) {
          errors.push({ line: lineNumber, raw: line, error: 'Needs at least an employee code and a timestamp' });
          return;
        }

        const when = new Date(timestamp);
        if (Number.isNaN(when.getTime())) {
          errors.push({ line: lineNumber, raw: line, error: `"${timestamp}" is not a date the browser understands` });
          return;
        }

        const resolved = (direction ?? '').toUpperCase();
        if (resolved && !DIRECTIONS.includes(resolved)) {
          errors.push({ line: lineNumber, raw: line, error: `"${direction}" is not IN, OUT or UNKNOWN` });
          return;
        }

        rows.push({
          line: lineNumber,
          employeeCode,
          timestamp: when.toISOString(),
          direction: resolved || defaultDirection,
        });
      });

    return { rows, errors };
  }, [raw, defaultDirection]);

  const handleFile = (file) => {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      setRaw(String(reader.result ?? ''));
      setResult(null);
      setError(null);
    };
    reader.readAsText(file);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    setResult(null);

    try {
      const response = await attendanceService.biometric({
        deviceId: deviceId.trim() || undefined,
        punches: parsed.rows.map(({ employeeCode, timestamp, direction }) => ({
          employeeCode,
          timestamp,
          direction,
        })),
      });

      setResult(response.data ?? {});
    } catch (rejection) {
      setError(rejection?.message ?? 'The punches could not be ingested');
    } finally {
      setBusy(false);
    }
  };

  const previewColumns = [
    { key: 'line', label: 'Line', width: 70 },
    { key: 'employeeCode', label: 'Employee code' },
    { key: 'timestamp', label: 'Punched at', render: (row) => formatDateTime(row.timestamp) },
    {
      key: 'direction',
      label: 'Direction',
      render: (row) => (
        <Chip
          label={row.direction}
          size="small"
          variant="outlined"
          color={row.direction === 'IN' ? 'success' : row.direction === 'OUT' ? 'info' : 'default'}
        />
      ),
    },
  ];

  const errorColumns = [
    { key: 'line', label: 'Line', width: 70 },
    {
      key: 'raw',
      label: 'Content',
      render: (row) => (
        <Typography variant="caption" fontFamily="monospace">
          {row.raw}
        </Typography>
      ),
    },
    {
      key: 'error',
      label: 'Problem',
      render: (row) => (
        <Typography variant="caption" color="error.main">
          {row.error}
        </Typography>
      ),
    },
  ];

  const overLimit = parsed.rows.length > 5000;

  return (
    <Box>
      <PageHeader
        title="Biometric Import"
        subtitle="Push raw device punches into attendance"
        breadcrumbs={[
          { label: 'Home', to: PATHS.dashboard },
          { label: 'Attendance', to: PATHS.attendance },
          { label: 'Biometric Import' },
        ]}
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {result && (
        <Alert
          severity={result.unknownEmployeeCodes?.length || result.invalidRows ? 'warning' : 'success'}
          sx={{ mb: 2 }}
          onClose={() => setResult(null)}
        >
          <AlertTitle>
            {result.received} punch(es) received · {result.daysUpdated} day(s) re-graded
          </AlertTitle>

          {result.invalidRows > 0 && <div>{result.invalidRows} punch(es) were rejected by the server.</div>}

          {result.unknownEmployeeCodes?.length > 0 && (
            <Box sx={{ mt: 1 }}>
              {/* The most common failure by far: a device configured with codes
                  that were never issued, or issued in a different format. */}
              <Typography variant="body2">
                {result.unknownEmployeeCodes.length} employee code(s) did not match anyone:
              </Typography>
              <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
                {result.unknownEmployeeCodes.slice(0, 20).map((code) => (
                  <Chip key={code} label={code} size="small" variant="outlined" color="warning" />
                ))}
                {result.unknownEmployeeCodes.length > 20 && (
                  <Chip label={`+${result.unknownEmployeeCodes.length - 20} more`} size="small" />
                )}
              </Stack>
            </Box>
          )}
        </Alert>
      )}

      <Alert severity="info" sx={{ mb: 3 }}>
        Each punch is a single event, not a day. The rules engine pairs them and re-grades the day against
        the attendance policy — late, early, half day and overtime are all derived from that, never sent
        here.
      </Alert>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard label="Punches ready" value={parsed.rows.length} icon={FingerprintIcon} />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard
            label="Lines with problems"
            value={parsed.errors.length}
            color={parsed.errors.length ? 'warning' : 'success'}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard
            label="Employees"
            value={new Set(parsed.rows.map((row) => row.employeeCode)).size}
            caption="Distinct codes in this batch"
          />
        </Grid>
      </Grid>

      <Card variant="outlined" sx={{ mb: 3 }}>
        <CardContent>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                label="Device ID"
                size="small"
                fullWidth
                value={deviceId}
                onChange={(event) => setDeviceId(event.target.value)}
                helperText="Optional — recorded against every punch"
              />
            </Grid>

            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                select
                label="Direction when not stated"
                size="small"
                fullWidth
                value={defaultDirection}
                onChange={(event) => setDefaultDirection(event.target.value)}
                helperText="UNKNOWN lets the server infer it"
              >
                {DIRECTIONS.map((direction) => (
                  <MenuItem key={direction} value={direction}>
                    {direction}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
          </Grid>

          <Divider sx={{ my: 2 }} />

          <Tabs value={tab} onChange={(_event, next) => setTab(next)} sx={{ mb: 2 }}>
            <Tab value="paste" label="Paste" />
            <Tab value="file" label="Upload a file" />
          </Tabs>

          {tab === 'paste' ? (
            <TextField
              label="Punches"
              multiline
              minRows={8}
              fullWidth
              value={raw}
              onChange={(event) => {
                setRaw(event.target.value);
                setResult(null);
              }}
              placeholder={SAMPLE}
              helperText="One punch per line: employee code, timestamp, direction. Comma, tab or semicolon separated."
              slotProps={{ input: { sx: { fontFamily: 'monospace', fontSize: 13 } } }}
            />
          ) : (
            <Box
              component="label"
              sx={{
                border: '1px dashed',
                borderColor: 'divider',
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
                accept=".txt,.csv,.log,.dat"
                onChange={(event) => handleFile(event.target.files?.[0])}
              />
              <UploadIcon color="action" />
              <Typography variant="body2" sx={{ mt: 1 }}>
                Choose a device export
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Plain text or CSV — the contents are parsed in the browser and shown below before anything is
                sent
              </Typography>
            </Box>
          )}
        </CardContent>
      </Card>

      {busy && <LinearProgress sx={{ mb: 2 }} />}

      {overLimit && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          The endpoint accepts 5,000 punches per request and this batch has {parsed.rows.length}. Split the
          file before submitting.
        </Alert>
      )}

      {parsed.errors.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 1 }}>
            Lines that will be skipped
          </Typography>
          <DataTable columns={errorColumns} rows={parsed.errors} getKey={(row) => row.line} />
        </Box>
      )}

      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="h6">Preview</Typography>
        <Button
          variant="contained"
          startIcon={<SendIcon />}
          disabled={busy || parsed.rows.length === 0 || overLimit}
          onClick={submit}
        >
          Send {parsed.rows.length || ''} punch{parsed.rows.length === 1 ? '' : 'es'}
        </Button>
      </Stack>

      <DataTable
        columns={previewColumns}
        rows={parsed.rows.slice(0, 200)}
        getKey={(row) => row.line}
        emptyTitle="Nothing to send yet"
        emptyMessage="Paste device output above, or upload an export file."
      />

      {parsed.rows.length > 200 && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
          Showing the first 200 of {parsed.rows.length}. All of them are sent.
        </Typography>
      )}
    </Box>
  );
};

export default BiometricImportPage;
