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
        // Require 100% coverage for productions.ts
        thresholds: {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'src/productions.ts': {
            statements: 100,
            branches: 100,
            functions: 100,
            lines: 100
          }
        }
      }
    }
  })
);
