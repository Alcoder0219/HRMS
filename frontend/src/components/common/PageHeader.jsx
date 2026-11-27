import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Breadcrumbs from '@mui/material/Breadcrumbs';
import Link from '@mui/material/Link';
import { Link as RouterLink } from 'react-router-dom';

/**
 * Consistent page masthead: breadcrumb trail and a slot for actions. Every
 * screen uses it so the top of a page never drifts in size or spacing between
 * modules.
 *
 * The page title and its description are no longer displayed. `title` and
 * `subtitle` are still accepted so no page has to change; the title is kept as
 * a heading for screen readers only (invisible on screen), so assistive
 * technology can still announce which page this is. Breadcrumbs and actions
 * share one row, so nothing is left where the heading used to be.
 */

// Present for assistive technology, taking no space and never shown.
const SCREEN_READER_ONLY = {
  position: 'absolute',
  width: 1,
  height: 1,
  p: 0,
  m: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

// eslint-disable-next-line no-unused-vars
const PageHeader = ({ title, subtitle, breadcrumbs = [], actions = null }) => {
  const heading = title ? (
    <Typography component="h1" sx={SCREEN_READER_ONLY}>
      {title}
    </Typography>
  ) : null;

  // Nothing to show: no container, so no gap above the page's content.
  if (!breadcrumbs.length && !actions) return heading;

  return (
    <Box sx={{ mb: 2 }}>
      {heading}

      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={{ xs: 1, sm: 2 }}
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        justifyContent="space-between"
      >
        {breadcrumbs.length > 0 ? (
          <Breadcrumbs aria-label="breadcrumb">
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
        ) : (
          // Keeps the actions on the right when a page has no breadcrumbs.
          <Box />
        )}

        {actions && (
          <Stack direction="row" spacing={1} flexShrink={0}>
            {actions}
          </Stack>
        )}
      </Stack>
    </Box>
  );
};

export default PageHeader;
