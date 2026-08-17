import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import SaveIcon from '@mui/icons-material/SaveOutlined';

import attendanceService from '@services/modules/attendance.service.js';
import { formatDateTime, humanize } from '@utils/format.js';
import { getRowId } from '@utils/dataGrid.js';

const MONTHS = Array.from({ length: 12 }, (_, index) =>
  new Date(2000, index).toLocaleString([], { month: 'long' }),
);

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * One monthly sheet, day by day, with in/out times editable in place.
 *
 * Corrections happen here rather than through a regularization when the
 * original workbook was wrong: a regularization is an employee disputing what
 * was recorded, while this is fixing what was imported. They are different
 * events and the audit trail should be able to tell them apart.
 *
 * Only days that actually changed are sent, so an accidental save is a no-op
 * rather than a rewrite of all 31 rows.
 */
const SheetDetailDialog = ({ sheet, canEdit = false, onClose, onSaved }) => {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('md'));

  const [days, setDays] = useState([]);
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!sheet) return;

    setDays((sheet.attendance ?? []).map((day) => ({ ...day })));
    setRemarks(sheet.remarks ?? '');
    setError(null);
  }, [sheet]);

  if (!sheet) return null;

  const set = (index, field) => (event) => {
    const value = event.target.value;

    setDays((previous) =>
      previous.map((day, position) => (position === index ? { ...day, [field]: value } : day)),
    );
  };

  const invalid = days.some(
    (day) =>
      (day.inTime && !TIME.test(day.inTime)) || (day.outTime && !TIME.test(day.outTime)),
  );

  /** Days whose times or remark differ from what was loaded. */
  const changed = days.filter((day, index) => {
    const original = sheet.attendance?.[index] ?? {};
    return (
      (day.inTime ?? '') !== (original.inTime ?? '') ||
      (day.outTime ?? '') !== (original.outTime ?? '') ||
      (day.remark ?? '') !== (original.remark ?? '')
    );
  });

  const dirty = changed.length > 0 || remarks !== (sheet.remarks ?? '');

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    try {
      await attendanceService.updateSheet(getRowId(sheet), {
        // The whole array is sent because the API replaces it, but only a
        // changed sheet ever gets here.
        attendance: days.map(({ day, inTime, outTime, remark }) => ({
          day,
          inTime: inTime || null,
          outTime: outTime || null,
          remark: remark || null,
        })),
        remarks: remarks.trim() || null,
      });

      onSaved(`Sheet updated — ${changed.length} day(s) corrected`);
    } catch (rejection) {
      setError(rejection?.message ?? 'The sheet could not be saved');
    } finally {
      setSaving(false);
    }
  };

  const summary = sheet.summary ?? {};

  const tile = (label, value) => (
    <Grid size={{ xs: 4, sm: 3, md: 2 }}>
      <Box sx={{ p: 1, border: 1, borderColor: 'divider', borderRadius: 1, textAlign: 'center' }}>
        <Typography variant="caption" color="text.secondary" display="block" noWrap>
          {label}
        </Typography>
        <Typography variant="h6">{value ?? 0}</Typography>
      </Box>
    </Grid>
  );

  return (
    <Dialog open onClose={onClose} maxWidth="lg" fullWidth fullScreen={fullScreen}>
      <DialogTitle>
        {sheet.employeeName ?? sheet.employeeId}
        <Typography variant="body2" color="text.secondary">
          {MONTHS[sheet.month - 1]} {sheet.year}
          {sheet.unit ? ` · ${sheet.unit}` : ''} · uploaded {formatDateTime(sheet.uploadedAt ?? sheet.createdAt)}
        </Typography>
      </DialogTitle>

      <DialogContent dividers>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Grid container spacing={1} sx={{ mb: 2 }}>
          {tile('Present', summary.present)}
          {tile('Absent', summary.absent)}
          {tile('Half day', summary.halfDay)}
          {tile('Weekly off', summary.weeklyOff)}
          {tile('Holiday', summary.holiday)}
          {tile('Payable', summary.payableDays)}
          {tile('Late', summary.lateComing)}
          {tile('Early', summary.earlyGoing)}
          {tile('Missing punch', summary.missingPunch)}
          {tile(
            'Overtime',
            summary.overtimeMinutes
              ? `${Math.floor(summary.overtimeMinutes / 60)}h ${summary.overtimeMinutes % 60}m`
              : '—',
          )}
        </Grid>

        <Alert severity="info" variant="outlined" sx={{ mb: 2 }}>
          {canEdit
            ? 'Correcting a time here re-grades that day against the attendance policy when the sheet is saved.'
            : 'Read-only. Correcting an imported sheet needs attendance approval rights.'}
        </Alert>

        <Box sx={{ maxHeight: 420, overflowY: 'auto' }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell width={70}>Day</TableCell>
                <TableCell width={120}>In</TableCell>
                <TableCell width={120}>Out</TableCell>
                <TableCell>Remark</TableCell>
              </TableRow>
            </TableHead>

            <TableBody>
              {days.map((day, index) => {
                const original = sheet.attendance?.[index] ?? {};
                const isChanged =
                  (day.inTime ?? '') !== (original.inTime ?? '') ||
                  (day.outTime ?? '') !== (original.outTime ?? '') ||
                  (day.remark ?? '') !== (original.remark ?? '');

                return (
                  <TableRow key={day.day} sx={isChanged ? { bgcolor: 'action.hover' } : undefined}>
                    <TableCell>
                      <Stack direction="row" spacing={0.5} alignItems="center">
                        <Typography variant="body2">{day.day}</Typography>
                        {isChanged && <Chip label="edited" size="small" color="warning" sx={{ height: 16, fontSize: 9 }} />}
                      </Stack>
                    </TableCell>

                    <TableCell>
                      <TextField
                        size="small"
                        value={day.inTime ?? ''}
                        onChange={set(index, 'inTime')}
                        disabled={!canEdit}
                        placeholder="HH:mm"
                        error={Boolean(day.inTime) && !TIME.test(day.inTime)}
                        slotProps={{ htmlInput: { maxLength: 5, style: { padding: '6px 8px' } } }}
                      />
                    </TableCell>

                    <TableCell>
                      <TextField
                        size="small"
                        value={day.outTime ?? ''}
                        onChange={set(index, 'outTime')}
                        disabled={!canEdit}
                        placeholder="HH:mm"
                        error={Boolean(day.outTime) && !TIME.test(day.outTime)}
                        slotProps={{ htmlInput: { maxLength: 5, style: { padding: '6px 8px' } } }}
                      />
                    </TableCell>

                    <TableCell>
                      <TextField
                        size="small"
                        fullWidth
                        value={day.remark ?? ''}
                        onChange={set(index, 'remark')}
                        disabled={!canEdit}
                        slotProps={{ htmlInput: { maxLength: 120, style: { padding: '6px 8px' } } }}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}

              {days.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4}>
                    <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                      This sheet has no day rows.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Box>

        {canEdit && (
          <TextField
            label="Remarks"
            value={remarks}
            onChange={(event) => setRemarks(event.target.value)}
            fullWidth
            size="small"
            sx={{ mt: 2 }}
            slotProps={{ htmlInput: { maxLength: 500 } }}
          />
        )}

        {sheet.source && (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
            Source: {humanize(sheet.source)}
            {sheet.fileName ? ` · ${sheet.fileName}` : ''}
          </Typography>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} color="inherit">
          Close
        </Button>

        {canEdit && (
          <Button
            variant="contained"
            startIcon={<SaveIcon />}
            onClick={handleSave}
            disabled={!dirty || invalid || saving}
          >
            {saving ? 'Saving…' : `Save ${changed.length || ''} change${changed.length === 1 ? '' : 's'}`.trim()}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default SheetDetailDialog;
