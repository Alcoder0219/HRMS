import { useCallback, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import RefreshIcon from '@mui/icons-material/Refresh';
import PdfIcon from '@mui/icons-material/PictureAsPdfOutlined';

import DataTable from '@components/common/DataTable.jsx';
import attendanceService from '@services/modules/attendance.service.js';
import { downloadBlob } from '@services/modules/employee.service.js';
import { toAttendanceClock } from '@utils/attendanceTime.js';

const EMPTY = 'No transaction records found for the selected unit and date.';

/** Today's date in the attendance time zone, as YYYY-MM-DD. */
const todayInAttendanceZone = () => {
  const clock = toAttendanceClock(new Date());
  const pad = (value) => String(value).padStart(2, '0');
  return `${clock.getFullYear()}-${pad(clock.getMonth() + 1)}-${pad(clock.getDate())}`;
};

const COLUMNS = [
  { key: 'employeeId', label: 'Employee ID' },
  { key: 'fullName', label: 'Full Name' },
  { key: 'date', label: 'Date' },
  { key: 'workCode', label: 'Work Code' },
  { key: 'recordType', label: 'Record Type' },
];

const UNMAPPED_COLUMNS = [
  { key: 'deviceUserId', label: 'Device user ID' },
  { key: 'nameOnDevice', label: 'Name on device', render: (row) => row.nameOnDevice ?? '—' },
  { key: 'date', label: 'Date' },
  { key: 'device', label: 'Device', render: (row) => row.device ?? '—' },
];

/**
 * Transaction Report: every biometric punch of one unit on one day, one row
 * per punch, as the terminals recorded them, with the PDF the terminal
 * software's own report looks like.
 */
const TransactionReportTab = ({ units = [] }) => {
  const [unitId, setUnitId] = useState('');
  const [date, setDate] = useState(todayInAttendanceZone);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState(null);

  // A single permitted unit needs no choosing.
  useEffect(() => {
    if (!unitId && units.length === 1) setUnitId(units[0]._id);
  }, [units, unitId]);

  const load = useCallback(() => {
    if (!unitId || !date) {
      setReport(null);
      return;
    }
    setLoading(true);
    setError(null);
    attendanceService
      .transactionReport({ unitId, date })
      .then((response) => setReport(response.data ?? null))
      .catch((rejection) => {
        setReport(null);
        setError(rejection?.message ?? 'Could not load the report');
      })
      .finally(() => setLoading(false));
  }, [unitId, date]);

  useEffect(() => {
    load();
  }, [load]);

  const rows = report?.rows ?? [];
  const unmapped = report?.unmapped ?? [];

  const exportPdf = async () => {
    setExporting(true);
    setError(null);
    try {
      const blob = await attendanceService.exportTransactionReportPdf({ unitId, date });
      downloadBlob(blob, `Transaction_Report_${report?.unit?.code ?? 'UNIT'}_${date}.pdf`);
    } catch (rejection) {
      setError(rejection?.status === 404 ? EMPTY : (rejection?.message ?? 'The export failed'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <Box>
      {exporting && <LinearProgress sx={{ mb: 2 }} />}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Box
        data-print="hide"
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'minmax(220px, 280px) 180px auto auto 1fr' },
          gap: 1,
          alignItems: 'center',
          mb: 2,
        }}
      >
        <TextField
          select
          required
          size="small"
          label="Unit"
          value={unitId}
          onChange={(event) => setUnitId(event.target.value)}
          error={!unitId}
          helperText={!unitId ? 'Choose a unit' : ' '}
        >
          {units.map((unit) => (
            <MenuItem key={unit._id} value={unit._id}>
              {unit.code ? `${unit.name} (${unit.code})` : unit.name}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          required
          size="small"
          type="date"
          label="Date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          error={!date}
          helperText={!date ? 'Choose a date' : ' '}
          slotProps={{ inputLabel: { shrink: true } }}
        />

        <Button
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={load}
          disabled={!unitId || !date || loading}
          sx={{ mb: 2.75 }}
        >
          Generate
        </Button>

        <Button
          variant="contained"
          startIcon={<PdfIcon />}
          onClick={exportPdf}
          disabled={!rows.length || loading || exporting}
          sx={{ mb: 2.75 }}
        >
          Export PDF
        </Button>

        {report && (
          <Chip
            label={`${rows.length} punch${rows.length === 1 ? '' : 'es'}`}
            size="small"
            variant="outlined"
            sx={{ justifySelf: 'start', mb: 2.75 }}
          />
        )}
      </Box>

      <DataTable
        columns={COLUMNS}
        rows={unitId ? rows : []}
        loading={loading}
        getKey={(row) => `${row.employeeCode}-${row.deviceLocalTime}-${row.device ?? ''}`}
        emptyTitle={unitId ? EMPTY : 'Choose a unit and date'}
        emptyMessage={unitId ? null : 'The report lists every biometric punch for one unit on one day.'}
      />

      {unmapped.length > 0 && (
        <Box sx={{ mt: 4 }}>
          <Typography variant="h6" sx={{ mb: 0.5 }}>
            Unmapped punches ({unmapped.length})
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            Recorded on this unit&apos;s devices by device users not yet mapped to an employee. They are not
            attributed to anyone above; map the device user to an employee to include them.
          </Typography>
          <DataTable
            columns={UNMAPPED_COLUMNS}
            rows={unmapped}
            getKey={(row) => `${row.device ?? ''}-${row.deviceUserId}-${row.deviceLocalTime}`}
          />
        </Box>
      )}
    </Box>
  );
};

export default TransactionReportTab;
