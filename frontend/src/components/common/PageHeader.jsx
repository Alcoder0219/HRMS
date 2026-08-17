import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Breadcrumbs from '@mui/material/Breadcrumbs';
import Link from '@mui/material/Link';
import { Link as RouterLink } from 'react-router-dom';

/**
 * Consistent page masthead: breadcrumb trail, title, optional subtitle, and a
 * slot for actions. Every screen uses it so headings never drift in size or
 * spacing between modules.
 */
const PageHeader = ({ title, subtitle, breadcrumbs = [], actions = null }) => (
  <Box sx={{ mb: 3 }}>
    {breadcrumbs.length > 0 && (
      <Breadcrumbs sx={{ mb: 1 }} aria-label="breadcrumb">
        {breadcrumbs.map((crumb, index) =>
          crumb.to && index < breadcrumbs.length - 1 ? (
            <Link
              key={crumb.label}
              component={RouterLink}
              to={crumb.to}
              underline="hover"
              color="inherit"
              variant="body2"
            >
              {crumb.label}
            </Link>
          ) : (
            <Typography key={crumb.label} variant="body2" color="text.primary">
              {crumb.label}
            </Typography>
          ),
        )}
      </Breadcrumbs>
    )}

    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={2}
      alignItems={{ xs: 'flex-start', sm: 'center' }}
      justifyContent="space-between"
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="h3" noWrap sx={{ maxWidth: '100%' }}>
          {title}
        </Typography>
        {subtitle && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {subtitle}
          </Typography>
        )}
      </Box>

      {actions && (
        <Stack direction="row" spacing={1} flexShrink={0}>
          {actions}
        </Stack>
      )}
    </Stack>
  </Box>
);

export default PageHeader;
