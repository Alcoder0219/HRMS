import { useId, useState } from 'react';
import Button from '@mui/material/Button';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ExpandMoreIcon from '@mui/icons-material/ExpandMoreOutlined';

import { useAppDispatch } from '@hooks/useRedux.js';
import useCurrency from '@hooks/useCurrency.js';
import { setCurrency } from '@redux/slices/uiSlice.js';
import { CURRENCY_OPTIONS } from '@utils/currency.js';

/**
 * The topbar currency picker.
 *
 * Sized to the icon buttons beside it -- 40px tall, the theme's own corner
 * radius -- so the run of controls in the toolbar keeps one baseline and one
 * outline, and reads with the Month/Year selects on the dashboard below it.
 *
 * A `Menu` rather than a `Select`: a Select would have to carry a label and a
 * notched outline to look right, and this control shows the current currency
 * as its own face. The menu brings the keyboard handling with it -- arrow keys
 * move through the options, Enter chooses, Escape and a click outside close,
 * and focus returns to the button either way. `role="listbox"` over the list
 * corrects the default `menu` role, since these options are a value being
 * chosen rather than commands being run.
 */
const CurrencySelect = () => {
  const dispatch = useAppDispatch();
  const { code, short, label } = useCurrency();

  const buttonId = useId();
  const menuId = useId();
  const [anchorEl, setAnchorEl] = useState(null);
  const open = Boolean(anchorEl);

  const choose = (next) => {
    setAnchorEl(null);
    if (next !== code) dispatch(setCurrency(next));
  };

  return (
    <>
      <Tooltip title={`Display currency: ${label}`}>
        <Button
          id={buttonId}
          onClick={(event) => setAnchorEl(event.currentTarget)}
          // `aria-controls` only while the list exists, otherwise it points at
          // nothing; `aria-haspopup` says what pressing this opens.
          aria-controls={open ? menuId : undefined}
          aria-haspopup="listbox"
          aria-expanded={open || undefined}
          aria-label={`Display currency, ${label} selected`}
          color="inherit"
          endIcon={<ExpandMoreIcon />}
          sx={{
            height: 40,
            minWidth: 0,
            px: 1.25,
            borderRadius: 1,
            border: 1,
            borderColor: 'divider',
            fontSize: '0.875rem',
            fontWeight: 500,
            textTransform: 'none',
            color: 'text.primary',
            // The caret is furniture, not content -- muted and tightened in so
            // the currency itself is what the eye lands on.
            '& .MuiButton-endIcon': { ml: 0.25, color: 'text.secondary' },
            '&:hover': { borderColor: 'text.disabled', bgcolor: 'action.hover' },
          }}
        >
          {short}
        </Button>
      </Tooltip>

      <Menu
        id={menuId}
        anchorEl={anchorEl}
        open={open}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ list: { role: 'listbox', 'aria-labelledby': buttonId, dense: true } }}
      >
        {CURRENCY_OPTIONS.map((option) => (
          <MenuItem
            key={option.code}
            role="option"
            aria-selected={option.code === code}
            selected={option.code === code}
            onClick={() => choose(option.code)}
            sx={{ minWidth: 200 }}
          >
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', width: '100%' }}>
              {/* Fixed-width symbol column, so the names line up under each
                  other however wide the symbol is. */}
              <Typography variant="body2" fontWeight={600} sx={{ width: 40, flexShrink: 0 }}>
                {option.symbol}
              </Typography>
              <Typography variant="body2" noWrap sx={{ flex: 1 }}>
                {option.label}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {option.code}
              </Typography>
            </Stack>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
};

export default CurrencySelect;
