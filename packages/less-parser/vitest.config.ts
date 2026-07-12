import { mergeConfig, defineConfig } from 'vitest/config';
import base from '../../vitest.config.js';

export default mergeConfig(
  base,
  defineConfig({
    test: {
      name: 'less-parser',
      // Coverage configuration for less-parser
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'html'],
        include: ['src/productions.ts'],
        exclude: [
          '**/*.test.ts',
          '**/*.spec.ts',
          '**/node_modules/**',
          '**/lib/**',
          '**/dist/**'
        ],
        // Keep reporting scoped to parser productions without hard-gating coverage.
      }
    }
  })
);
