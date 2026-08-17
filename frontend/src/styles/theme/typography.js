export const FONT_FAMILY = [
  '"Inter"',
  '-apple-system',
  'BlinkMacSystemFont',
  '"Segoe UI"',
  'Roboto',
  '"Helvetica Neue"',
  'Arial',
  'sans-serif',
].join(', ');

/**
 * A deliberately tight scale. HRMS screens are dense tables and forms, so the
 * headings stay small and the body text carries the weight.
 */
const typography = {
  fontFamily: FONT_FAMILY,
  fontWeightLight: 300,
  fontWeightRegular: 400,
  fontWeightMedium: 500,
  fontWeightBold: 700,

  h1: { fontSize: '2rem', fontWeight: 700, lineHeight: 1.25 },
  h2: { fontSize: '1.625rem', fontWeight: 700, lineHeight: 1.3 },
  h3: { fontSize: '1.375rem', fontWeight: 600, lineHeight: 1.35 },
  h4: { fontSize: '1.125rem', fontWeight: 600, lineHeight: 1.4 },
  h5: { fontSize: '1rem', fontWeight: 600, lineHeight: 1.45 },
  h6: { fontSize: '0.9375rem', fontWeight: 600, lineHeight: 1.5 },

  subtitle1: { fontSize: '0.9375rem', fontWeight: 500 },
  subtitle2: { fontSize: '0.875rem', fontWeight: 500 },
  body1: { fontSize: '0.9375rem', lineHeight: 1.6 },
  body2: { fontSize: '0.875rem', lineHeight: 1.6 },
  caption: { fontSize: '0.75rem', lineHeight: 1.5 },
  overline: { fontSize: '0.6875rem', fontWeight: 600, letterSpacing: '0.08em' },
  button: { fontSize: '0.875rem', fontWeight: 600, textTransform: 'none' },
};

export default typography;
