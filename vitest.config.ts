import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@': resolve(__dirname, 'src/renderer'),
      // The tests exercise both builds' code, so they resolve the Internal surface. What the
      // STORE build contains is proved against a real built bundle, in
      // tests/unit/storeBuildHasNoDevPaths.test.ts, not by this alias.
      '@internal': resolve(__dirname, 'src/main/internal/index.ts'),
      '@internal-ui': resolve(__dirname, 'src/renderer/internal/index.tsx'),
    },
  },
  test: {
    // The unit tests exercise both builds' code, so they run as the Internal one. The proof
    // that the STORE build contains none of it is a separate test that reads the built bundle
    // (tests/unit/storeBuildHasNoDevPaths.test.ts), not this flag.
    env: { PONYABC_INTERNAL: '1' },
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    environment: 'node', // most tests are pure Node; .tsx tests opt into jsdom via a per-file pragma
  },
});
