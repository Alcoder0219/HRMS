import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = (segment = '') => path.resolve(__dirname, 'src', segment);

export default defineConfig(({ mode }) => {
  const envVars = loadEnv(mode, __dirname, 'VITE_');

  /**
   * Where the dev server forwards API and upload traffic.
   *
   * Defaults to loopback because the proxy runs ON the server machine -- it is
   * the browser that is remote, not this hop. Override only when the API lives
   * on a different host from the web server.
   */
  const apiTarget = envVars.VITE_API_PROXY_TARGET || 'http://127.0.0.1:5000';

  /**
   * Both the API and the uploads directory are proxied.
   *
   * `/uploads` matters as much as `/api`: avatars and documents are stored as
   * root-relative paths (`/uploads/avatars/x.jpg`), so a browser on another
   * machine resolves them against the WEB origin. Without this rule every
   * image 404s the moment the app is opened from anywhere but the server.
   */
  /**
   * A refused connection is reported as one line, not a stack trace.
   *
   * The browser retries `/auth/refresh` on load, so starting the web server
   * before the API -- or restarting the API while a tab is open -- prints
   * several `TCPConnectWrap.afterConnect` traces that look like a crash in the
   * frontend. They are neither, and the node internals in them point away from
   * the actual problem: nothing is listening on the target yet.
   */
  const onProxyError = (proxyServer) => {
    proxyServer.on('error', (error, request) => {
      const reason = error.code === 'ECONNREFUSED' ? `no API listening on ${apiTarget}` : error.message;
      console.log(`  [proxy] ${request.url} -> ${reason}`);
    });
  };

  const proxy = {
    '/api': { target: apiTarget, changeOrigin: true, configure: onProxyError },
    '/uploads': { target: apiTarget, changeOrigin: true, configure: onProxyError },
  };

  return {
    plugins: [react()],

    // Aliases mirror the folder architecture one-for-one. Imports stay stable
    // when a file moves, and `../../../` chains never appear.
    resolve: {
      alias: {
        '@': src(),
        '@assets': src('assets'),
        '@components': src('components'),
        '@config': src('config'),
        '@layouts': src('layouts'),
        '@pages': src('pages'),
        '@hooks': src('hooks'),
        '@redux': src('redux'),
        '@services': src('services'),
        '@contexts': src('contexts'),
        '@routes': src('routes'),
        '@styles': src('styles'),
        '@utils': src('utils'),
      },
    },

    server: {
      // 0.0.0.0 binds every interface, so the dev server answers on the LAN.
      // Binding to localhost accepts connections only from this machine.
      host: true,
      port: Number(envVars.VITE_PORT) || 5173,
      // Fail loudly instead of silently moving to 5174: clients have been told
      // one port, and a silent change looks like the server is down.
      strictPort: true,
      open: false,
      proxy,
    },

    // `vite preview` serves the production build. It needs the same proxy, or
    // a build tested locally breaks the moment it is opened over the network.
    preview: {
      host: true,
      port: Number(envVars.VITE_PREVIEW_PORT) || 4173,
      strictPort: true,
      proxy,
    },

    build: {
      outDir: 'dist',
      sourcemap: mode !== 'production',
      chunkSizeWarningLimit: 1200,
      rollupOptions: {
        output: {
          // Vendor libraries change far less often than product code; splitting
          // them keeps their hashes stable across deploys so browsers re-use
          // the cached chunks. Rolldown (Vite 8) requires the function form.
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (/node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) {
              return 'react';
            }
            if (/node_modules[\\/](@reduxjs|react-redux|redux|redux-thunk|immer|reselect)[\\/]/.test(id)) {
              return 'redux';
            }
            if (/node_modules[\\/](@mui|@emotion)[\\/]/.test(id)) return 'mui';
            return 'vendor';
          },
        },
      },
    },
  };
});
