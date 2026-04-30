import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  const geminiKey =
    env.GEMINI_API_KEY || process.env.GEMINI_API_KEY || '';
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(geminiKey),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      host: '0.0.0.0',
      port: 3000,
      strictPort: true,
      // With --host 0.0.0.0, pin HMR to localhost so the browser ws:// URL matches dev machine access.
      hmr:
        process.env.DISABLE_HMR === 'true'
          ? false
          : {
              host: 'localhost',
              port: 3000,
              protocol: 'ws',
            },
    },
  };
});
