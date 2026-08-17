import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { PATHS } from '@routes/paths.js';

const ErrorPage = ({ code, title, message }) => {
  const navigate = useNavigate();

  return (
    <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '60vh', textAlign: 'center' }}>
      <Stack spacing={1.5} alignItems="center">
        <Typography variant="h1" color="primary" sx={{ fontSize: '4.5rem', fontWeight: 800 }}>
          {code}
        </Typography>
        <Typography variant="h4">{title}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420 }}>
          {message}
        </Typography>
        <Stack direction="row" spacing={1} sx={{ pt: 2 }}>
          <Button variant="outlined" color="inherit" onClick={() => navigate(-1)}>
            Go back
          </Button>
          <Button variant="contained" onClick={() => navigate(PATHS.dashboard)}>
            Dashboard
          </Button>
        </Stack>
      </Stack>
    </Box>
  );
};

export const ForbiddenPage = () => (
  <ErrorPage
    code={403}
    title="Not permitted"
    message="Your role does not grant access to this area. If you believe this is wrong, contact your administrator."
  />
);

export const NotFoundPage = () => (
  <ErrorPage
    code={404}
    title="Page not found"
    message="The page you were looking for does not exist or has moved."
  />
);

export default ErrorPage;
