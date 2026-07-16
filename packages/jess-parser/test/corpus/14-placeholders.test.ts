/**
 * Corpus 14 — Placeholder selectors.
 *
 * Jess placeholders use an escaped-backslash sigil `\\name` (a literal `\` in the
 * selector — `%` is taken by modulo/percent in Jess expressions). This is also the
 * form the SCSS parser lowers `%name` to, so `.scss` and `.jess` converge on one
 * representation. Parsing rides on the generic CSS-escape handling in `basicSel`;
 * private placeholders are just a leading `_` (`\\_name`).
 *
 * A ruleset whose selector(s) are ALL placeholders carries `isPlaceholder = true`
 * (marked at parse) — it emits no output of its own and is realized only via
 * extend. The output-suppression itself is a core-eval TODO; this corpus pins the
 * PARSE, the flag, and the round-trip with EXACT assertions.
 */
import { describe, it, expect } from 'vitest';
import { parse } from './_util.js';

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
const firstRule = (src: string) => (parse(src).tree as unknown as { rules: Array<Record<string, unknown>> }).rules[0]!;

describe('corpus/placeholders', () => {
  it('a `\\\\name` placeholder ruleset: selector + isPlaceholder flag', () => {
    const rs = firstRule('\\\\foo { color: red; }');
    expect(rs.type).toBe('Ruleset');
    expect(rs.selector).toBe('\\\\foo'); // two backslashes, exactly
    expect(rs.isPlaceholder).toBe(true);
  });

  it('a private `\\\\_name` placeholder is flagged too', () => {
    const rs = firstRule('\\\\_priv { x: 1 }');
    expect(rs.selector).toBe('\\\\_priv');
    expect(rs.isPlaceholder).toBe(true);
  });

  it('a normal selector is NOT a placeholder', () => {
    expect(firstRule('.a { color: red; }').isPlaceholder).toBe(false);
  });

  it('a mixed list `\\\\foo, .bar` is NOT a whole-ruleset placeholder', () => {
    expect(firstRule('\\\\foo, .bar { x: 1 }').isPlaceholder).toBe(false);
  });

  it('an all-placeholder list `\\\\a, \\\\b` IS a placeholder', () => {
    expect(firstRule('\\\\a, \\\\b { x: 1 }').isPlaceholder).toBe(true);
  });

  it('placeholder ruleset round-trips exactly', () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const rs = firstRule('\\\\foo { color: red; }') as { toTrimmedString(o: unknown): string };
    expect(rs.toTrimmedString({ compress: false })).toBe('\\\\foo {\n  color: red;\n}\n');
  });

  it('`$extend \\\\name` builds an Extend targeting the placeholder exactly', () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const outer = firstRule('.a { $extend \\\\foo; }') as { type: string; rules: Array<{ type?: string; target?: { value?: string } }> };
    expect(outer.type).toBe('Ruleset');
    const ext = outer.rules[0]!;
    expect(ext.type).toBe('Extend');
    expect(ext.target?.value).toBe('\\\\foo');
  });
});
