import { useMemo } from 'react';
import { useAppSelector } from './useRedux.js';
import { selectCurrency } from '@redux/slices/uiSlice.js';
import { compactCurrencyIn, formatCurrencyIn, resolveCurrency } from '@utils/currency.js';

/**
 * The chosen display currency, with formatters already bound to it.
 *
 * Most amounts are written by `formatCurrency` from `@utils/format.js`, which
 * reads the same setting without a hook and so works inside grid column
 * definitions and exporters too. Reach for this hook when a component needs
 * the currency itself rather than a formatted amount -- an input adornment
 * showing the symbol, a band label built from a boundary, a chart axis -- or
 * when it should re-render the moment the currency changes.
 *
 * Amounts are relabelled, never converted; see `@utils/currency.js`.
 */
const useCurrency = () => {
  const code = useAppSelector(selectCurrency);

  return useMemo(() => {
    const currency = resolveCurrency(code);

    return {
      /** ISO 4217 code, e.g. `TZS`. */
      code: currency.code,
      /** What the user sees against an amount, e.g. `TSH`. */
      symbol: currency.symbol,
      /** Full name, for tooltips and menu entries. */
      label: currency.label,
      /** The topbar's compact identifier, e.g. `USD $`. */
      short: currency.short,
      format: (value) => formatCurrencyIn(value, currency.code),
      compact: (value) => compactCurrencyIn(value, currency.code),
    };
  }, [code]);
};

export default useCurrency;
