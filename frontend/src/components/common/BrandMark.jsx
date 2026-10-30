import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import amsonsLogo from '@assets/amsons-logo.jpeg';

/**
 * The Amsons Group logo and name, as the sidebar and the signed-out screens
 * show them.
 *
 * The logo sits on its own white tile in either theme: the artwork has a white
 * background, and a tile makes that look deliberate instead of a white patch on
 * a dark sidebar. It is sized by height and keeps its proportions everywhere.
 *
 *   variant="sidebar"  logo beside the name, fits the 64px toolbar row
 *   variant="login"    larger logo centred above the name
 *   compact            hides the name on phones, where the top bar is tight
 */
const LogoTile = ({ height, padding, radius }) => (
  <Box
    sx={{
      // Inline-block, not flex: a flex box sizes to the image's natural 1350px
      // width instead of its scaled one, and stretches the tile and the page.
      flexShrink: 0,
      display: 'inline-block',
      lineHeight: 0,
      p: padding,
      bgcolor: '#ffffff',
      border: 1,
      borderColor: 'divider',
      borderRadius: radius,
      boxShadow: '0 1px 3px rgba(16, 24, 40, 0.08)',
    }}
  >
    <Box
      component="img"
      src={amsonsLogo}
      alt="Amsons Group"
      sx={{ display: 'block', height, width: 'auto', objectFit: 'contain' }}
    />
  </Box>
);

const BrandMark = ({ variant = 'sidebar', compact = false }) => {
  if (variant === 'login') {
    return (
      // Styling lives in `sx`: MUI 9 no longer reads layout and font shorthand props.
      <Stack spacing={1.5} sx={{ alignItems: 'center' }}>
        <LogoTile height={{ xs: 84, sm: 100 }} padding={1.5} radius={3} />
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700, letterSpacing: '-0.01em' }}>
            Amsons Group
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Human Resource Management System
          </Typography>
        </Box>
      </Stack>
    );
  }

  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', minWidth: 0 }}>
      <LogoTile height={38} padding={0.5} radius={1.5} />
      <Box sx={{ minWidth: 0, display: compact ? { xs: 'none', sm: 'block' } : 'block' }}>
        <Typography variant="subtitle1" noWrap sx={{ fontWeight: 700, lineHeight: 1.2 }}>
          Amsons Group
        </Typography>
        <Typography
          variant="caption"
          color="primary"
          noWrap
          sx={{ display: 'block', fontWeight: 700, letterSpacing: '0.08em' }}
        >
          HRMS
        </Typography>
      </Box>
    </Stack>
  );
};

export default BrandMark;
