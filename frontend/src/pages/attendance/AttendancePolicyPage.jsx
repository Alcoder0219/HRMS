import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import SaveIcon from '@mui/icons-material/SaveOutlined';

import PageHeader from '@components/common/PageHeader.jsx';
import usePermissions from '@hooks/usePermissions.js';
import { RESOURCES, ACTIONS } from '@utils/permissions.js';
import attendanceService from '@services/modules/attendance.service.js';
import { PATHS } from '@routes/paths.js';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * The thresholds the attendance rules engine grades every day against.
 *
 * These values were previously only reachable through the API, which meant the
 * behaviour of the whole attendance module -- what counts as late, what counts
 * as half a day, whether overtime is paid at all -- was invisible to the people
 * responsible for it.
 */
const AttendancePolicyPage = () => {
  const { can } = usePermissions();
  // The API gates the write on UPDATE; the form mirrors it so a reader is not
  // offered a Save button the server will refuse.
  const canEdit = can(RESOURCES.ATTENDANCE, ACTIONS.UPDATE);

  const [policy, setPolicy] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    attendanceService
      .policy()
      .then((response) => setPolicy(response.data))
      .catch((rejection) =>
        setNotice({ severity: 'error', message: rejection?.message ?? 'Could not load the policy' }),
      )
      .finally(() => setLoading(false));
  }, []);

  const set = (field) => (event) => {
    const raw = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    const value = event.target.type === 'number' ? Number(raw) : raw;
    setPolicy((previous) => ({ ...previous, [field]: value }));
  };

  const toggleWeeklyOff = (day) => () =>
    setPolicy((previous) => {
      const current = new Set(previous.weeklyOffs ?? []);
      if (current.has(day)) current.delete(day);
      else current.add(day);
      return { ...previous, weeklyOffs: [...current].sort() };
    });

  const handleSave = async () => {
    setSaving(true);
    setNotice(null);

    try {
      // Only the tunable fields are sent. Echoing _id, tenantId and timestamps
      // back would be rejected by the validator, which allows no unknown keys.
      const response = await attendanceService.savePolicy({
        name: policy.name,
        fullDayMinutes: policy.fullDayMinutes,
        halfDayMinutes: policy.halfDayMinutes,
        lateGraceMinutes: policy.lateGraceMinutes,
        earlyGoingGraceMinutes: policy.earlyGoingGraceMinutes,
        latesPerHalfDayDeduction: policy.latesPerHalfDayDeduction,
        overtimeEnabled: policy.overtimeEnabled,
        minOvertimeMinutes: policy.minOvertimeMinutes,
        maxOvertimeMinutes: policy.maxOvertimeMinutes,
        overtimeAfterShiftEnd: policy.overtimeAfterShiftEnd,
        compOffEnabled: policy.compOffEnabled,
        compOffMinMinutes: policy.compOffMinMinutes,
        compOffExpiryDays: policy.compOffExpiryDays,
        autoAbsentOnNoPunch: policy.autoAbsentOnNoPunch,
        countBreakAsWorked: policy.countBreakAsWorked,
        weeklyOffs: policy.weeklyOffs,
        geofenceEnabled: policy.geofenceEnabled,
        rejectOutsideGeofence: policy.rejectOutsideGeofence,
        regularizationEnabled: policy.regularizationEnabled,
        regularizationWindowDays: policy.regularizationWindowDays,
        maxRegularizationsPerMonth: policy.maxRegularizationsPerMonth,
      });

      setPolicy(response.data);
      setNotice({ severity: 'success', message: 'Policy saved. New grading applies from the next recompute.' });
    } catch (rejection) {
      setNotice({ severity: 'error', message: rejection?.message ?? 'Could not save the policy' });
    } finally {
      setSaving(false);
    }
  };

  const number = (label, field, helper = null, extra = {}) => (
    <TextField
      label={label}
      type="number"
      value={policy?.[field] ?? ''}
      onChange={set(field)}
      helperText={helper}
      disabled={!canEdit}
      fullWidth
      size="small"
      slotProps={{ input: { inputProps: extra } }}
    />
  );

  const toggle = (label, field, helper = null) => (
    <Box>
      <FormControlLabel
        control={<Switch checked={Boolean(policy?.[field])} onChange={set(field)} disabled={!canEdit} />}
        label={label}
      />
      {helper && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ ml: 6, mt: -0.5 }}>
          {helper}
        </Typography>
      )}
    </Box>
  );

  const section = (title, description, children) => (
    <Card variant="outlined" sx={{ mb: 2 }}>
      <CardContent>
        <Typography variant="h6">{title}</Typography>
        <Typography variant="caption" color="text.secondary">
          {description}
        </Typography>
        <Divider sx={{ my: 2 }} />
        {children}
      </CardContent>
    </Card>
  );

  if (loading) {
    return (
      <Box>
        <PageHeader title="Attendance Policies" subtitle="Loading…" />
      </Box>
    );
  }

  if (!policy) {
    return (
      <Box>
        <PageHeader
          title="Attendance Policies"
          breadcrumbs={[{ label: 'Home', to: PATHS.dashboard }, { label: 'Attendance' }, { label: 'Policies' }]}
        />
        <Alert severity="info">
          No attendance policy has been configured for this organisation. Until one exists, the rules engine
          grades against its built-in defaults.
        </Alert>
      </Box>
    );
  }

  return (
    <Box>
      <PageHeader
        title="Attendance Policies"
        subtitle="Thresholds every attendance day is graded against"
        breadcrumbs={[
          { label: 'Home', to: PATHS.dashboard },
          { label: 'Attendance', to: PATHS.attendance },
          { label: 'Policies' },
        ]}
        actions={
          canEdit && (
            <Button variant="contained" startIcon={<SaveIcon />} onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save policy'}
            </Button>
          )
        }
      />

      {notice && (
        <Alert severity={notice.severity} sx={{ mb: 2 }} onClose={() => setNotice(null)}>
          {notice.message}
        </Alert>
      )}

      {!canEdit && (
        <Alert severity="info" sx={{ mb: 2 }}>
          You have read access to this policy. Changing it needs attendance update rights.
        </Alert>
      )}

      {section(
        'Day thresholds',
        'How many minutes of recorded work a day must reach to count as full or half.',
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>{number('Full day (minutes)', 'fullDayMinutes', 'Capped at the rostered shift length', { min: 60, max: 900 })}</Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>{number('Half day (minutes)', 'halfDayMinutes', 'Must be below the full-day bar', { min: 30, max: 600 })}</Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>{number('Late grace (minutes)', 'lateGraceMinutes', 'Arrival tolerance before a day is marked late', { min: 0, max: 120 })}</Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>{number('Early-going grace (minutes)', 'earlyGoingGraceMinutes', null, { min: 0, max: 120 })}</Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            {number('Lates per half-day deduction', 'latesPerHalfDayDeduction', '0 disables the monthly pattern rule', { min: 0, max: 10 })}
          </Grid>
        </Grid>,
      )}

      {section(
        'Overtime',
        'Whether extra time is captured, and the band that counts.',
        <Grid container spacing={2} alignItems="center">
          <Grid size={{ xs: 12, md: 4 }}>{toggle('Capture overtime', 'overtimeEnabled')}</Grid>
          <Grid size={{ xs: 12, sm: 6, md: 4 }}>{number('Minimum (minutes)', 'minOvertimeMinutes', 'Below this, extra time is ignored', { min: 0, max: 240 })}</Grid>
          <Grid size={{ xs: 12, sm: 6, md: 4 }}>{number('Maximum (minutes)', 'maxOvertimeMinutes', 'Daily ceiling', { min: 0, max: 720 })}</Grid>
          <Grid size={12}>{toggle('Count only after shift end', 'overtimeAfterShiftEnd', 'Off means early arrival counts too')}</Grid>
        </Grid>,
      )}

      {section(
        'Compensatory off',
        'Credit earned by working a holiday or weekly off.',
        <Grid container spacing={2} alignItems="center">
          <Grid size={{ xs: 12, md: 4 }}>{toggle('Enable comp off', 'compOffEnabled')}</Grid>
          <Grid size={{ xs: 12, sm: 6, md: 4 }}>{number('Minimum worked (minutes)', 'compOffMinMinutes', null, { min: 60, max: 720 })}</Grid>
          <Grid size={{ xs: 12, sm: 6, md: 4 }}>{number('Expires after (days)', 'compOffExpiryDays', null, { min: 7, max: 365 })}</Grid>
        </Grid>,
      )}

      {section(
        'Week pattern and defaults',
        'Which days are non-working, and what happens when nobody punches.',
        <Stack spacing={2}>
          <Box>
            <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
              Weekly offs
            </Typography>
            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
              {DAYS.map((label, day) => (
                <Chip
                  key={label}
                  label={label.slice(0, 3)}
                  size="small"
                  color={policy.weeklyOffs?.includes(day) ? 'primary' : 'default'}
                  variant={policy.weeklyOffs?.includes(day) ? 'filled' : 'outlined'}
                  onClick={canEdit ? toggleWeeklyOff(day) : undefined}
                />
              ))}
            </Stack>
          </Box>

          {toggle('Mark absent when no punch is recorded', 'autoAbsentOnNoPunch')}
          {toggle('Count break time as worked', 'countBreakAsWorked')}
        </Stack>,
      )}

      {section(
        'Geofencing',
        'Whether a punch is checked against a registered site.',
        <Stack spacing={1}>
          {toggle('Enable geofencing', 'geofenceEnabled')}
          {toggle(
            'Reject punches outside a site',
            'rejectOutsideGeofence',
            'Off records the punch and flags it instead — useful while rolling geofencing out',
          )}
          <Typography variant="caption" color="text.secondary">
            {policy.geofenceSites?.length ?? 0} site(s) registered. Sites are managed through the API.
          </Typography>
        </Stack>,
      )}

      {section(
        'Regularization',
        'How long a recorded day stays open to correction.',
        <Grid container spacing={2} alignItems="center">
          <Grid size={{ xs: 12, md: 4 }}>{toggle('Allow regularization', 'regularizationEnabled')}</Grid>
          <Grid size={{ xs: 12, sm: 6, md: 4 }}>{number('Window (days)', 'regularizationWindowDays', 'Beyond this the month is closed', { min: 1, max: 90 })}</Grid>
          <Grid size={{ xs: 12, sm: 6, md: 4 }}>{number('Maximum per month', 'maxRegularizationsPerMonth', null, { min: 0, max: 31 })}</Grid>
        </Grid>,
      )}
    </Box>
  );
};

export default AttendancePolicyPage;
