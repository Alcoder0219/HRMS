import { useState } from 'react';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import LinearProgress from '@mui/material/LinearProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import UploadIcon from '@mui/icons-material/UploadFileOutlined';
import DownloadIcon from '@mui/icons-material/FileDownloadOutlined';

import attendanceService from '@services/modules/attendance.service.js';
import { downloadBlob } from '@services/modules/employee.service.js';

/**
 * Two-step attendance upload: validate, then commit.
 *
 * Same contract as the employee importer, for the same reason -- a month of
 * attendance always contains bad rows, and the server writes nothing until the
 * user has seen the full error list.
 */
const AttendanceImportDialog = ({ open, onClose, onImported }) => {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const reset = () => {
    setFile(null);
    setResult(null);
    setError(null);
    setBusy(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleTemplate = async () => {
    try {
      const blob = await attendanceService.downloadTemplate();
      downloadBlob(blob, 'attendance-import-template.xlsx');
    } catch (rejection) {
      setError(rejection?.message ?? 'Could not download the template');
    }
  };

  const run = async (dryRun) => {
    setBusy(true);
    setError(null);

    try {
      const response = await attendanceService.importFile(file, dryRun);
      setResult({ ...response.data, dryRun });
      if (!dryRun && response.data.imported > 0) onImported();
    } catch (rejection) {
      setError(rejection?.message ?? 'The file could not be processed');
    } finally {
      setBusy(false);
    }
  };

  const validated = result && result.dryRun;
  const committed = result && !result.dryRun;

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle>Import attendance</DialogTitle>

      <DialogContent dividers>
        <Stack spacing={2}>
          <Alert severity="info" variant="outlined">
            Columns must match the template. Times may be `HH:mm` or a full
            date-time. An uploaded row replaces that day&apos;s punches, so
            re-uploading a corrected file is safe.
          </Alert>

          <Box>
            <Button startIcon={<DownloadIcon />} onClick={handleTemplate} variant="outlined" color="inherit">
              Download template
            </Button>
          </Box>

          <Box
            component="label"
            sx={{
              border: '1px dashed',
              borderColor: 'divider',
              borderRadius: 2,
              p: 3,
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
                setResult(null);
                setError(null);
              }}
            />
            <UploadIcon color="action" />
            <Typography variant="body2" sx={{ mt: 1 }}>
              {file ? file.name : 'Choose an .xlsx file'}
            </Typography>
          </Box>

          {busy && <LinearProgress />}
          {error && <Alert severity="error">{error}</Alert>}

          {result && (
            <Alert severity={result.failed > 0 ? 'warning' : 'success'}>
              <AlertTitle>
                {committed
                  ? `Imported ${result.imported} of ${result.totalRows} rows`
                  : `${result.valid} of ${result.totalRows} rows are ready`}
              </AlertTitle>
              {result.failed > 0 && `${result.failed} row(s) have errors and will be skipped.`}
            </Alert>
          )}

          {result?.errors?.length > 0 && (
            <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 260 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell width={80}>Row</TableCell>
                    <TableCell>Problem</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {result.errors.map((row) => (
                    <TableRow key={row.row}>
                      <TableCell>{row.row}</TableCell>
                      <TableCell>
                        <Typography variant="body2" color="error.main">
                          {row.errors.join('; ')}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={handleClose} color="inherit">
          {committed ? 'Close' : 'Cancel'}
        </Button>

        {!committed && (
          <Button onClick={() => run(true)} disabled={!file || busy} variant="outlined">
            Validate
          </Button>
        )}

        {!committed && (
          <Button
            onClick={() => run(false)}
            // Committing requires a clean dry run with at least one usable row.
            disabled={!validated || busy || result.valid === 0}
            variant="contained"
          >
            Import {validated ? `${result.valid} row(s)` : ''}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default AttendanceImportDialog;
