/**
 * The currencies amounts can be displayed in, and the formatting each takes.
 *
 * This is a DISPLAY setting. Switching currency relabels every amount on the
 * screen; it does not convert one. Multiplying a stored payroll figure by a
 * rate chosen in a topbar dropdown would invent a number nobody approved -- a
 * conversion rate belongs to the payroll run that produced the amount, next to
 * the period it applied to, not to a per-user preference.
 *
 * `formatCurrency` and the compact variant are plain functions, called from
 * grid column definitions, exporters and print views as well as from
 * components, so they cannot read a hook. They take the active currency from
 * the register at the foot of this file, which `uiSlice` keeps in step with
 * the store. Components that need the code or symbol itself use `useCurrency`.
 */

/**
 * `code` is the ISO 4217 code; `symbol` is what the user actually sees. The
 * two differ for the shilling deliberately -- ISO says TZS, but the currency
 * is written TSH locally, and the screen should read the way the user writes.
 *
 * `spaced` separates an alphabetic symbol from its digits (TSH 1,200); glyph
 * symbols sit tight against them ($1,200).
 */
export const CURRENCIES = {
  TZS: {
    code: 'TZS',
    label: 'Tanzanian Shilling',
    symbol: 'TSH',
    // What the topbar button shows: enough to identify the currency at a
    // glance without spelling out its name.
    short: 'TSH',
    spaced: true,
    /**
     * `en-TZ` is missing from some browsers' ICU data, and an unrecognised
     * locale silently falls back to the browser's own -- which groups digits
     * differently depending on where the reader happens to be. `en-GB` is the
     * tested fallback and groups in thousands, as Tanzania does.
     */
    locale: ['en-TZ', 'en-GB'],
    scale: 'western',
  },
  /**
   * Kept for expatriate packages, which are commonly quoted in dollars. Like
   * the shilling, this is a RELABEL and not a conversion -- see the note at the
   * top of this file.
   */
  USD: {
    code: 'USD',
    label: 'US Dollar',
    symbol: '$',
    short: 'USD $',
    locale: 'en-US',
    scale: 'western',
  },
};

export const DEFAULT_CURRENCY_CODE = 'TZS';

export const CURRENCY_OPTIONS = Object.values(CURRENCIES);

/**
 * Compact suffixes for axis ticks and cramped labels.
 *
 * One scale, because both currencies group in thousands. The lakh-and-crore
 * scale that sat beside this went with the rupee: those units mean nothing
 * against a shilling, and a chart axis reading "12L" would be unreadable to
 * every user of this product.
 */
const SCALES = {
  western: [
    { threshold: 1_000_000_000, divisor: 1_000_000_000, suffix: 'B', digits: 1 },
    { threshold: 1_000_000, divisor: 1_000_000, suffix: 'M', digits: 1 },
    { threshold: 1_000, divisor: 1_000, suffix: 'K', digits: 0 },
  ],
};

/**
 * `hasOwn` rather than a bare lookup: the code arrives from localStorage, and
 * `CURRENCIES.constructor` would otherwise resolve to something truthy that is
 * not a currency.
 */
export const resolveCurrency = (code) =>
  typeof code === 'string' && Object.hasOwn(CURRENCIES, code)
    ? CURRENCIES[code]
    : CURRENCIES[DEFAULT_CURRENCY_CODE];

export const normalizeCurrencyCode = (code) => resolveCurrency(code).code;

/**
 * One formatter per locale, kept. Building an `Intl.NumberFormat` is the
 * expensive half of formatting a number, and a salary register asks for a few
 * thousand of them per render.
 *
 * A locale may be an array of fallbacks, so the cache key is its joined form
 * rather than the value itself -- two arrays with the same contents are
 * different objects and would each build their own formatter.
 */
const groupers = new Map();

const grouper = (locale) => {
  const key = Array.isArray(locale) ? locale.join(',') : locale;

  if (!groupers.has(key)) {
    groupers.set(key, new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }));
  }
  return groupers.get(key);
};

/**
 * The symbol is applied by hand rather than through `style: 'currency'`, which
 * would render the shilling as "TSh" or "TZS" depending on the browser's
 * locale data. Pay figures should not change shape between two users' laptops.
 */
const withSymbol = (currency, digits, negative) =>
  `${negative ? '-' : ''}${currency.symbol}${currency.spaced ? ' ' : ''}${digits}`;

/** An amount in an explicit currency. Blank and non-numeric read as a dash. */
export const formatCurrencyIn = (value, code) => {
  if (value === null || value === undefined || value === '') return '—';

  const number = Number(value);
  if (!Number.isFinite(number)) return '—';

  const currency = resolveCurrency(code);
  return withSymbol(currency, grouper(currency.locale).format(Math.abs(number)), number < 0);
};

/**
 * The abbreviated digits alone -- "1.2L", "120K" -- with no symbol, for axis
 * ticks and band labels that state the currency once in a heading instead of
 * on every tick. A whole multiple keeps its round form: 1L, not 1.0L.
 */
export const compactAmountIn = (value, code) => {
  const amount = Math.abs(Number(value) || 0);
  const step = SCALES[resolveCurrency(code).scale].find((entry) => amount >= entry.threshold);

  if (!step) return String(Math.round(amount));
  return `${(amount / step.divisor).toFixed(step.digits).replace(/\.0$/, '')}${step.suffix}`;
};

/** TSH 1,200,000 -> "TSH 1.2M". For labels with no room. */
export const compactCurrencyIn = (value, code) => {
  const number = Number(value) || 0;
  return withSymbol(resolveCurrency(code), compactAmountIn(number, code), number < 0);
};

/* ------------------------------------------------- the active currency -- */

let activeCurrencyCode = DEFAULT_CURRENCY_CODE;

export const setActiveCurrency = (code) => {
  activeCurrencyCode = normalizeCurrencyCode(code);
  return activeCurrencyCode;
};

export const getActiveCurrency = () => activeCurrencyCode;

export const getActiveCurrencyMeta = () => resolveCurrency(activeCurrencyCode);
