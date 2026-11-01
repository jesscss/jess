/*
 * Runs the consumer suites against the BUILT workspace packages (no source
 * aliases): an observation run then costs seconds instead of the source graph's
 * transform, and the checker rebuilds the owner packages after each probe.
 */
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    watch: false,
    isolate: false,
    globals: true,
    environment: 'node',
    env: { TEST: 'true' },
    setupFiles: [
      fileURLToPath(new URL('../../test/setup.ts', import.meta.url)),
      fileURLToPath(new URL('./observe.setup.ts', import.meta.url))
    ]
  }
});
