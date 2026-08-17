/**
 * Per-component MUI overrides. Confining them here is what keeps the design
 * system coherent -- a button restyled inline in one page is a bug, not a
 * variant.
 */
const componentOverrides = (theme) => ({
  MuiCssBaseline: {
    styleOverrides: {
      '*': { boxSizing: 'border-box' },
      html: { WebkitFontSmoothing: 'antialiased', height: '100%' },
      body: { height: '100%' },
      '#root': { height: '100%' },
    },
  },

  MuiButton: {
    defaultProps: { disableElevation: true },
    styleOverrides: {
      root: { borderRadius: theme.shape.borderRadius, paddingInline: theme.spacing(2) },
    },
  },

  MuiPaper: {
    defaultProps: { elevation: 0 },
    styleOverrides: {
      root: { backgroundImage: 'none' },
      outlined: { borderColor: theme.palette.divider },
    },
  },

  MuiCard: {
    defaultProps: { variant: 'outlined' },
    styleOverrides: { root: { borderRadius: theme.shape.borderRadius * 1.5 } },
  },

  MuiTextField: {
    defaultProps: { size: 'small', fullWidth: true, variant: 'outlined' },
  },

  MuiSelect: { defaultProps: { size: 'small' } },

  MuiTableCell: {
    styleOverrides: {
      root: { borderBottomColor: theme.palette.divider },
      head: {
        fontWeight: 600,
        backgroundColor: theme.palette.background.default,
        whiteSpace: 'nowrap',
      },
    },
  },

  MuiChip: {
    styleOverrides: { root: { borderRadius: theme.shape.borderRadius, fontWeight: 500 } },
  },

  MuiTooltip: {
    defaultProps: { arrow: true },
  },
});

export default componentOverrides;
