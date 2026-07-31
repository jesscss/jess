/**
 * HOT-PATH ANTIPATTERN pass. Run via `pnpm audit:hot-path` (report) or
 * `pnpm verify:hot-path` (named-set comparison).
 *
 * WHY A SEPARATE CONFIG, and not a block in eslint.config.mjs:
 *
 * `pnpm lint` is a gate people run constantly. Adding six heuristic rules to
 * it — three of which are explicitly advisory — would bury the rules that are
 * actually decidable under warnings nobody reads, and would make the default
 * pass noisy on an untouched checkout. A gate that is red on a clean tree is
 * not a gate; it teaches people to reach for `--no-verify` on the gates that
 * matter. So this pass is opt-in and separate, exactly like
 * `eslint.absolute.config.mjs`.
 *
 * SCOPE. Deliberately the hot paths, and only them:
 *
 *   packages/core/src/ast/**            the AST-v2 eval/serialize engine
 *   packages/syntax/<d>/<d>-parser/src  the four dialect parsers
 *
 * `packages/core/src/tree/**` is NOT scoped in. It is ~67k lines of legacy
 * slated for deletion in the AST-v2 cutover, and pinning an inventory of
 * hundreds of sites in dying code buys nothing and would have to be maintained
 * as that code is deleted. Findings there belong in the audit, not the gate.
 *
 * The four `grammar.ts` files ARE in scope but only for the rules that make
 * sense on an authored parseman macro declaration. `no-loop-invariant-accessor`
 * and `no-rescan-in-loop` are off for them: a combinator declaration is not a
 * runtime loop, and parseman's compiler — not the authored arm list — decides
 * dispatch (V8-ARCH invariant 8).
 */
import './scripts/eslint-rules/typescript6-shim.mjs';

import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { globalIgnores } from 'eslint/config';

import hotPathRules from './scripts/eslint-rules/hot-path-rules.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const { default: tseslint } = await import('typescript-eslint');

const HOT_PATHS = [
  'packages/core/src/ast/**/*.{ts,tsx}',
  'packages/syntax/css/css-parser/src/**/*.{ts,tsx}',
  'packages/syntax/less/less-parser/src/**/*.{ts,tsx}',
  'packages/syntax/scss/scss-parser/src/**/*.{ts,tsx}',
  'packages/syntax/jess/jess-parser/src/**/*.{ts,tsx}'
];

const NOT_PRODUCTION = [
  '**/__tests__/**',
  '**/test/**',
  '**/*.test.{ts,tsx}',
  '**/*.spec.{ts,tsx}',
  '**/*.d.ts'
];

const GRAMMAR_SOURCES = [
  'packages/syntax/*/*-parser/src/**/grammar.ts',
  'packages/syntax/*/*-parser/src/**/cst*.ts'
];

export default tseslint.config([
  {
    files: HOT_PATHS,
    ignores: NOT_PRODUCTION,

    plugins: { hotpath: hotPathRules },

    languageOptions: {
      parser: tseslint.parser,

      /*
       * No `projectService`: none of these rules is type-aware, so the pass
       * cannot be silently weakened by an unbuilt or stale `lib/`.
       */
      parserOptions: { tsconfigRootDir: __dirname }
    },

    rules: {
      /*
       * `allocatingCallees` names the project helpers that return a FRESH
       * collection. There is no syntactic way to know this, and guessing from a
       * naming heuristic would fire on honest code, so the list is explicit and
       * reviewed. Add a helper here when it allocates unconditionally.
       */
      'hotpath/no-speculative-allocation-predicate': ['warn', {
        allocatingCallees: [
          'blockCommentsIn',
          'commentRuns',
          'selectorAtoms'
        ]
      }],
      'hotpath/no-node-keyed-side-map': 'warn',
      'hotpath/no-rescan-in-loop': 'warn',
      'hotpath/no-loop-invariant-accessor': 'warn',
      'hotpath/no-source-text-rescan': 'warn',
      'hotpath/no-json-stringify-on-tree': 'warn'
    }
  },

  /*
   * Grammar sources: declarative parseman macro combinators, not runtime loops.
   * The two loop-shaped rules are meaningless there and would be pure noise.
   */
  {
    files: GRAMMAR_SOURCES,
    rules: {
      'hotpath/no-rescan-in-loop': 'off',
      'hotpath/no-loop-invariant-accessor': 'off'
    }
  },

  globalIgnores([
    '**/node_modules/**',
    '**/lib/**',
    '**/dist/**',
    '**/coverage/**',
    '.claude/worktrees/**',
    '.git/worktrees/**'
  ])
]);
