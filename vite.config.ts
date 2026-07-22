import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Web app build config. Source root is `web/`; build output lands at `web/dist`
// (outDir is relative to root, so 'dist' resolves to web/dist).
export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
