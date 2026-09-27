import { describe, expect, it } from 'vitest';
import { parse } from '../src/index.js';
import { ESCAPED_AT_KEYWORDS, atRuleName } from '../../../../../test/escaped-at-keywords.js';

/*
 * The shared cases and why they read this way: `test/escaped-at-keywords.ts`.
 *
 * KNOWN DEFECT, pinned with `it.fails`: the Less grammar's own at-rule words
 * still end at the boundary without the backslash, so Less reads most of these
 * as the typed at-rule followed by `\61` (`@counter-style` with prelude
 * `\61 x`) and rejects the rest. The fix belongs in `less-parser/src/grammar.ts`.
 * Less also keeps escapes out of its at-rule NAME on purpose
 * (`AtIdentifierUnescaped` in parser-shared), so whether the right Less answer
 * is the escaped name or a parse error is an open decision; either way it must
 * never be the typed at-rule. When Less reads a case as the other dialects do,
 * its `it.fails` goes red: move it to a plain `it`.
 */
describe('escaped at-keywords', () => {
  it.fails.each(ESCAPED_AT_KEYWORDS)('reads %s as the whole escaped identifier', (source, name) => {
    expect(atRuleName(parse(source))).toBe(name);
  });
});
