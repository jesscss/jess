/**
 * NON-SUPPRESSIBLE pass for the project's absolute rule (`as any`, `: any`,
 * `@ts-ignore`, `@ts-nocheck`). Run via `pnpm lint:absolute`.
 *
 * WHY THIS IS A SEPARATE CONFIG FILE, and not a block in eslint.config.mjs:
 *
 * ESLint has no per-rule "cannot be disabled" switch. The only mechanism that
 * makes a rule immune to an inline `eslint-disable` comment is
 * `linterOptions.noInlineConfig`, and that is FILE-scoped, not rule-scoped —
 * setting it in the main config would silently void every other legitimate
 * disable comment in those files too.
 *
 * So the ban gets its own pass, where `noInlineConfig` is safe precisely
 * because these are the only rules turned on. There is nothing else in this
 * config for it to collaterally disable. An `// eslint-disable-next-line`
 * aimed at these rules is inert here.
 *
 * `--no-inline-config` is NOT relied on at the call site: a flag in a
 * package.json script can be dropped by anyone editing that line, whereas the
 * setting below travels with the config.
 */
/*
 * MUST come before `typescript-eslint` is loaded: redirects `typescript` to
 * `@typescript/typescript6`, same as eslint.config.mjs does inline.
 */
import './scripts/eslint-rules/typescript6-shim.mjs';

import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { globalIgnores } from 'eslint/config';

import absoluteBanRules from './scripts/eslint-rules/absolute-bans.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const { default: tseslint } = await import('typescript-eslint');

export default tseslint.config([
  {
    files: ['**/*.{ts,tsx,mts,cts}'],

    linterOptions: {
      /*
       * The whole point. Inline directives are ignored for this pass, so the
       * absolute rule has no escape hatch.
       */
      noInlineConfig: true
    },

    plugins: {
      '@typescript-eslint': tseslint.plugin
    },

    languageOptions: {
      parser: tseslint.parser,

      /*
       * No `projectService`. Neither rule is type-aware, so this pass runs
       * without type information and therefore cannot be weakened by an
       * unbuilt or stale `lib/`.
       */
      parserOptions: {
        tsconfigRootDir: __dirname
      }
    },

    rules: absoluteBanRules
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
