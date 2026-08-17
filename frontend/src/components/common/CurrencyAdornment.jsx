import InputAdornment from '@mui/material/InputAdornment';
import useCurrency from '@hooks/useCurrency.js';

/**
 * The chosen currency's symbol, as the leading adornment on an amount field.
 *
 * A component rather than an inline `<InputAdornment>{symbol}</InputAdornment>`
 * so that the amount fields scattered across payroll, recruitment and the
 * employee forms read the setting themselves. Their parents are often nested
 * dialog bodies and render helpers that have no business subscribing to the
 * store just to label a text box.
 *
 * The symbol labels what is being typed; it does not convert it. The number
 * the user enters is stored exactly as entered.
 */
const CurrencyAdornment = (props) => {
  const { symbol } = useCurrency();

  return (
    <InputAdornment position="start" {...props}>
      {symbol}
    </InputAdornment>
  );
};

export default CurrencyAdornment;
