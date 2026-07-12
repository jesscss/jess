import rootConfig from '../../eslint.config.mjs';
import tseslint from 'typescript-eslint';

export default [
  ...rootConfig,
  {
    files: ['*.ts', '*.tsx'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
      '@typescript-eslint/no-misused-promises': [
        'error',
        {
          checksVoidReturn: {
            arguments: false
          }
        }
      ]
    }
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-type-assertion': 'error'
    }
  },
  {
    files: ['src/**/__tests__/**'],
    rules: {
      '@typescript-eslint/no-unsafe-type-assertion': 'off'
    }
  },
  {
    files: [
      // Dynamic property access via childKeys, constructor patterns
      'src/tree/node-base.ts',
      'src/tree/node.ts',
      'src/tree/rules.ts',
      // Heavy duck-typing of function metadata (rest, lazy, params)
      'src/define-function.ts',
      // Type serialization internals
      'src/tree/util/serialize-types.ts',
      // Mixin/function resolution with runtime type narrowing
      'src/tree/util/mixin-instance-primitives.ts',
      'src/tree/util/registry-utils.ts',
      'src/tree/reference.ts',
      // Selector type narrowing through abstract hierarchy
      'src/tree/selector.ts',
      'src/tree/util/selector-utils.ts',
      'src/tree/util/selector-match-core.ts',
      'src/tree/util/extend-core.ts',
      'src/tree/util/process-leading-is.ts',
      'src/tree/util/collections.ts',
      'src/tree/util/field-helpers.ts',
      'src/tree/extend.ts',
      'src/tree/ruleset.ts',
      'src/tree/ampersand.ts',
      'src/tree/call.ts',
      'src/tree/mixin.ts',
      'src/tree/declaration.ts',
      'src/tree/control.ts',
      'src/tree/color.ts',
      'src/tree/dimension.ts',
      'src/tree/list.ts',
      'src/tree/import-style.ts',
      'src/tree/selector-complex.ts',
      'src/tree/selector-compound.ts',
      'src/tree/selector-list.ts',
      'src/tree/selector-capture.ts',
      // Narrowing casts from Node.eval() return types
      'src/tree/at-rule.ts',
      'src/tree/function.ts',
      'src/tree/quoted.ts',
      'src/tree/selector-interpolated.ts',
      'src/tree/url.ts',
      'src/tree/expression.ts',
      'src/tree/interpolated.ts',
      'src/tree/import-js.ts',
      'src/tree/condition.ts',
      'src/tree/declaration-custom.ts',
      'src/tree/declaration-var.ts',
      'src/tree/index.ts',
      'src/tree/operation.ts',
      'src/tree/selector-attr.ts',
      'src/tree/selector-basic.ts',
      'src/tree/selector-pseudo.ts',
      'src/tree/sequence.ts',
      'src/tree/util/print.ts',
      'src/tree/util/is-node.ts',
      'src/tree/util/cast.ts',
      'src/tree/util/recursion-helper.ts',
      'src/tree/util/serialize-helper.ts',
      'src/visitor/index.ts',
      'src/context.ts',
      'src/conversions.ts',
      'src/plugin.ts',
      // Third-party interop
      'src/tree/util/bitset.ts',
      'src/use-webpack-resolver.ts'
    ],
    rules: {
      '@typescript-eslint/no-unsafe-type-assertion': 'off'
    }
  }
];
