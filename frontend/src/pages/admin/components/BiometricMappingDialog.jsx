import { useCallback, useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import DownloadIcon from '@mui/icons-material/CloudDownloadOutlined';

import FormDialog from '@components/common/FormDialog.jsx';
import { LoadingState } from '@components/common/StateBlock.jsx';
import adminService from '@services/modules/admin.service.js';
import employeeService from '@services/modules/employee.service.js';

/**
 * Matches a terminal's enrolments to employees.
 *
 * This is the step that makes a device useful, and the one nothing can do
 * automatically: a terminal knows a user by a number typed in when the finger
 * was enrolled, and nothing in that number relates to an employee code. Until
 * a mapping exists, that person's punches are read, reported as unmapped, and
 * discarded.
 *
 * The dialog reads the device rather than the database. Enrolments are added at
 * the terminal itself, so the list here is fetched live -- a cached copy would
 * quietly omit whoever was enrolled this morning.
 */

/** Employees are fetched once per dialog open; a tenant has hundreds, not millions. */
const EMPLOYEE_LIMIT = 500;

const BiometricMappingDialog = ({ open, device, onClose, onSaved }) => {
  const [users, setUsers] = useState([]);
  const [orphaned, setOrphaned] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [draft, setDraft] = useState({});

  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [fetched, setFetched] = useState(false);

  useEffect(() => {
    if (!open) return;

    // A dialog reopened on a different device must not show the previous one's
    // enrolments while the new ones load.
    setUsers([]);
    setOrphaned([]);
    setDraft({});
    setFetched(false);
    setError(null);

    employeeService
      .list({ limit: EMPLOYEE_LIMIT, sortBy: 'employeeCode', sortOrder: 'asc' })
      .then((response) => setEmployees(response.data ?? []))
      .catch(() => setEmployees([]));
  }, [open, device?._id]);

  /** Pulls the enrolment list from the terminal, with whatever is mapped already. */
  const fetchFromDevice = useCallback(async () => {
    setFetching(true);
    setError(null);

    try {
      const response = await adminService.fetchDeviceUsers(device._id);
      const payload = response.data ?? {};

      setUsers(payload.users ?? []);
      setOrphaned(payload.orphanedMappings ?? []);
      setDraft(
        Object.fromEntries(
          (payload.users ?? [])
            .filter((user) => user.employeeCode)
            .map((user) => [user.userId, user.employeeCode]),
        ),
      );
      setFetched(true);
    } catch (rejection) {
      setError(rejection?.message ?? 'The device could not be read');
    } finally {
      setFetching(false);
    }
  }, [device?._id]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    try {
      const mappings = users
        .filter((user) => draft[user.userId])
        .map((user) => ({
          deviceUserId: user.userId,
          employeeCode: draft[user.userId],
          deviceUserName: user.name ?? null,
        }));

      await adminService.mapDeviceUsers(device._id, mappings);
      onSaved(`${mappings.length} mapping(s) saved for ${device.name}`);
    } catch (rejection) {
      setError(rejection?.message ?? 'The mappings could not be saved');
    } finally {
      setSaving(false);
    }
  };

  /**
   * An employee already claimed by another device user ID.
   *
   * Two enrolments pointing at one person would double every punch they make.
   * The offending rows are marked rather than blocked, because the way out is
   * to clear the other one and the user has to be able to see which it is.
   */
  const duplicates = useMemo(() => {
    const counts = new Map();
    Object.values(draft).forEach((code) => counts.set(code, (counts.get(code) ?? 0) + 1));
    return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([code]) => code));
  }, [draft]);

  const mappedCount = Object.values(draft).filter(Boolean).length;
  const unmappedCount = users.length - mappedCount;

  return (
    <FormDialog
      open={open}
      title={`Map users — ${device?.name ?? 'device'}`}
      subtitle="Match each enrolment on the terminal to an employee. Unmapped enrolments are read and discarded."
      error={error}
      submitting={saving}
      submitLabel="Save mappings"
      disabled={!fetched || duplicates.size > 0}
      onSubmit={handleSave}
      onClose={onClose}
      maxWidth="md"
    >
      <Stack spacing={2}>
        <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
          <Button
            variant="outlined"
            size="small"
            startIcon={<DownloadIcon />}
            onClick={fetchFromDevice}
            disabled={fetching}
          >
            {device?.protocol === 'ADMS_PUSH'
              ? fetching
                ? 'Loading…'
                : fetched
                  ? 'Reload'
                  : 'Load reported users'
              : fetching
                ? 'Reading device…'
                : fetched
                  ? 'Refresh from device'
                  : 'Fetch from device'}
          </Button>

          {fetched && (
            <>
              <Chip size="small" color="success" variant="outlined" label={`${mappedCount} mapped`} />
              <Chip
                size="small"
                color={unmappedCount ? 'warning' : 'default'}
                variant="outlined"
                label={`${unmappedCount} unmapped`}
              />
            </>
          )}
        </Stack>

        {!fetched && !fetching && (
          <Alert severity="info">
            {device?.protocol === 'ADMS_PUSH' ? (
              <>
                An ADMS terminal cannot be read on demand. This lists the enrolments it has reported, every user ID it
                has punched with, and the mappings already saved. To refresh its roster, use Activity → Request upload →
                Request user list.
              </>
            ) : (
              <>
                Read the terminal to list who is enrolled on it. This opens a connection to {device?.ipAddress}:
                {device?.port}.
              </>
            )}
          </Alert>
        )}

        {fetching && <LoadingState message="Reading enrolments from the device…" minHeight={160} />}

        {duplicates.size > 0 && (
          <Alert severity="error">
            {[...duplicates].join(', ')} {duplicates.size === 1 ? 'is' : 'are'} mapped to more than one device
            user. One employee per enrolment — otherwise every punch is counted twice.
          </Alert>
        )}

        {orphaned.length > 0 && (
          <Alert severity="warning">
            {orphaned.length} saved mapping(s) point at enrolments that are no longer on the device (
            {orphaned.map((entry) => entry.deviceUserId).join(', ')}). They are kept until you save, and
            saving now will drop them.
          </Alert>
        )}

        {fetched && users.length === 0 && (
          <Alert severity="warning">
            The device reported no enrolments. Nothing can be mapped until somebody is enrolled at the
            terminal itself.
          </Alert>
        )}

        {fetched && users.length > 0 && (
          <Box sx={{ maxHeight: 380, overflowY: 'auto' }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell width={130}>Device user ID</TableCell>
                  <TableCell>Name on device</TableCell>
                  <TableCell width={110} align="right">
                    Waiting punches
                  </TableCell>
                  <TableCell width={280}>Employee</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.userId} hover>
                    <TableCell>
                      <Typography variant="caption" fontFamily="monospace">
                        {user.userId}
                      </Typography>
                    </TableCell>
                    <TableCell>{user.name ?? '—'}</TableCell>
                    <TableCell align="right">
                      {/* Stored punches that will import once this row is mapped and reprocessed. */}
                      {user.unmappedPunches ? (
                        <Chip size="small" color="warning" variant="outlined" label={user.unmappedPunches} />
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>
                      <TextField
                        select
                        size="small"
                        fullWidth
                        value={draft[user.userId] ?? ''}
                        error={Boolean(draft[user.userId]) && duplicates.has(draft[user.userId])}
                        onChange={(event) =>
                          setDraft((previous) => {
                            const next = { ...previous };
                            // An empty choice clears the mapping rather than
                            // storing a blank code the server would reject.
                            if (event.target.value) next[user.userId] = event.target.value;
                            else delete next[user.userId];
                            return next;
                          })
                        }
                      >
                        <MenuItem value="">
                          <em>Not mapped</em>
                        </MenuItem>
                        {employees.map((employee) => (
                          <MenuItem key={employee._id} value={employee.employeeCode}>
                            {employee.employeeCode} — {[employee.firstName, employee.lastName].filter(Boolean).join(' ')}
                          </MenuItem>
                        ))}
                      </TextField>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
      </Stack>
    </FormDialog>
  );
};

export default BiometricMappingDialog;
