import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';
import { Link as RouterLink } from 'react-router-dom';

/**
 * A compact headline figure for the dashboard: label, value, a one-line
 * explanation and an icon on a soft tint of its colour. Clickable when `to` is
 * given. The shared StatCard is left as it is for the module screens.
 *
 * `loading` holds the card's size with a skeleton, so the row does not reflow
 * as its requests land; `value` of null reads as "—" (not known), never 0.
 */
const KpiCard = ({ label, value, caption = null, icon: Icon = null, color = 'primary', to = null, loading = false }) => {
  const body = (
    <Stack direction="row" spacing={1.5} sx={{ p: 1.75, alignItems: 'center', minWidth: 0 }}>
      {Icon && (
        <Box
          sx={(theme) => ({
            display: 'grid',
            placeItems: 'center',
            width: 40,
            height: 40,
            borderRadius: 1.5,
            flexShrink: 0,
            color: theme.palette[color]?.main ?? theme.palette.primary.main,
            bgcolor: alpha(theme.palette[color]?.main ?? theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.18 : 0.1),
          })}
        >
          <Icon fontSize="small" />
        </Box>
      )}

      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', fontWeight: 500 }}>
          {label}
        </Typography>
        {loading ? (
          <Skeleton variant="text" width={64} sx={{ fontSize: '1.6rem' }} />
        ) : (
          <Typography variant="h5" noWrap sx={{ fontWeight: 700, lineHeight: 1.25, fontVariantNumeric: 'tabular-nums' }}>
            {value ?? '—'}
          </Typography>
        )}
        {caption && (
          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }} title={typeof caption === 'string' ? caption : undefined}>
            {caption}
          </Typography>
        )}
      </Box>
    </Stack>
  );

  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      {to ? (
        <CardActionArea component={RouterLink} to={to} sx={{ height: '100%' }}>
          {body}
        </CardActionArea>
      ) : (
        body
      )}
    </Card>
  );
};

export default KpiCard;
