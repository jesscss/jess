import { describe, expect, it } from 'vitest';
import { stagedAddedLines, stagedLintMessages } from '../staged-lint.mjs';

describe('staged lint filtering', () => {
  it('ignores a pre-existing violation outside a clean staged hunk', () => {
    const added = stagedAddedLines([
      '@@ -20,1 +20,1 @@',
      '-const label = oldLabel;',
      '+const label = newLabel;'
    ].join('\n'));
    expect(stagedLintMessages([
      { line: 4, ruleId: 'no-unused-vars' },
      { line: 20, ruleId: 'no-unused-vars' }
    ], added)).toEqual([{ line: 20, ruleId: 'no-unused-vars' }]);
  });

  it('keeps a new violation on a staged added line and global parser/config diagnostics', () => {
    const added = stagedAddedLines([
      '@@ -2,0 +3,2 @@',
      '+const unused = 1;',
      '+render(unused);'
    ].join('\n'));
    expect(stagedLintMessages([
      { line: 3, ruleId: 'no-unused-vars' },
      { line: 0, ruleId: null }
    ], added)).toEqual([
      { line: 3, ruleId: 'no-unused-vars' },
      { line: 0, ruleId: null }
    ]);
  });
});
