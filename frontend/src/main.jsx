import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider as ReduxProvider } from 'react-redux';
import store from '@redux/store.js';
import App from './App.jsx';
import './styles/global.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {/* Redux sits outside the theme provider because the theme mode is read
        from the store. */}
    <ReduxProvider store={store}>
      <App />
    </ReduxProvider>
  </StrictMode>,
);
