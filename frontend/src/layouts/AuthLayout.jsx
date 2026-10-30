import { Outlet } from 'react-router-dom';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';

import BrandMark from '@components/common/BrandMark.jsx';

/**
 * Shell for signed-out screens. Deliberately chrome-free -- no navigation, no
 * account menu -- so nothing on the page implies a session that does not exist.
 */
const AuthLayout = () => (
  <Box
    sx={{
      minHeight: '100vh',
      display: 'grid',
      placeItems: 'center',
      p: 2,
      background: (theme) =>
        theme.palette.mode === 'light'
          ? 'linear-gradient(140deg, #eef3fb 0%, #f7f9fc 55%, #eaf0f8 100%)'
          : 'linear-gradient(140deg, #0d1218 0%, #121922 55%, #0f151c 100%)',
    }}
  >
    <Box sx={{ width: '100%', maxWidth: 440 }}>
      <Box sx={{ textAlign: 'center', mb: 3 }}>
        <BrandMark variant="login" />
      </Box>

      <Paper variant="outlined" sx={{ p: { xs: 3, sm: 4 }, borderRadius: 3 }}>
        <Outlet />
      </Paper>
    </Box>
  </Box>
);

export default AuthLayout;
