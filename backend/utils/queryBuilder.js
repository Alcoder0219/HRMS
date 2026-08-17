/**
 * Translates validated list-query parameters into MongoDB filter, sort and
 * pagination fragments.
 *
 * Shared by every list endpoint so pagination, sorting and search behave
 * identically across modules -- and so the rules that keep them safe are
 * written once.
 */

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 200;

export const buildPagination = ({ page = DEFAULT_PAGE, limit = DEFAULT_LIMIT } = {}) => {
  const safePage = Math.max(1, Number(page) || DEFAULT_PAGE);
  // Capped: an uncapped limit is a one-request denial of service and a bulk
  // data exfiltration path in the same parameter.
  const safeLimit = Math.min(MAX_LIMIT, Math.max(1, Number(limit) || DEFAULT_LIMIT));

  return { page: safePage, limit: safeLimit, skip: (safePage - 1) * safeLimit };
};

/**
 * Sort spec from `sortBy` + `sortOrder`, restricted to an allowlist.
 *
 * The allowlist is not cosmetic: an arbitrary sort field lets a caller order by
 * an unindexed column and turn a cheap query into a collection scan, and lets
 * them infer values they cannot read by observing the resulting order.
 */
export const buildSort = (
  { sortBy, sortOrder = 'asc' } = {},
  allowedFields = [],
  fallback = { createdAt: -1 },
) => {
  if (!sortBy || !allowedFields.includes(sortBy)) return fallback;
  return { [sortBy]: sortOrder === 'desc' ? -1 : 1 };
};

/** Escapes user input before it reaches a regular expression. */
export const escapeRegex = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Case-insensitive OR search across the given fields.
 *
 * Anchored with `^` so the query can still use an index on those fields; an
 * unanchored `.*term.*` cannot, and degrades to a full scan as the table grows.
 * The trade-off is that this matches prefixes rather than substrings, which is
 * what a person typing a name or code actually expects.
 */
export const buildSearch = (term, fields = []) => {
  const trimmed = String(term ?? '').trim();
  if (!trimmed || !fields.length) return null;

  const pattern = new RegExp(`^${escapeRegex(trimmed)}`, 'i');
  return { $or: fields.map((field) => ({ [field]: pattern })) };
};

/**
 * Applies only the filters present in `params`, mapped through a definition of
 * how each one translates. Anything not defined is ignored -- an unknown query
 * parameter must never reach the database as a filter.
 */
export const buildFilters = (params = {}, definitions = {}) => {
  const filter = {};

  for (const [key, toFragment] of Object.entries(definitions)) {
    const raw = params[key];
    if (raw === undefined || raw === null || raw === '') continue;

    // Each definition returns a filter fragment (or null to skip), so one
    // parameter can contribute several conditions -- a date range, for example.
    const fragment = toFragment(raw, params);
    if (fragment) Object.assign(filter, fragment);
  }

  return filter;
};

/**
 * Reads the calendar day a caller meant and rebuilds it in local time.
 *
 * A bare `2026-08-03` is parsed as UTC midnight, but day-keyed records are
 * stored at LOCAL midnight. Comparing the two directly shifts the whole range
 * by the server's UTC offset -- east of UTC the range starts after the first
 * day's records and silently returns nothing.
 *
 * The UTC calendar parts of a date-only input are the day that was intended,
 * in any timezone, so those are what get rebuilt locally.
 */
export const toLocalDay = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
};

/** Inclusive date range, tolerant of either bound being absent. */
export const dateRange = (from, to) => {
  const range = {};

  const start = from ? toLocalDay(from) : null;
  if (start) range.$gte = start;

  const endDay = to ? toLocalDay(to) : null;
  if (endDay) {
    // End of the given day, so "to = 2026-01-31" includes that whole date.
    endDay.setHours(23, 59, 59, 999);
    range.$lte = endDay;
  }

  return Object.keys(range).length ? range : null;
};

export default { buildPagination, buildSort, buildSearch, buildFilters, dateRange, escapeRegex };
