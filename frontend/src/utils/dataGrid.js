/**
 * Row identity for MUI DataGrid over MongoDB documents.
 *
 * The API returns Mongo documents keyed by `_id`. List endpoints use `.lean()`
 * and therefore carry ONLY `_id`; detail endpoints serialise with virtuals and
 * carry both `_id` and `id`. Any component that reached for `row.id` worked
 * against a detail response and broke against a list -- which is exactly the
 * "all rows must have a unique id" crash.
 *
 * One rule, used by every grid: `_id` first, `id` only as a fallback for
 * server-shaped DTOs that expose it. Nothing here renames or reshapes the API
 * response.
 */

/**
 * Resolves the identity of a row.
 *
 * Coerced to a string because MUI keys its internal row map by this value:
 * an ObjectId-like object would stringify to the same thing for every row and
 * present as duplicate ids.
 */
export const getRowId = (row) => {
  const id = row?._id ?? row?.id;

  if (id === null || id === undefined) {
    // Surfaced loudly in development: returning undefined here is what makes
    // the grid report every row as a duplicate, which is a confusing symptom
    // of a straightforward missing field.
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.error('[DataGrid] Row is missing both _id and id:', row);
    }
    return '';
  }

  return typeof id === 'string' || typeof id === 'number' ? String(id) : String(id?.toString?.() ?? id);
};

/** Alias for plain `<Table>` rows, so React keys follow the same rule. */
export const rowKey = getRowId;

/**
 * Display name for an employee-shaped record.
 *
 * `fullName` is a Mongoose virtual and is absent from `.lean()` list
 * responses, so it cannot be relied on. Composing from the name parts gives
 * the same string on both shapes.
 */
export const displayName = (row) =>
  row?.fullName ?? [row?.firstName, row?.middleName, row?.lastName].filter(Boolean).join(' ') ?? '';

/**
 * The employee's own ID, as shown wherever an employee is identified.
 *
 * Employees created before IDs were issued automatically have none, and
 * historical payslips carry no snapshot of one, so the absence is normal and
 * renders as a dash rather than as a gap.
 */
export const employeeIdOf = (row) => row?.employeeId ?? '—';

/**
 * The pair of identifiers, for the one-line captions under an employee's name.
 *
 * Employee ID leads because it is the identifier the business quotes; the
 * system code follows so the two are never confused for each other. Either may
 * be missing, and one alone still reads correctly.
 */
export const employeeIdentifiers = (row) =>
  [row?.employeeId, row?.employeeCode].filter(Boolean).join(' · ') || '—';

/**
 * Translates a DataGrid sort model into the API's `sortBy` / `sortOrder`.
 *
 * `fallback` matters: an unsorted paginated list can repeat and skip rows
 * between pages, so clearing the sort falls back to a stable column rather
 * than to no ordering at all.
 */
export const toSortParams = (model, fallback) =>
  model?.length ? { sortBy: model[0].field, sortOrder: model[0].sort ?? 'asc' } : fallback;

export default { getRowId, rowKey, displayName, toSortParams };
