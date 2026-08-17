/**
 * Colour tokens for both schemes. Defined once here so components never hold a
 * raw hex value -- rebranding a tenant means editing this file only.
 */
export const lightPalette = {
  mode: 'light',
  primary: { main: '#1565c0', light: '#4a8bda', dark: '#0d3c8f', contrastText: '#ffffff' },
  secondary: { main: '#5e35b1', light: '#8961e3', dark: '#320b86', contrastText: '#ffffff' },
  success: { main: '#2e7d32' },
  warning: { main: '#ed6c02' },
  error: { main: '#d32f2f' },
  info: { main: '#0288d1' },
  background: { default: '#f4f6f8', paper: '#ffffff' },
  text: { primary: '#1c252e', secondary: '#5a6a78' },
  divider: 'rgba(28, 37, 46, 0.12)',
};

export const darkPalette = {
  mode: 'dark',
  primary: { main: '#64b5f6', light: '#9be7ff', dark: '#2286c3', contrastText: '#0b1015' },
  secondary: { main: '#b39ddb', light: '#e6ceff', dark: '#836fa9', contrastText: '#0b1015' },
  success: { main: '#66bb6a' },
  warning: { main: '#ffa726' },
  error: { main: '#f44336' },
  info: { main: '#29b6f6' },
  background: { default: '#0f1418', paper: '#161d24' },
  text: { primary: '#e7edf3', secondary: '#9aa8b5' },
  divider: 'rgba(231, 237, 243, 0.12)',
};

export default { lightPalette, darkPalette };
