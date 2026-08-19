import { format, formatDistanceToNow, isValid, parseISO } from 'date-fns';
import { formatCurrencyIn, getActiveCurrency } from './currency.js';

const toDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : parseISO(String(value));
  return isValid(date) ? date : null;
};

export const formatDate = (value, pattern = 'dd MMM yyyy') => {
  const date = toDate(value);
  return date ? format(date, pattern) : '—';
};

export const formatDateTime = (value) => formatDate(value, 'dd MMM yyyy, HH:mm');

/** Input[type=date] needs exactly this shape; anything else silently blanks. */
export const toDateInput = (value) => {
  const date = toDate(value);
  return date ? format(date, 'yyyy-MM-dd') : '';
};

export const formatRelative = (value) => {
  const date = toDate(value);
  return date ? `${formatDistanceToNow(date)} ago` : '—';
};

/**
 * An amount in the currency the user has chosen in the topbar, symbol and
 * digit grouping included -- TSH 18,000,000.
 *
 * The currency is read at call time rather than captured, because every call
 * site here is a grid formatter or a render expression that runs afresh. Pass
 * `currency` only to pin an amount to one currency regardless of the setting.
 * See `utils/currency.js` for why this is a relabel and not a conversion.
 */
export const formatCurrency = (value, currency) =>
  formatCurrencyIn(value, currency ?? getActiveCurrency());

/**
 * A plain grouped number, with no currency symbol.
 *
 * `en-TZ` first with `en-GB` behind it, for the same reason as in
 * `utils/currency.js`: not every browser ships Tanzanian locale data, and an
 * unrecognised locale falls back to the reader's own rather than failing.
 */
const NUMBER_LOCALES = ['en-TZ', 'en-GB'];

export const formatNumber = (value) =>
  value === null || value === undefined
    ? '—'
    : new Intl.NumberFormat(NUMBER_LOCALES).format(Number(value));

/** Turns SCREAMING_SNAKE enums into readable labels. */
export const humanize = (value) =>
  !value
    ? '—'
    : String(value)
        .toLowerCase()
        .split('_')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

export const initials = (...parts) =>
  parts
    .filter(Boolean)
    .map((part) => String(part).charAt(0).toUpperCase())
    .slice(0, 2)
    .join('');

export const emptyDash = (value) => (value === null || value === undefined || value === '' ? '—' : value);
