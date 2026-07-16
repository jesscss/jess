/**
 * Corpus 14 — Placeholder selectors.
 *
 * Jess placeholders use an escaped-backslash sigil `\\name` (a literal `\` in the
 * selector — `%` is taken by modulo/percent in Jess expressions). This is also the
 * form the SCSS parser lowers `%name` to, so `.scss` and `.jess` converge on one
 * representation. Parsing rides on the generic CSS-escape handling in `basicSel`;
 * private placeholders are just a leading `_` (`\\_name`).
 *
 * NOTE: output-suppression / extend-only semantics live in core eval (an open
 * @todo in tree/selector.ts) — this corpus only pins the PARSE + round-trip.
 */
import { describe, it, expect } from 'vitest';
import { expectAstContains, expectRoundTrip, parse } from './_util.js';

describe('corpus/placeholders', () => {
  it('a `\\\\name` placeholder parses as a Ruleset selector', () => {
    // Source `\\foo { … }` → Ruleset whose selector is the escaped `\\foo`.
    expectAstContains('\\\\foo { color: red; }', '\\\\foo');
  });

  it('a private `\\\\_name` placeholder parses', () => {
    expectAstContains('\\\\_priv { x: 1 }', '\\\\_priv');
  });

  it('placeholder ruleset round-trips', () => {
    expectRoundTrip('\\\\foo { color: red; }', '\\\\foo');
  });

  it('`$extend \\\\name` builds an Extend targeting the placeholder', () => {
    const { tree } = parse('.a { $extend \\\\foo; }');
    // .a { … } → the inner statement is an Extend whose target carries `\\foo`.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const outer = (tree as unknown as { rules: Array<{ type?: string; rules?: unknown[] }> }).rules[0];
    expect(outer?.type).toBe('Ruleset');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const inner = outer?.rules?.[0] as { type?: string; target?: { value?: string } };
    expect(inner.type).toBe('Extend');
    expect(String(inner.target?.value ?? '')).toContain('\\\\foo');
  });
});
