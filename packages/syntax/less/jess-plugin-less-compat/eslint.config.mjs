import rootConfig from '../../../../eslint.config.mjs';
import tseslint from 'typescript-eslint';

export default tseslint.config([
  ...rootConfig,
  {
    files: ['src/**/*.ts', 'test/**/*.ts', 'vitest.config.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      '@typescript-eslint/no-unsafe-type-assertion': 'error'
    }
  },
  {
    // Dynamic plugin interop in the native plugin boundary.
    files: ['src/plugin.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-type-assertion': 'off'
    }
  }
]);
