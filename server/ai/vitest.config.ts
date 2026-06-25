import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'node',
  },
  resolve: {
    // Unit tests exercise the REAL secret tools/prompt (proxy/src/secrets), matching
    // direct-local dev. The prod stub is only used by the packaged build, not tests.
    alias: {
      '@secrets': fileURLToPath(new URL('../../proxy/src/secrets/index.ts', import.meta.url)),
    },
  },
});
