import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';

import { compactCurrencyIn, getActiveCurrency } from '@utils/currency.js';

/**
 * The dashboard's charts, drawn as inline SVG.
 *
 * No charting library is added, because none is installed and none is needed
 * for four shapes. Everything here is a `<rect>` or an arc in a `viewBox`, so
 * the charts scale with their container rather than with a resize listener,
 * cost nothing to load, and inherit the theme's palette instead of carrying a
 * second one.
 *
 * Hovering a bar or a segment shows its exact figure through the SVG's own
 * `<title>`, which every browser renders and every screen reader announces --
 * a tooltip that cannot break because there is no JavaScript behind it.
 *
 * Colours are theme tokens (`primary.main`, `success.main`, …) resolved through
 * `sx`, so both themes and any future palette change carry through untouched.
 */

/**
 * The chart palette, as literal colours.
 *
 * Literal and not `primary.main`, because `sx` does not resolve palette tokens
 * for `fill` and `stroke` -- those two are passed through to CSS untouched, so
 * a token reached the browser as the invalid declaration `fill: primary.main`
 * and every bar and segment fell back to the SVG default, which is black. The
 * legends looked right beside them only because they are `bgcolor`, which `sx`
 * does map. Anything that ends up on `fill` or `stroke` must therefore be a
 * real colour by the time it gets there -- see `resolveColor`.
 *
 * Mid-tone and saturated, so the same value reads on the light paper and on
 * the dark one without a second palette to keep in step. Chrome that must
 * follow the theme -- grid lines, axis labels, the donut's centre -- still
 * comes from the theme, below.
 */
export const CHART_COLORS = {
  gross: '#2563EB',
  net: '#16A34A',
  nssf: '#0891B2',
  nhif: '#F59E0B',
  employer: '#4F46E5',
  overtime: '#EA580C',
  present: '#16A34A',
  halfDay: '#0891B2',
  absent: '#DC2626',
  leave: '#0284C7',
  weeklyOff: '#94A3B8',
  holiday: '#7C3AED',
  pending: '#D97706',
  rejected: '#DC2626',
  approved: '#16A34A',
  tax: '#DC2626',
  other: '#64748B',
};

/** The default series order, for charts with no semantic colour of their own. */
export const SERIES_COLORS = [
  CHART_COLORS.gross,
  CHART_COLORS.net,
  CHART_COLORS.nhif,
  CHART_COLORS.nssf,
  CHART_COLORS.holiday,
  CHART_COLORS.overtime,
  CHART_COLORS.employer,
  CHART_COLORS.leave,
];

/**
 * A colour an SVG attribute can actually use.
 *
 * Literals pass through; a theme path like `divider` or `text.secondary` is
 * looked up on the palette, so chrome stays theme-aware while data series stay
 * fixed. An unknown token returns as-is rather than throwing -- a wrong colour
 * is a better failure than a blank chart.
 */
export const resolveColor = (theme, value) => {
  if (!value) return undefined;
  if (typeof value !== 'string' || value.startsWith('#') || value.startsWith('rgb') || value.startsWith('hsl')) {
    return value;
  }

  const resolved = value.split('.').reduce((node, key) => (node ? node[key] : undefined), theme.palette);
  return typeof resolved === 'string' ? resolved : value;
};

/**
 * 1,200,000 -> "TSH 1.2M". Axis labels have no room for the full figure.
 *
 * Defaults to the chosen display currency, so an axis formatter passed as a
 * bare function reference stays correct.
 */
export const compactCurrency = (value, currency) => compactCurrencyIn(value, currency ?? getActiveCurrency());

/**
 * Layout goes through `sx` rather than through `alignItems`/`justifyContent`
 * props. MUI no longer accepts those as system props on Stack in this version
 * and forwards them to the DOM, where React warns about every one of them.
 */
const Legend = ({ items }) => (
  <Stack direction="row" spacing={2} useFlexGap sx={{ mb: 1.5, flexWrap: 'wrap' }}>
    {items.map((item) => (
      <Stack key={item.label} direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
        <Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: item.color, flexShrink: 0 }} />
        <Typography variant="caption" color="text.secondary">
          {item.label}
        </Typography>
      </Stack>
    ))}
  </Stack>
);

/**
 * Grouped vertical bars.
 *
 * `data` is `[{ label, values: [n, …] }]` and `series` names them. One series
 * gives a plain bar chart; two give the gross-versus-net comparison.
 */
export const BarChart = ({
  data = [],
  series = [{ label: '', key: 0 }],
  format = (value) => value,
  height = 240,
  showLegend = true,
  // One colour per CATEGORY rather than per series, for a single-series chart
  // whose bars are distinct things -- salary bands, not months of the same
  // measure. Ignored when more than one series is drawn, where colour has to
  // mean the series or the chart stops being readable.
  colorByCategory = null,
}) => {
  const theme = useTheme();

  if (!data.length) return null;

  const max = Math.max(...data.flatMap((row) => row.values), 0) || 1;
  // A little headroom so the tallest bar does not touch the top gridline.
  const ceiling = max * 1.08;

  const gap = 8;
  const groupWidth = 100 / data.length;
  const barWidth = Math.max((groupWidth - gap) / series.length, 1);

  // Resolved once, and used for both the bars and the legend -- so a legend
  // swatch can never disagree with the series it names.
  const legend = series.map((entry, index) => ({
    label: entry.label,
    color: resolveColor(theme, entry.color ?? SERIES_COLORS[index % SERIES_COLORS.length]),
  }));

  return (
    <Box>
      {showLegend && series.some((entry) => entry.label) && <Legend items={legend} />}

      <Box sx={{ display: 'flex', gap: 1 }}>
        {/* Value axis. Three labels is enough to read a bar against. */}
        <Stack sx={{ height, flexShrink: 0, py: 0.25, justifyContent: 'space-between' }}>
          {[ceiling, ceiling / 2, 0].map((value) => (
            <Typography key={value} variant="caption" color="text.secondary" sx={{ lineHeight: 1 }}>
              {format(value)}
            </Typography>
          ))}
        </Stack>

        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box
            component="svg"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            sx={{ width: '100%', height, display: 'block', overflow: 'visible' }}
          >
            {/* Grid lines follow the theme's divider, so they stay faint on
                either background. `stroke` is an attribute here for the same
                reason `fill` is below: `sx` would not resolve the token. */}
            {[0, 50, 100].map((y) => (
              <Box
                key={y}
                component="line"
                x1="0"
                x2="100"
                y1={y}
                y2={y}
                stroke={theme.palette.divider}
                sx={{ strokeWidth: 0.4, vectorEffect: 'non-scaling-stroke' }}
              />
            ))}

            {data.map((row, rowIndex) =>
              row.values.map((value, seriesIndex) => {
                const barHeight = (Math.max(0, value) / ceiling) * 100;
                const x = rowIndex * groupWidth + gap / 2 + seriesIndex * barWidth;

                return (
                  <Box
                    key={`${row.label}-${seriesIndex}`}
                    component="rect"
                    x={x}
                    y={100 - barHeight}
                    width={barWidth}
                    height={barHeight}
                    fill={
                      colorByCategory && series.length === 1
                        ? resolveColor(theme, colorByCategory[rowIndex % colorByCategory.length])
                        : (legend[seriesIndex]?.color ?? resolveColor(theme, SERIES_COLORS[0]))
                    }
                    sx={{
                      opacity: 0.9,
                      transition: 'opacity 120ms',
                      '&:hover': { opacity: 1 },
                    }}
                  >
                    <title>
                      {`${row.label}${series[seriesIndex]?.label ? ` · ${series[seriesIndex].label}` : ''}: ${format(value)}`}
                    </title>
                  </Box>
                );
              }),
            )}
          </Box>

          {/* Category axis, outside the SVG so the text is never stretched by
              the non-uniform viewBox scaling. */}
          <Box sx={{ display: 'flex', mt: 0.75 }}>
            {data.map((row) => (
              <Typography
                key={row.label}
                variant="caption"
                color="text.secondary"
                align="center"
                noWrap
                sx={{ flex: 1, minWidth: 0, fontSize: 10 }}
              >
                {row.label}
              </Typography>
            ))}
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

/**
 * Horizontal bars with the label and the figure on the row.
 *
 * The right shape when the categories are named things rather than a sequence
 * -- departments, salary bands -- because the names get room to be read.
 */
export const HorizontalBars = ({ data = [], format = (value) => value, max: maxProp = null }) => {
  const theme = useTheme();

  if (!data.length) return null;

  const max = maxProp ?? Math.max(...data.map((row) => row.value), 0) ?? 1;

  return (
    <Stack spacing={1.25}>
      {data.map((row, index) => (
        <Box key={row.label}>
          <Stack direction="row" spacing={1} sx={{ mb: 0.4, justifyContent: 'space-between' }}>
            <Typography variant="caption" noWrap sx={{ minWidth: 0 }} title={row.label}>
              {row.label}
            </Typography>
            <Typography variant="caption" fontWeight={600} sx={{ flexShrink: 0 }}>
              {format(row.value)}
              {row.caption ? (
                <Box component="span" sx={{ color: 'text.secondary', fontWeight: 400 }}>
                  {` · ${row.caption}`}
                </Box>
              ) : null}
            </Typography>
          </Stack>

          <Box sx={{ height: 8, borderRadius: 4, bgcolor: 'action.hover', overflow: 'hidden' }}>
            <Box
              sx={{
                height: '100%',
                width: `${max > 0 ? Math.max((row.value / max) * 100, row.value > 0 ? 2 : 0) : 0}%`,
                bgcolor: resolveColor(theme, row.color ?? SERIES_COLORS[index % SERIES_COLORS.length]),
                borderRadius: 4,
                transition: 'width 240ms ease',
              }}
              title={`${row.label}: ${format(row.value)}`}
            />
          </Box>
        </Box>
      ))}
    </Stack>
  );
};

/** Polar point on the donut, in the SVG's 100x100 box. */
const point = (angle, radius) => [
  50 + radius * Math.cos((angle - 90) * (Math.PI / 180)),
  50 + radius * Math.sin((angle - 90) * (Math.PI / 180)),
];

/**
 * A donut, with the total in the middle.
 *
 * Segments are arcs rather than a stroke-dasharray circle, so a segment can be
 * hovered individually and carry its own tooltip.
 */
export const DonutChart = ({ data = [], format = (value) => value, centerLabel = null, centerValue = null, size = 200 }) => {
  const theme = useTheme();
  const slices = data.filter((slice) => Number(slice.value) > 0);
  const total = slices.reduce((sum, slice) => sum + Number(slice.value), 0);

  if (!total) return null;

  let cursor = 0;

  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2.5} sx={{ alignItems: 'center' }}>
      <Box sx={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
        <Box component="svg" viewBox="0 0 100 100" sx={{ width: '100%', height: '100%', display: 'block' }}>
          {slices.map((slice, index) => {
            const share = Number(slice.value) / total;
            const start = cursor;
            const end = cursor + share * 360;
            cursor = end;

            const color = resolveColor(theme, slice.color ?? SERIES_COLORS[index % SERIES_COLORS.length]);

            // A single slice would collapse to a zero-length arc, so it is drawn
            // as a ring instead.
            if (share >= 0.999) {
              return (
                <Box
                  key={slice.label}
                  component="circle"
                  cx="50"
                  cy="50"
                  r="35"
                  fill="none"
                  stroke={color}
                  sx={{ strokeWidth: 18 }}
                >
                  <title>{`${slice.label}: ${format(slice.value)} (100%)`}</title>
                </Box>
              );
            }

            const [outerStartX, outerStartY] = point(start, 44);
            const [outerEndX, outerEndY] = point(end, 44);
            const [innerEndX, innerEndY] = point(end, 26);
            const [innerStartX, innerStartY] = point(start, 26);
            const largeArc = end - start > 180 ? 1 : 0;

            return (
              <Box
                key={slice.label}
                component="path"
                d={[
                  `M ${outerStartX} ${outerStartY}`,
                  `A 44 44 0 ${largeArc} 1 ${outerEndX} ${outerEndY}`,
                  `L ${innerEndX} ${innerEndY}`,
                  `A 26 26 0 ${largeArc} 0 ${innerStartX} ${innerStartY}`,
                  'Z',
                ].join(' ')}
                fill={color}
                sx={{
                  opacity: 0.92,
                  transition: 'opacity 120ms',
                  '&:hover': { opacity: 1 },
                }}
              >
                <title>{`${slice.label}: ${format(slice.value)} (${Math.round(share * 100)}%)`}</title>
              </Box>
            );
          })}
        </Box>

        {(centerValue !== null || centerLabel) && (
          <Stack
            sx={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              px: 2,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Typography variant="h6" noWrap sx={{ maxWidth: '100%' }}>
              {centerValue}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap>
              {centerLabel}
            </Typography>
          </Stack>
        )}
      </Box>

      <Stack spacing={0.75} sx={{ flex: 1, minWidth: 0, width: '100%' }}>
        {slices.map((slice, index) => (
          <Stack key={slice.label} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Box
              sx={{
                width: 10,
                height: 10,
                borderRadius: 0.5,
                flexShrink: 0,
                // The same resolution the segment uses, so the two match.
                bgcolor: resolveColor(theme, slice.color ?? SERIES_COLORS[index % SERIES_COLORS.length]),
              }}
            />
            <Typography variant="caption" sx={{ flex: 1, minWidth: 0 }} noWrap>
              {slice.label}
            </Typography>
            <Typography variant="caption" fontWeight={600}>
              {format(slice.value)}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ width: 36, textAlign: 'right' }}>
              {Math.round((Number(slice.value) / total) * 100)}%
            </Typography>
          </Stack>
        ))}
      </Stack>
    </Stack>
  );
};

export default { BarChart, HorizontalBars, DonutChart, CHART_COLORS, SERIES_COLORS, resolveColor, compactCurrency };
