import { createTheme } from '@mui/material/styles';
import { lightPalette, darkPalette } from './palette.js';
import typography from './typography.js';
import componentOverrides from '../overrides/index.js';

export const THEME_MODES = ['light', 'dark'];

/**
 * Built in two passes: the base theme is created first so that component
 * overrides can read real palette and spacing values instead of hard-coding
 * them, then merged back in.
 */
export const buildTheme = (mode = 'light') => {
  const base = createTheme({
    palette: mode === 'dark' ? darkPalette : lightPalette,
    typography,
    shape: { borderRadius: 8 },
    spacing: 8,
    breakpoints: {
      values: { xs: 0, sm: 600, md: 900, lg: 1200, xl: 1536 },
    },
  });

  return createTheme(base, { components: componentOverrides(base) });
};

export default buildTheme;
