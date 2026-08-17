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
 * An amount in the currency the user has chosen in the topbar, including its
 * digit grouping -- 1,80,00,000 under the rupee, 18,000,000 under the dollar.
 *
 * The currency is read at call time rather than captured, because every call
 * site here is a grid formatter or a render expression that runs afresh. Pass
 * `currency` only to pin an amount to one currency regardless of the setting.
 * See `utils/currency.js` for why this is a relabel and not a conversion.
 */
export const formatCurrency = (value, currency) =>
  formatCurrencyIn(value, currency ?? getActiveCurrency());

export const formatNumber = (value) =>
  value === null || value === undefined ? '—' : new Intl.NumberFormat('en-IN').format(Number(value));

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
