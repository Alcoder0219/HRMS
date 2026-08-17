import { useMemo } from 'react';
import { ThemeProvider as MuiThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { useAppSelector } from '@hooks/useRedux.js';
import { selectThemeMode } from '@redux/slices/uiSlice.js';
import { buildTheme } from '@styles/theme/index.js';

/**
 * Bridges the persisted theme mode in Redux to MUI. Memoised on the mode alone
 * so a theme object is not rebuilt -- and the entire tree re-rendered -- on
 * every unrelated store update.
 */
const ThemeProvider = ({ children }) => {
  const mode = useAppSelector(selectThemeMode);
  const theme = useMemo(() => buildTheme(mode), [mode]);

  return (
    <MuiThemeProvider theme={theme}>
      <CssBaseline />
      {children}
    </MuiThemeProvider>
  );
};

export default ThemeProvider;
