import { useState } from 'react';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import DownloadIcon from '@mui/icons-material/FileDownloadOutlined';
import ExcelIcon from '@mui/icons-material/TableChartOutlined';
import PdfIcon from '@mui/icons-material/PictureAsPdfOutlined';
import PrintIcon from '@mui/icons-material/PrintOutlined';

import { downloadCsv, downloadBlob, printPage } from '@utils/exporters.js';

/**
 * One export control for every list screen.
 *
 * Server-side exporters are offered when the module has one, because they carry
 * the server's formatting and re-check the caller's rights. `onExcel` and
 * `onPdf` are the hooks for those and each returns a Blob.
 *
 * CSV and print are always available and are built from the columns already on
 * screen, so a list without a server exporter is not left with nothing. They
 * export the CURRENT PAGE only -- `rows` is what the table was handed -- which
 * the labels say outright rather than letting someone assume they have the
 * whole dataset.
 */
const ExportMenu = ({
  columns = [],
  rows = [],
  filename = 'export',
  onExcel = null,
  onPdf = null,
  totalCount = null,
  disabled = false,
  onError = null,
  size = 'small',
}) => {
  const [anchorEl, setAnchorEl] = useState(null);
  const [busy, setBusy] = useState(false);

  const close = () => setAnchorEl(null);

  const runServerExport = async (handler, extension) => {
    close();
    setBusy(true);

    try {
      const blob = await handler();
      downloadBlob(blob, `${filename}.${extension}`);
    } catch (rejection) {
      onError?.(rejection?.message ?? 'The export failed');
    } finally {
      setBusy(false);
    }
  };

  const partial = totalCount !== null && rows.length < totalCount;

  return (
    <>
      <Button
        size={size}
        startIcon={busy ? <CircularProgress size={14} /> : <DownloadIcon />}
        onClick={(event) => setAnchorEl(event.currentTarget)}
        disabled={disabled || busy}
        data-print="hide"
      >
        Export
      </Button>

      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={close}>
        {onExcel && (
          <MenuItem onClick={() => runServerExport(onExcel, 'xlsx')}>
            <ListItemIcon>
              <ExcelIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary="Excel" secondary="All matching records" />
          </MenuItem>
        )}

        {onPdf && (
          <MenuItem onClick={() => runServerExport(onPdf, 'pdf')}>
            <ListItemIcon>
              <PdfIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary="PDF" secondary="Formatted by the server" />
          </MenuItem>
        )}

        {(onExcel || onPdf) && <Divider />}

        <MenuItem
          disabled={rows.length === 0}
          onClick={() => {
            close();
            downloadCsv(columns, rows, `${filename}.csv`);
          }}
        >
          <ListItemIcon>
            <ExcelIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText
            primary="CSV"
            secondary={partial ? `This page only (${rows.length} of ${totalCount})` : `${rows.length} row(s)`}
          />
        </MenuItem>

        <MenuItem
          onClick={() => {
            close();
            printPage(filename);
          }}
        >
          <ListItemIcon>
            <PrintIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Print / Save as PDF" secondary="Uses your browser's print dialog" />
        </MenuItem>
      </Menu>
    </>
  );
};

export default ExportMenu;
