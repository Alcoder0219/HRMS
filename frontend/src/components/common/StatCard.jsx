import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { Link as RouterLink } from 'react-router-dom';

/**
 * A single figure with its label, used across the dashboard and the module
 * summaries.
 *
 * `loading` renders a skeleton at the value's size rather than collapsing the
 * card, so a dashboard does not reflow as each of its independent requests
 * lands.
 */
const StatCard = ({ label, value, caption = null, icon: Icon = null, color = 'primary', to = null, loading = false }) => {
  const body = (
    <CardContent>
      <Stack direction="row" spacing={2} alignItems="flex-start" justifyContent="space-between">
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary" noWrap>
            {label}
          </Typography>

          {loading ? (
            <Skeleton variant="text" width={72} sx={{ fontSize: '2rem', mt: 0.5 }} />
          ) : (
            <Typography variant="h4" sx={{ mt: 0.5 }} noWrap>
              {value ?? '—'}
            </Typography>
          )}

          {caption && (
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
              {caption}
            </Typography>
          )}
        </Box>

        {Icon && (
          <Box
            sx={{
              display: 'grid',
              placeItems: 'center',
              width: 40,
              height: 40,
              borderRadius: 1.5,
              flexShrink: 0,
              bgcolor: `${color}.main`,
              color: `${color}.contrastText`,
            }}
          >
            <Icon fontSize="small" />
          </Box>
        )}
      </Stack>
    </CardContent>
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

export default StatCard;
