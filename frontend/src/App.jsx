import { useEffect } from 'react';
import { RouterProvider } from 'react-router-dom';
import ThemeProvider from '@contexts/ThemeContext.jsx';
import { ToastProvider } from '@contexts/ToastContext.jsx';
import { useAppDispatch } from '@hooks/useRedux.js';
import { bootstrapSession } from '@redux/slices/authSlice.js';
import router from '@routes/index.jsx';

/**
 * Composition root. Providers are declared here in dependency order; the app's
 * actual screens come entirely from the router.
 */
const App = () => {
  const dispatch = useAppDispatch();

  // Exchange the httpOnly refresh cookie for an access token on first paint,
  // so a page reload restores the session instead of ending it.
  useEffect(() => {
    dispatch(bootstrapSession());
  }, [dispatch]);

  // Toasts sit inside the theme (they are themed) and outside the router (a
  // toast raised by one screen must survive navigating away from it).
  return (
    <ThemeProvider>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </ThemeProvider>
  );
};

export default App;
