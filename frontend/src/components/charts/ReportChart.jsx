import { useId, useMemo } from 'react';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Skeleton from '@mui/material/Skeleton';
import { useTheme } from '@mui/material/styles';

import { formatCurrency, formatNumber, humanize } from '@utils/format.js';

/**
 * Charts drawn as plain SVG.
 *
 * Deliberately not a charting library. Three shapes are needed -- bar, donut,
 * line -- and every candidate library brings a canvas renderer driven by a
 * resize observer, which measures zero width inside a print stylesheet. Since
 * "Export PDF" on these screens is a print, a chart that vanishes from the
 * printout would defeat the feature it was added for. SVG at a fixed viewBox
 * scales to whatever the paper gives it.
 *
 * The series contract matches the server envelope exactly:
 *   { key, title, type, valueFormat, caption, series: [{ label, value }] }
 */

const VIEW = { width: 320, height: 180 };

const formatValue = (value, format) => {
  if (format === 'currency') return formatCurrency(value);
  if (format === 'percent') return `${formatNumber(value)}%`;
  if (format === 'hours') return `${formatNumber(value)} h`;
  if (format === 'days') return `${formatNumber(value)} d`;
  if (format === 'years') return `${formatNumber(value)} y`;
  return formatNumber(value);
};

/**
 * A stable colour per slice.
 *
 * Indexed off the palette rather than randomised so the same category keeps
 * its colour between two renders of the same report -- a legend that reshuffles
 * makes month-on-month comparison impossible.
 */
const usePalette = () => {
  const theme = useTheme();

  return useMemo(
    () => [
      theme.palette.primary.main,
      theme.palette.success.main,
      theme.palette.warning.main,
      theme.palette.info.main,
      theme.palette.error.main,
      theme.palette.secondary.main,
      theme.palette.primary.light,
      theme.palette.success.dark,
      theme.palette.warning.dark,
      theme.palette.info.dark,
    ],
    [theme],
  );
};

/* -------------------------------------------------------------------------- */
/*                                     Bar                                    */
/* -------------------------------------------------------------------------- */

/**
 * Horizontal bars, because category labels are words.
 *
 * A vertical bar chart with eight department names underneath either rotates
 * the labels 45 degrees or truncates them; laying the bars on their side lets
 * the label sit on a readable baseline at any width.
 */
const BarChart = ({ series, valueFormat }) => {
  const palette = usePalette();
  const max = Math.max(...series.map((entry) => entry.value), 1);

  return (
    <Stack spacing={1.25} sx={{ mt: 1 }}>
      {series.map((entry, index) => (
        <Box key={entry.label}>
          <Stack direction="row" justifyContent="space-between" spacing={1} sx={{ mb: 0.25 }}>
            <Typography variant="caption" color="text.secondary" noWrap sx={{ minWidth: 0 }}>
              {humanize(entry.label)}
            </Typography>
            <Typography variant="caption" fontWeight={600} sx={{ whiteSpace: 'nowrap' }}>
              {formatValue(entry.value, valueFormat)}
            </Typography>
          </Stack>

          <Box
            sx={{
              height: 8,
              borderRadius: 4,
              bgcolor: 'action.hover',
              overflow: 'hidden',
            }}
          >
            <Box
              sx={{
                height: '100%',
                borderRadius: 4,
                width: `${Math.max((entry.value / max) * 100, entry.value > 0 ? 2 : 0)}%`,
                bgcolor: entry.color ?? palette[index % palette.length],
                transition: 'width 240ms ease',
              }}
            />
          </Box>
        </Box>
      ))}
    </Stack>
  );
};

/* -------------------------------------------------------------------------- */
/*                                    Donut                                   */
/* -------------------------------------------------------------------------- */

const polarToCartesian = (cx, cy, radius, angle) => {
  const radians = ((angle - 90) * Math.PI) / 180;
  return { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) };
};

const arcPath = (cx, cy, outer, inner, startAngle, endAngle) => {
  // A full circle cannot be expressed as a single arc: start and end coincide
  // and the path collapses. Two half arcs draw it correctly.
  if (endAngle - startAngle >= 359.999) {
    return [
      `M ${cx - outer} ${cy}`,
      `A ${outer} ${outer} 0 1 1 ${cx + outer} ${cy}`,
      `A ${outer} ${outer} 0 1 1 ${cx - outer} ${cy}`,
      `M ${cx - inner} ${cy}`,
      `A ${inner} ${inner} 0 1 0 ${cx + inner} ${cy}`,
      `A ${inner} ${inner} 0 1 0 ${cx - inner} ${cy}`,
      'Z',
    ].join(' ');
  }

  const outerStart = polarToCartesian(cx, cy, outer, endAngle);
  const outerEnd = polarToCartesian(cx, cy, outer, startAngle);
  const innerStart = polarToCartesian(cx, cy, inner, startAngle);
  const innerEnd = polarToCartesian(cx, cy, inner, endAngle);
  const largeArc = endAngle - startAngle <= 180 ? 0 : 1;

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outer} ${outer} 0 ${largeArc} 0 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerStart.x} ${innerStart.y}`,
    `A ${inner} ${inner} 0 ${largeArc} 1 ${innerEnd.x} ${innerEnd.y}`,
    'Z',
  ].join(' ');
};

const DonutChart = ({ series, valueFormat }) => {
  const palette = usePalette();
  const total = series.reduce((sum, entry) => sum + entry.value, 0);

  const slices = useMemo(() => {
    let cursor = 0;

    return series.map((entry, index) => {
      const sweep = total ? (entry.value / total) * 360 : 0;
      const slice = {
        ...entry,
        start: cursor,
        end: cursor + sweep,
        color: entry.color ?? palette[index % palette.length],
        share: total ? Math.round((entry.value / total) * 100) : 0,
      };
      cursor += sweep;
      return slice;
    });
  }, [series, total, palette]);

  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center" sx={{ mt: 1 }}>
      <Box sx={{ width: 140, flexShrink: 0 }}>
        <svg viewBox="0 0 140 140" width="100%" role="presentation">
          {slices.map((slice) => (
            <path key={slice.label} d={arcPath(70, 70, 62, 40, slice.start, slice.end)} fill={slice.color} />
          ))}

          <text x="70" y="66" textAnchor="middle" fontSize="18" fontWeight="600" fill="currentColor">
            {formatNumber(total)}
          </text>
          <text x="70" y="84" textAnchor="middle" fontSize="10" fill="currentColor" opacity="0.6">
            total
          </text>
        </svg>
      </Box>

      <Stack spacing={0.75} sx={{ flex: 1, minWidth: 0, width: '100%' }}>
        {slices.map((slice) => (
          <Stack key={slice.label} direction="row" spacing={1} alignItems="center">
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: slice.color, flexShrink: 0 }} />
            <Typography variant="caption" color="text.secondary" noWrap sx={{ flex: 1, minWidth: 0 }}>
              {humanize(slice.label)}
            </Typography>
            <Typography variant="caption" fontWeight={600} sx={{ whiteSpace: 'nowrap' }}>
              {formatValue(slice.value, valueFormat)}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ width: 34, textAlign: 'right' }}>
              {slice.share}%
            </Typography>
          </Stack>
        ))}
      </Stack>
    </Stack>
  );
};

/* -------------------------------------------------------------------------- */
/*                                    Line                                    */
/* -------------------------------------------------------------------------- */

const LineChart = ({ series, valueFormat }) => {
  const theme = useTheme();
  const gradientId = useId().replace(/:/g, '');

  const max = Math.max(...series.map((entry) => entry.value), 1);
  const step = series.length > 1 ? VIEW.width / (series.length - 1) : 0;
  const plotHeight = VIEW.height - 28;

  const points = series.map((entry, index) => ({
    ...entry,
    x: series.length > 1 ? index * step : VIEW.width / 2,
    y: plotHeight - (entry.value / max) * (plotHeight - 12),
  }));

  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
  const area = `${path} L ${points[points.length - 1]?.x ?? 0} ${plotHeight} L ${points[0]?.x ?? 0} ${plotHeight} Z`;

  // Every label on a twelve-point series is legible; on a thirty-one day
  // series it is not, so only every fifth tick is drawn.
  const labelEvery = series.length > 14 ? 5 : 1;

  return (
    <Box sx={{ mt: 1, overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${VIEW.width} ${VIEW.height}`} width="100%" preserveAspectRatio="none" role="presentation">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={theme.palette.primary.main} stopOpacity="0.32" />
            <stop offset="100%" stopColor={theme.palette.primary.main} stopOpacity="0" />
          </linearGradient>
        </defs>

        {[0.25, 0.5, 0.75, 1].map((fraction) => (
          <line
            key={fraction}
            x1="0"
            x2={VIEW.width}
            y1={plotHeight * fraction}
            y2={plotHeight * fraction}
            stroke={theme.palette.divider}
            strokeWidth="0.5"
          />
        ))}

        <path d={area} fill={`url(#${gradientId})`} />
        <path d={path} fill="none" stroke={theme.palette.primary.main} strokeWidth="2" vectorEffect="non-scaling-stroke" />

        {points.map((point) => (
          <circle key={point.label} cx={point.x} cy={point.y} r="2.5" fill={theme.palette.primary.main} />
        ))}
      </svg>

      <Stack direction="row" justifyContent="space-between" sx={{ mt: 0.5 }}>
        {points.map((point, index) => (
          <Typography
            key={point.label}
            variant="caption"
            color="text.secondary"
            sx={{ fontSize: 10, flex: 1, textAlign: 'center', minWidth: 0 }}
          >
            {index % labelEvery === 0 ? point.label : ''}
          </Typography>
        ))}
      </Stack>

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'right' }}>
        peak {formatValue(max, valueFormat)}
      </Typography>
    </Box>
  );
};

/* -------------------------------------------------------------------------- */

const RENDERERS = { bar: BarChart, donut: DonutChart, line: LineChart };

/**
 * Renders one chart from the report envelope, inside its own card.
 *
 * An unknown chart type renders nothing rather than throwing: the server owns
 * the chart list, and a newer server offering a type this build does not know
 * should degrade to a missing panel, not a blank page.
 */
const ReportChart = ({ chart, loading = false }) => {
  if (loading) {
    return (
      <Card variant="outlined" sx={{ height: '100%' }}>
        <CardContent>
          <Skeleton variant="text" width="55%" />
          <Skeleton variant="rectangular" height={150} sx={{ mt: 2, borderRadius: 1 }} />
        </CardContent>
      </Card>
    );
  }

  const Renderer = RENDERERS[chart?.type];
  if (!Renderer || !chart?.series?.length) return null;

  return (
    <Card variant="outlined" sx={{ height: '100%' }} data-print="chart">
      <CardContent>
        <Typography variant="subtitle2">{chart.title}</Typography>
        {chart.caption && (
          <Typography variant="caption" color="text.secondary">
            {chart.caption}
          </Typography>
        )}

        <Renderer series={chart.series} valueFormat={chart.valueFormat} />
      </CardContent>
    </Card>
  );
};

export default ReportChart;
