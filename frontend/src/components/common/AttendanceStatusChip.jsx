import Chip from '@mui/material/Chip';
import { humanize } from '@utils/format.js';

/**
 * Attendance state as a colour-coded chip.
 *
 * The mapping is semantic: worked days are positive, non-working days neutral,
 * and the two that need human attention -- absence and a missing punch -- are
 * the only ones that read as a problem. A register scanned down this column
 * should surface exceptions, not a rainbow.
 */
const STATUS_COLORS = {
  PRESENT: 'success',
  HALF_DAY: 'warning',
  ABSENT: 'error',
  MISSING_PUNCH: 'error',
  ON_LEAVE: 'info',
  HOLIDAY: 'default',
  WEEKLY_OFF: 'default',
  ON_DUTY: 'primary',
  WORK_FROM_HOME: 'primary',
};

const AttendanceStatusChip = ({ status, size = 'small' }) => {
  if (!status) return <Chip label="—" size={size} variant="outlined" />;

  return (
    <Chip
      label={humanize(status)}
      color={STATUS_COLORS[status] ?? 'default'}
      size={size}
      variant={status === 'PRESENT' ? 'filled' : 'outlined'}
    />
  );
};

export default AttendanceStatusChip;
