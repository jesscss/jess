import baseConfig from '../../_shared/eslint.config.mjs';

export default [
  ...baseConfig,
  {
    ignores: ['lib/**', '*.config.*']
  }
];
