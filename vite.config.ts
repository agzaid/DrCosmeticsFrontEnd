import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import {parseApiOrigin} from './src/api/apiOrigin';

export default defineConfig(({command, mode}) => {
  // The API address is VITE_API_URL (see src/api/config.ts). A build only validates it, so a malformed production
  // address fails here instead of in a customer's browser. The dev and preview servers forward to it, always the
  // development address: a production build previewed locally is meant to be same-origin and has none of its own.
  const apiOrigin = parseApiOrigin(
    loadEnv(command === 'serve' ? 'development' : mode, __dirname, 'VITE_').VITE_API_URL,
  );
  if (command === 'serve' && apiOrigin === '') {
    throw new Error(
      'VITE_API_URL is empty: the dev server needs the API address to forward /api and /media to. Set it in .env.development.',
    );
  }

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      port: 5173,
      strictPort: true,
      // Same-origin in development: the browser talks only to Vite, which forwards API and media calls
      // to the .NET host. This keeps the HttpOnly auth/guest cookies first-party.
      proxy: {
        '/api': {
          target: apiOrigin,
          changeOrigin: true,
          secure: false,
        },
        '/media': {
          target: apiOrigin,
          changeOrigin: true,
          secure: false,
        },
      },
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
