import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import DataTable from './DataTable.jsx';
import { formatDateTime, humanize, emptyDash } from '@utils/format.js';

/**
 * Who changed what, and when.
 *
 * The change list is the reason this is worth rendering as a table rather than
 * a log line: "someone updated this department" is useless, "the code changed
 * from ENG to TECH" is the answer to the question actually being asked six
 * months later.
 *
 * Long change sets are truncated on screen rather than wrapped -- the full set
 * is in the record, and a row that grows to twenty lines makes the table
 * unreadable for every other row.
 */
const AuditTrail = ({
  entries = [],
  loading = false,
  error = null,
  onRetry = null,
  page = null,
  limit = 20,
  total = 0,
  onPageChange = null,
  onLimitChange = null,
  maxChanges = 4,
}) => {
  const columns = [
    {
      key: 'occurredAt',
      label: 'When',
      width: 170,
      render: (row) => formatDateTime(row.occurredAt),
    },
    {
      key: 'action',
      label: 'Action',
      width: 130,
      render: (row) => humanize(row.action),
    },
    {
      key: 'actorEmail',
      label: 'By',
      width: 220,
      render: (row) => (
        <Stack>
          <Typography variant="caption">{row.actorEmail ?? 'System'}</Typography>
          {row.actorRole && (
            <Typography variant="caption" color="text.secondary">
              {humanize(row.actorRole)}
            </Typography>
          )}
        </Stack>
      ),
    },
    {
      key: 'changes',
      label: 'Changes',
      render: (row) =>
        row.changes?.length ? (
          <Stack spacing={0.25}>
            {row.changes.slice(0, maxChanges).map((change) => (
              <Typography key={change.field} variant="caption">
                <strong>{change.field}</strong>: {emptyDash(change.from)} → {emptyDash(change.to)}
              </Typography>
            ))}
            {row.changes.length > maxChanges && (
              <Typography variant="caption" color="text.secondary">
                +{row.changes.length - maxChanges} more
              </Typography>
            )}
          </Stack>
        ) : (
          <Typography variant="caption" color="text.secondary">
            {/* Imports and exports carry a metadata summary rather than a diff. */}
            {row.metadata
              ? Object.entries(row.metadata)
                  .map(([key, value]) => `${humanize(key)}: ${value}`)
                  .join(' · ')
              : '—'}
          </Typography>
        ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={entries}
      loading={loading}
      error={error}
      onRetry={onRetry}
      emptyTitle="No audit entries"
      emptyMessage="Changes to this record will be listed here."
      page={page}
      limit={limit}
      total={total}
      onPageChange={onPageChange}
      onLimitChange={onLimitChange}
    />
  );
};

export default AuditTrail;
