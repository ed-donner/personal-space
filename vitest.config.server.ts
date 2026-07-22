import { defineConfig } from 'vitest/config';

// Backend unit suite. Temp-file SQLite per test; node environment.
export default defineConfig({
  test: {
    include: ['server/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['server/**/*.ts'],
      exclude: ['server/test/**', 'server/**/*.test.ts', 'server/index.ts'],
      thresholds: {
        statements: 80,
      },
    },
  },
});
