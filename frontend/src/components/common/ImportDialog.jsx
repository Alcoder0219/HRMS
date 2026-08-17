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
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import UploadIcon from '@mui/icons-material/UploadFileOutlined';
import DownloadIcon from '@mui/icons-material/FileDownloadOutlined';

import { downloadBlob } from '@utils/exporters.js';

/**
 * Two-step bulk import: validate, then commit.
 *
 * The dry run is not optional politeness -- a spreadsheet of a few thousand
 * rows will always contain some bad ones, and finding them one failed request
 * at a time is unusable. The server returns every problem at once and writes
 * nothing until the result has been seen and confirmed.
 *
 * Module-agnostic: the caller supplies the three operations, so Employees and
 * every Organization master share this one dialog rather than each carrying a
 * copy that drifts.
 *
 *   onTemplate() -> Blob
 *   onImport(file, dryRun) -> { total|totalRows, valid, failed, errors[], ... }
 */
const ImportDialog = ({
  open,
  title = 'Import',
  templateName = 'import-template.xlsx',
  description = null,
  onTemplate,
  onImport,
  onClose,
  onImported,
}) => {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));

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
      downloadBlob(await onTemplate(), templateName);
    } catch (rejection) {
      setError(rejection?.message ?? 'Could not download the template');
    }
  };

  const run = async (dryRun) => {
    setBusy(true);
    setError(null);

    try {
      const response = await onImport(file, dryRun);
      const data = response?.data ?? response;

      setResult({ ...data, dryRun });

      // `imported` on the employee endpoint, `created`/`updated` on the
      // organization one -- any of them means something actually changed.
      const wrote = (data.imported ?? 0) + (data.created ?? 0) + (data.updated ?? 0);
      if (!dryRun && wrote > 0) onImported?.(data);
    } catch (rejection) {
      setError(rejection?.message ?? 'The file could not be processed');
    } finally {
      setBusy(false);
    }
  };

  const committed = result && !result.dryRun;
  const validated = result && result.dryRun;
  const totalRows = result?.totalRows ?? result?.total ?? 0;

  const summary = () => {
    if (!result) return null;

    if (committed) {
      const wrote = result.imported ?? (result.created ?? 0) + (result.updated ?? 0);
      const detail =
        result.created !== undefined
          ? `${result.created} created, ${result.updated} updated`
          : `${wrote} imported`;

      return `${detail} of ${totalRows} row(s)`;
    }

    const detail =
      result.toCreate !== undefined
        ? `${result.toCreate} new, ${result.toUpdate} update(s)`
        : `${result.valid} ready`;

    return `${result.valid} of ${totalRows} row(s) are ready — ${detail}`;
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth fullScreen={fullScreen}>
      <DialogTitle>{title}</DialogTitle>

      <DialogContent dividers>
        <Stack spacing={2}>
          <Alert severity="info" variant="outlined">
            {description ??
              'Download the template first. Column headers must match it — extra columns are ignored, and the file is validated before anything is written.'}
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
            {file && (
              <Typography variant="caption" color="text.secondary">
                {(file.size / 1024).toFixed(0)} KB
              </Typography>
            )}
          </Box>

          {busy && <LinearProgress />}

          {error && <Alert severity="error">{error}</Alert>}

          {result && (
            <Alert severity={result.failed > 0 ? 'warning' : 'success'}>
              <AlertTitle>{summary()}</AlertTitle>
              {result.failed > 0 && `${result.failed} row(s) have errors and are skipped. `}
              {result.truncated && 'The file exceeded the row limit and was truncated.'}
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

          {result?.errorsTruncated && (
            <Typography variant="caption" color="text.secondary">
              Only the first problem rows are listed.
            </Typography>
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
            // Committing is gated on a successful dry run with at least one
            // usable row, so nobody imports a file they have not seen checked.
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

export default ImportDialog;
