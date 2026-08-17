import Chip from '@mui/material/Chip';
import { humanize } from '@utils/format.js';

/**
 * Lifecycle status as a colour-coded chip.
 *
 * The mapping is semantic, not decorative: currently-employed states are
 * positive, the exit ramp is warning, and completed exits are neutral or
 * negative. A scan down the column should read as a state, not a rainbow.
 */
const STATUS_COLORS = {
  PROBATION: 'info',
  ACTIVE: 'success',
  NOTICE_PERIOD: 'warning',
  RESIGNED: 'default',
  TERMINATED: 'error',
  RETIRED: 'default',
};

const StatusChip = ({ status, size = 'small' }) => (
  <Chip
    label={humanize(status)}
    color={STATUS_COLORS[status] ?? 'default'}
    size={size}
    variant={status === 'ACTIVE' ? 'filled' : 'outlined'}
  />
);

export default StatusChip;
