import { describe, it, expect } from 'vitest';
import { ruleset, decl, any } from '../src/tree/index.js';

/**
 * `Ruleset.isPlaceholder` — a ruleset whose selector(s) are ALL `\\name`
 * placeholders (the escaped-backslash sigil scss `%` lowers to, and jess writes
 * directly) is flagged at construction. It emits no output of its own and is
 * realized only through extend. (Output-suppression itself is a core-eval TODO.)
 */
describe('Ruleset.isPlaceholder', () => {
  it('a single `\\\\name` selector flags the ruleset', () => {
    const rs = ruleset({ selector: '\\\\foo', rules: [decl({ name: 'color', value: any('red') })] });
    expect(rs.isPlaceholder).toBe(true);
  });

  it('a normal selector does not', () => {
    expect(ruleset({ selector: '.a', rules: [] }).isPlaceholder).toBe(false);
  });

  it('an all-placeholder selector list flags; a mixed list does not', () => {
    expect(ruleset({ selector: ['\\\\a', '\\\\b'], rules: [] }).isPlaceholder).toBe(true);
    expect(ruleset({ selector: ['\\\\a', '.b'], rules: [] }).isPlaceholder).toBe(false);
  });
});
