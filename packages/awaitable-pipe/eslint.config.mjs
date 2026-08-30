import rootConfig from '../../eslint.config.mjs';
import tseslint from 'typescript-eslint';

export default tseslint.config([
  ...rootConfig,
  {
    files: ['**/*.ts', '**/*.tsx'],
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
    // pipe/safePipe overload implementations use `as any` throughout
    // (type safety from overload signatures); tryStep uses fallback
    // casts that TS can't narrow because R may itself be a function.
    files: ['src/pipe.ts', 'src/helpers.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-type-assertion': 'off'
    }
  }
]);
