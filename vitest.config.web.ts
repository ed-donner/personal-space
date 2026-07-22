import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Frontend unit suite. jsdom environment. Coverage target enforced.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'web/src'),
    },
  },
  test: {
    include: ['web/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['web/src/test-setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['web/src/**'],
      thresholds: {
        statements: 80,
      },
    },
  },
});
