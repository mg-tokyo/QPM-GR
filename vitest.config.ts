import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { __QPM_FIXTURE__: 'true' },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    globals: false,
    setupFiles: ['./src/test-setup.ts'],
  },
});
