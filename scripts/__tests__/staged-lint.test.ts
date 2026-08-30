import { describe, expect, it } from 'vitest';
import { stagedTouchedLines, stagedLintableFiles, stagedLintMessages } from '../staged-lint.mjs';

describe('staged lint filtering', () => {
  it('ignores a pre-existing violation outside a clean staged hunk', () => {
    const touched = stagedTouchedLines([
      '@@ -20,1 +20,1 @@',
      '-const label = oldLabel;',
      '+const label = newLabel;'
    ].join('\n'));
    expect(stagedLintMessages([
      { line: 4, severity: 2, ruleId: 'no-unused-vars' },
      { line: 20, severity: 2, ruleId: 'no-unused-vars' }
    ], touched)).toEqual([{ line: 20, severity: 2, ruleId: 'no-unused-vars' }]);
  });

  it('keeps a new violation on a staged added line and global parser/config diagnostics', () => {
    const touched = stagedTouchedLines([
      '@@ -2,0 +3,2 @@',
      '+const unused = 1;',
      '+render(unused);'
    ].join('\n'));
    expect(stagedLintMessages([
      { line: 3, severity: 2, ruleId: 'no-unused-vars' },
      { line: 0, severity: 2, ruleId: null }
    ], touched)).toEqual([
      { line: 3, severity: 2, ruleId: 'no-unused-vars' },
      { line: 0, severity: 2, ruleId: null }
    ]);
  });

  it('keeps fatal diagnostics and never lets warnings become blocking', () => {
    const touched = stagedTouchedLines('@@ -8,1 +8,1 @@\n-const old = 1;\n+const next = 1;');
    expect(stagedLintMessages([
      { line: 2, severity: 1, ruleId: 'warn-rule' },
      { line: 8, severity: 1, ruleId: 'warn-rule' },
      { line: 2, severity: 2, fatal: true, ruleId: null },
      { line: 8, severity: 2, ruleId: 'error-rule' }
    ], touched)).toEqual([
      { line: 2, severity: 2, fatal: true, ruleId: null },
      { line: 8, severity: 2, ruleId: 'error-rule' }
    ]);
  });

  it('keeps violations at either retained boundary of a deletion-only hunk', () => {
    const touched = stagedTouchedLines('@@ -8,1 +8,0 @@\n-removed();');
    expect(touched).toEqual(new Set([7, 8]));
    expect(stagedLintMessages([
      { line: 7, severity: 2, ruleId: '@stylistic/padded-blocks' },
      { line: 8, severity: 2, ruleId: '@stylistic/no-multiple-empty-lines' },
      { line: 9, severity: 2, ruleId: '@stylistic/no-multiple-empty-lines' }
    ], touched)).toEqual([
      { line: 7, severity: 2, ruleId: '@stylistic/padded-blocks' },
      { line: 8, severity: 2, ruleId: '@stylistic/no-multiple-empty-lines' }
    ]);
  });

  it('selects only staged executable files from the ESLint policy surface', () => {
    expect(stagedLintableFiles([
      'packages/core/src/node.ts',
      'packages/core/test/node.test.ts',
      'packages/core/lib/node.js',
      'scripts/precommit-changed-checks.mjs',
      'eslint.config.mjs',
      'vitest.d.ts',
      'test/setup.ts',
      'package.json',
      'pnpm-lock.yaml',
      'docs/example.ts',
      'packages/core/dist/node.js'
    ])).toEqual([
      'packages/core/src/node.ts',
      'packages/core/test/node.test.ts',
      'scripts/precommit-changed-checks.mjs',
      'eslint.config.mjs',
      'vitest.d.ts',
      'test/setup.ts'
    ]);
  });
});
