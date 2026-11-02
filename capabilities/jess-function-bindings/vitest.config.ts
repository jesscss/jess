/*
 * Runs the consumer suites against the BUILT workspace packages (no source
 * aliases): an observation run then costs seconds instead of the source graph's
 * transform, and the checker rebuilds the owner packages after each probe. The
 * one exception is `@jesscss/compiler`, a consumer: it loads from source, so a
 * consumer alternative the verifier writes there is the code that runs.
 */
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const compiler = (file: string): string => fileURLToPath(new URL(`../../packages/compiler/src/${file}.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@jesscss\/compiler$/u, replacement: compiler('index') },
      { find: /^@jesscss\/compiler\/(diagnostics|config)$/u, replacement: compiler('$1') }
    ]
  },
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
