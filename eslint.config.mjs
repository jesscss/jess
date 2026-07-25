import {
  globalIgnores
} from 'eslint/config';
import globals from 'globals';
import stylistic from '@stylistic/eslint-plugin';
import js from '@eslint/js';
import importPlugin from 'eslint-plugin-import';
import {
  FlatCompat
} from '@eslint/eslintrc';

import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import Module, { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const typescript6ApiPath = require.resolve('@typescript/typescript6');
const typescript6Api = require('@typescript/typescript6');
const originalResolveFilename = Module._resolveFilename;

typescript6Api.Extension ??= {
  Cjs: '.cjs',
  Cts: '.cts',
  Js: '.js',
  Jsx: '.jsx',
  Mjs: '.mjs',
  Mts: '.mts',
  Ts: '.ts',
  Tsx: '.tsx'
};

Module._resolveFilename = function(request, parent, isMain, options) {
  if (request === 'typescript') {
    return typescript6ApiPath;
  }
  if (request.startsWith('typescript/lib/')) {
    return require.resolve(`@typescript/typescript6/${request.slice('typescript/'.length)}`);
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

const { default: tseslint } = await import('typescript-eslint');
const { default: localRules } = await import('./scripts/eslint-rules/index.mjs');
const { default: grammarRules } = await import('./scripts/eslint-rules/grammar-rules.mjs');

/**
 * Grammar sources: the four dialect parsers plus the shared recognition surface
 * they are supposed to COMPOSE rather than reimplement.
 *
 * Each parser has TWO grammars — the direct-AST one and the CST one the
 * language service uses — and both are in scope. A rule enforced on one and not
 * the other is how they drifted apart before (`${…}` shipped in the AST grammar
 * and errored in the editor for exactly that reason).
 */
const GRAMMAR_FILES = [
  'packages/syntax/css/css-parser/src/**/*.ts',
  'packages/syntax/less/less-parser/src/**/*.ts',
  'packages/syntax/scss/scss-parser/src/**/*.ts',
  'packages/syntax/jess/jess-parser/src/**/*.ts',
  'packages/parser-shared/src/**/*.ts'
];

/**
 * Test scope, matching the `lint:tests` glob in package.json.
 *
 * Deliberately WIDER than the older `**\/test\/**` block further down: that one
 * predates `.spec.` files, nested `__tests__` subdirectories and `perf/`, so it
 * silently missed files that `lint:tests` does lint.
 */
const TEST_FILES = [
  'packages/**/test/**/*.{mjs,cjs,js,ts}',
  'packages/**/__tests__/**/*.{mjs,cjs,js,ts}',
  'packages/**/*.{test,spec}.{mjs,cjs,js,ts}',
  'packages/**/perf/**/*.{mjs,cjs,js,ts}'
];

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all
});

const customized = stylistic.configs.customize({
  indent: 2,
  quotes: 'single',
  semi: true,
  jsx: true,
  braceStyle: '1tbs'
});

const jsRules = {
  semi: 0,
  ...customized.rules,

  /*
   * Disallow single-line blocks like: `if (x) { y(); }`
   * so ESLint can auto-fix to a multiline block.
   */
  '@stylistic/brace-style': ['error', '1tbs', { allowSingleLine: false }],

  '@stylistic/space-before-function-paren': ['error', {
    anonymous: 'never',
    named: 'never',
    asyncArrow: 'always'
  }],

  '@stylistic/quote-props': ['error', 'as-needed'],

  camelcase: ['warn', {
    ignoreDestructuring: true,
    properties: 'never'
  }],

  '@stylistic/no-multi-spaces': 0,

  '@stylistic/operator-linebreak': ['error', 'before', {
    overrides: {
      '=': 'after'
    }
  }],

  '@stylistic/eol-last': 0,
  'no-return-assign': 0,
  '@stylistic/function-call-spacing': 'error',
  '@stylistic/comma-dangle': ['error', 'never'],
  '@stylistic/padded-blocks': ['error', 'never'],

  /*
   * Consistency / DRY / organization nudges (all auto-fixable; `warn` because
   * `pnpm lint` is not yet a blocking gate — promote to `error` once a baseline
   * sweep lands). Run `pnpm lint:fix` on files you touch.
   */
  'object-shorthand': ['warn', 'always'],
  'no-useless-rename': 'warn',
  'no-lonely-if': 'warn',
  'no-else-return': ['warn', { allowElseIf: false }],
  'no-unneeded-ternary': ['warn', { defaultAssignment: false }],
  'prefer-object-spread': 'warn',
  'dot-notation': 'warn',

  /*
   * Organization guardrails: a function that trips these is usually doing too
   * much / named like a sentence — a signal to split, not a hard limit.
   */
  'max-depth': ['warn', 5],
  'max-params': ['warn', 6]
};

export default tseslint.config([
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser
      }
    },
    plugins: {
      '@stylistic': stylistic,
      '@typescript-eslint': tseslint.plugin,
      import: importPlugin
    }
  }, {
    files: ['**/*.js', '**/*.mjs'],

    rules: {
      ...jsRules,
      curly: ['error', 'all'],
      'prefer-const': 0
    }
  }, {
    files: ['**/*.ts', '**/*.tsx'],

    plugins: {
      '@stylistic': stylistic,
      '@typescript-eslint': tseslint.plugin
    },

    extends: compat.extends(),

    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },

    rules: {
      ...jsRules,
      'eol-last': 0,
      'prefer-const': 0,
      curly: ['error', 'all'],
      '@typescript-eslint/no-confusing-void-expression': 'off',
      'no-void': 0,
      '@typescript-eslint/consistent-type-assertions': 0,
      '@typescript-eslint/no-unsafe-type-assertion': 'error',

      /*
       * Enforce runtime-correct ESM specifiers in TS source:
       * - relative imports must include `.js`
       * - directory imports like `./foo` are banned; use `./foo/index.js`
       */
      'import/extensions': ['error', 'ignorePackages', {
        js: 'always',
        mjs: 'always',
        cjs: 'always'
      }],

      // DRY / consistency (type-aware; auto-fixable). `warn` — see jsRules note.
      'import/no-duplicates': 'warn',
      '@typescript-eslint/prefer-optional-chain': 'warn',

      '@typescript-eslint/no-floating-promises': ['warn', {
        ignoreVoid: true
      }],

      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_'
      }],

      '@typescript-eslint/strict-boolean-expressions': 0,
      '@typescript-eslint/restrict-template-expressions': 0,
      '@typescript-eslint/method-signature-style': 0,
      '@typescript-eslint/explicit-function-return-type': 0,
      '@typescript-eslint/no-non-null-assertion': 0,
      '@typescript-eslint/consistent-type-definitions': 0,
      '@typescript-eslint/no-this-alias': 0,

      '@typescript-eslint/naming-convention': ['error', {
        selector: 'default',
        format: ['camelCase', 'PascalCase', 'UPPER_CASE', 'snake_case'],
        leadingUnderscore: 'allow'
      },

      // Destructured bindings may mirror underscored object keys (`const { _x } = o`).
      {
        selector: 'variable',
        modifiers: ['destructured'],
        leadingUnderscore: 'allow',
        format: ['camelCase', 'UPPER_CASE', 'PascalCase', 'snake_case']
      },
      {
        selector: 'parameter',
        modifiers: ['destructured'],
        leadingUnderscore: 'allow',
        format: ['camelCase', 'UPPER_CASE', 'PascalCase', 'snake_case']
      }, {
        selector: 'variableLike',
        format: ['camelCase', 'UPPER_CASE', 'PascalCase', 'snake_case']
      }, {
        selector: 'memberLike',
        format: ['camelCase', 'PascalCase', 'UPPER_CASE', 'snake_case'],
        leadingUnderscore: 'allow'
      }, {
        selector: 'memberLike',
        modifiers: ['private'],
        leadingUnderscore: 'allowSingleOrDouble',
        format: ['camelCase', 'UPPER_CASE']
      }, {
        selector: 'memberLike',
        modifiers: ['protected'],
        leadingUnderscore: 'allow',
        format: ['camelCase', 'UPPER_CASE']
      }, {
        selector: 'typeLike',
        format: ['PascalCase', 'UPPER_CASE', 'snake_case']
      },
      {
        selector: 'parameter',
        modifiers: ['unused'],
        format: ['camelCase', 'PascalCase', 'UPPER_CASE', 'snake_case'],
        leadingUnderscore: 'allow'
      }, {
        selector: 'objectLiteralProperty',
        filter: {
          regex: '^\\d+$',
          match: true
        },
        format: [] // Allow numeric property names
      }]
    }
  }, {
    files: ['**/test/**/*.{js,ts}', '**/__tests__/*.{js,ts}', '**/*.test.{js,ts}'],

    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest
      }
    },

    plugins: {
      '@typescript-eslint': tseslint.plugin
    },

    rules: {
      '@typescript-eslint/no-unused-vars': 0,
      curly: ['error', 'all']
    }
  },

  /*
   * =========================================================================
   * TESTS: the broad assertion rule is OFF; the absolute rule is enforced
   * elsewhere and is NOT suppressible.
   *
   * `no-unsafe-type-assertion` fires on every `x as SomeNode` used to build a
   * fixture or narrow a parse result. In test code that is the normal idiom,
   * not a defect, and it had accumulated 444 per-site `eslint-disable`
   * comments across 38 files — enough noise that adding the next one had
   * stopped being a decision.
   *
   * Turning it off here is NOT a relaxation of "never `as any`". That rule is
   * an absolute, and it now has its own enforcement that this block cannot
   * reach and no comment can silence: `eslint.absolute.config.mjs`, run by
   * `pnpm lint:absolute`, with `noInlineConfig`. See
   * `scripts/eslint-rules/absolute-bans.mjs` for the ban itself.
   *
   * What is genuinely given up here is the NARROWING half of the rule
   * (`x as Ruleset` where `x` is wider) in test files only. That was 222 of
   * the 581 assertions this rule reports across the test glob; the other 359
   * were `any`-related and are now covered by the absolute pass instead.
   * Production `src/` keeps the full rule.
   * =========================================================================
   */
  {
    files: TEST_FILES,
    rules: {
      '@typescript-eslint/no-unsafe-type-assertion': 'off'
    }
  },

  /*
   * =========================================================================
   * COMMENT SHAPE — repo-wide, `error`, both autofixing.
   *
   * NOTE FOR ANYONE CHANGING LAYOUT LATER: this repo has NO formatter, and
   * that is deliberate. There is no prettier, no prettier config, and none is
   * wanted. The `@stylistic` rules below OWN layout outright, which is what
   * makes an always-expanded form enforceable at all — a fit-based formatter
   * would collapse it right back. Do not add one.
   *
   * Both rules are scoped repo-wide because they are cheap, autofixable, and
   * about readability rather than any grammar-specific concern.
   * =========================================================================
   */
  {
    files: ['packages/**/*.{js,mjs,cjs,ts,tsx}', 'scripts/**/*.{js,mjs,cjs,ts}', '*.config.{js,mjs,cjs,ts}'],
    plugins: { grammar: grammarRules, '@stylistic': stylistic },
    rules: {
      /*
       * A comment that spans lines is ONE comment and must be one block
       * comment. A lone `//` is untouched — banning every line comment
       * repo-wide is a much bigger change with no stated benefit, and the
       * stricter "no `//` at all" lives in the grammar block below instead.
       *
       * Runs containing a DIRECTIVE (`eslint-disable-next-line`,
       * `@ts-expect-error`, coverage pragmas) are skipped: their meaning is
       * positional, and merging two of them into one block comment would
       * silently disable both.
       */
      'grammar/no-multiline-line-comments': 'error',

      /*
       * A comment gets a blank line above it, so it separates from the code
       * it follows instead of crowding it. All the `*Start`/`*End` allowances
       * are on, so a comment opening a block, object, array, class,
       * interface, enum, module, or type never demands a separator, and
       * neither does one at the top of a file. Trailing same-line comments
       * and consecutive comment lines are unaffected.
       */
      '@stylistic/lines-around-comment': ['error', {
        beforeBlockComment: true,
        beforeLineComment: true,
        allowBlockStart: true,
        allowBlockEnd: true,
        allowObjectStart: true,
        allowObjectEnd: true,
        allowArrayStart: true,
        allowArrayEnd: true,
        allowClassStart: true,
        allowClassEnd: true,
        allowEnumStart: true,
        allowEnumEnd: true,
        allowInterfaceStart: true,
        allowInterfaceEnd: true,
        allowModuleStart: true,
        allowModuleEnd: true,
        allowTypeStart: true,
        allowTypeEnd: true
      }]
    }
  },

  /*
   * =========================================================================
   * GRAMMAR SOURCES — maximum strictness.
   *
   * These files are parseman's reference implementation. The bar is "would
   * this be the example in the docs", which is higher than ordinary code.
   * =========================================================================
   */
  {
    files: GRAMMAR_FILES,
    ignores: ['**/__tests__/**', '**/*.test.ts'],
    plugins: { grammar: grammarRules, '@stylistic': stylistic },
    rules: {
      /*
       * Block comments only. Grammar rules are documented productions, and a
       * `//` cannot carry a `@see` link to the spec paragraph a rule
       * implements. Directive comments remain exempt.
       */
      'grammar/no-line-comments': 'error',
      'grammar/no-multiline-line-comments': 'off',

      /*
       * A raw non-ASCII character in a regex cannot be reviewed: U+0080 and
       * U+00A0 are the same glyph on screen, and neither announces itself as a
       * range endpoint. Escapes also survive re-encoding and copy-paste. The
       * fix is byte-preserving for the compiled pattern.
       */
      'grammar/no-literal-non-ascii-in-regex': 'error',

      /*
       * A grammar recognises input through combinators. An ad-hoc regex is
       * invisible to the macro compiler and to first-set computation.
       */
      'grammar/no-regex-outside-combinator': 'error',

      /*
       * Keeps the file macro-buildable: no factories, no spreads into
       * combinator argument lists, no patterns assembled from variables.
       * `check-macro-buildable` catches these at build time; catching them at
       * write time is strictly better.
       */
      'grammar/no-macro-hazards': 'error',

      /*
       * MATCHING PARENS. Every `(` that opens a multi-line call has its `)` at
       * the indentation of the line that opened it, so parens pair visually
       * down the left edge and nesting depth reads straight off the
       * indentation. The stacked-closer form (`literal(';')));`) destroys
       * that, and is the single biggest reason these files read like assembly.
       *
       * Single-argument calls are untouched by `function-call-argument-newline`,
       * so `regex(/…/)` and `literal(';')` stay one-liners.
       */
      /*
       * `multiline-arguments`, NOT `multiline`. `multiline` actively COLLAPSES
       * a single-argument wrapper — it rewrites the preferred
       *
       *   node(
       *     sequence(…)
       *   )
       *
       * back into `node(sequence(…)`, which is the stacked-closer form this is
       * meant to eliminate. `multiline-arguments` permits the expanded wrapper
       * and still requires expansion once multiple arguments span lines.
       *
       * Known limit, stated plainly: no `@stylistic` option can REQUIRE the
       * expanded wrapper for a single argument without also exploding
       * `regex(/…/)` into three lines. The one-argument-per-line rule below is
       * what does the real work; this one just stops the collapse.
       */
      '@stylistic/function-paren-newline': ['error', 'multiline-arguments'],
      '@stylistic/function-call-argument-newline': ['error', 'always']

      /*
       * Deliberately NOT re-declaring `@stylistic/indent` here. The base config
       * already sets it from the `customize()` preset, whose options differ
       * from a bare `['error', 2]`; declaring it twice gave two disagreeing
       * definitions of correct indentation and left 128 unfixable errors.
       * One rule, one definition.
       */
    }
  },

  /*
   * TEMPORARY, and deliberately narrow: `less-parser`'s two grammars are being
   * rewritten right now, and reformatting them underneath that pass would
   * collide with it. The rules above are LANDED for these files — this block
   * only defers the layout ones, which are the churny autofixable ones. The
   * correctness rules (non-ASCII regex, hand-rolled keywords, macro hazards)
   * stay ON, because those are the defects the cleanup is meant to remove.
   *
   * Outstanding at the time of writing: 1403 function-call-argument-newline,
   * 276 no-line-comments, 103 function-paren-newline, 21 indent, all
   * autofixable. DELETE THIS BLOCK once that pass lands and `pnpm lint:fix`
 * has been run over `packages/less-parser/src`.
 */
  {
    files: ['packages/syntax/less/less-parser/src/**/*.ts'],
    rules: {
      'grammar/no-line-comments': 'off',
      '@stylistic/function-paren-newline': 'off',
      '@stylistic/function-call-argument-newline': 'off',
      '@stylistic/lines-around-comment': 'off',

      /*
       * Also deferred: 16 raw non-ASCII characters in regex literals. These are
       * autofixable and byte-preserving, but they sit in the two files being
       * rewritten, so they belong to that pass rather than to a drive-by edit.
       */
      'grammar/no-literal-non-ascii-in-regex': 'off'
    }
  },

  /*
   * ---------------------------------------------------------------------------
   * LLM-quality REGRESSION PINS (local rules). ALL `warn` (advisory) by policy:
   * these are pins, not merge gates. Several are intentionally heuristic and
   * WILL surface some legitimate code; promotion of any to `error`/blocking
   * requires a measured <5% false-positive bake on real PRs. See
   * `scripts/eslint-rules/index.mjs` for the per-rule limitation notes.
   * ---------------------------------------------------------------------------
   */

  /*
   * #2 Byte re-derivation — hot AST code only; serializers/debug are the
   * legitimate owners of byte scanning, so they are excluded.
   */
  {
    files: ['packages/*/src/ast/**/*.{ts,tsx}'],
    ignores: [
      '**/serialize*.{ts,tsx}',
      '**/*debug*.{ts,tsx}',
      '**/__tests__/**',
      '**/*.test.{ts,tsx}',
      '**/*.spec.{ts,tsx}'
    ],
    plugins: { local: localRules },
    rules: {
      'local/no-serialize-rederivation': 'warn'
    }
  },

  /*
   * #3 Full-tree walk — best-effort, report-only; scoped to an explicit
   * allowlist of eval/render hot-path files (recursion is legitimate in
   * serialize/eval, so this stays advisory and narrowly targeted).
   */
  {
    files: [
      'packages/core/src/ast/value-eval.ts',
      'packages/core/src/ast/eval*.ts',
      'packages/core/src/ast/evaluator*.ts',
      'packages/core/src/ast/render*.ts',
      'packages/core/src/ast/resolve*.ts'
    ],
    plugins: { local: localRules },
    rules: {
      'local/no-full-tree-walk-hot-path': 'warn'
    }
  },

  /*
   * #6 Oversized/duplicated choice — RETIRED. `choice()` in `src/…grammar.ts` is
   * an AUTHORED parseman macro DSL declaration (`import … from 'parseman' with
   * { type: 'macro' }`); the parseman compiler (`parseman.rolldown()` in tsdown)
   * expands it at build into `lib/` (gitignored), and THAT compiled output — not
   * the authored arm list — decides dispatch: disjoint arms become a switch
   * jump-table or a single integer compare each (no re-lex), and reference arms
   * keep dispatch parity via the fixpoint first-set recipe. So arm count on the
   * authored declaration is NOT a cost signal, and eslint only ever sees the
   * authored src. Genuine duplication (e.g. scss copy-pasting a statement-body
   * choice 26×) is a code-size/structure concern surfaced by the grammar audit,
   * not a line-count lint. See docs/perf/V8-ARCHITECTURE.md invariant 8 / R5.
   * Rule impl kept in scripts/eslint-rules for reference but intentionally unwired.
   */

  /*
   * Deprecated DetachedRuleset AST node type. Allowlist: the plugin-transport
   * (`serialize.ts` uses the less.js-facing transport tag; `value-eval.ts`
   * declares the `PluginDetachedRuleset` transport interface) and the
   * grammar/CST `DetachedRuleset` productions (grammar files live outside
   * `src/ast`, so they are already out of scope).
   */
  {
    files: ['packages/*/src/ast/**/*.{ts,tsx}'],
    ignores: [
      '**/serialize.ts',
      '**/value-eval.ts',
      '**/__tests__/**'
    ],
    plugins: { local: localRules },
    rules: {
      'local/no-deprecated-detached-ruleset': 'warn'
    }
  }, globalIgnores([
    '**/node_modules/**',
    '**/lib/**',
    '**/dist/**',
    '**/coverage/**',
    '.claude/worktrees/**',
    '.git/worktrees/**'
  ])
]);
