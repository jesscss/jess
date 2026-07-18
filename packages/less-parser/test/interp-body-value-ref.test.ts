/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- test inspects parser tree internals structurally. */
import { Parser } from '../src/jess.js';

/**
 * §4.1 amendment (owner-approved 2026-07-18): the Less `@{…}` interpolation BODY
 * is widened from a single variable ident to a READ-ONLY value REFERENCE — a
 * name/var head followed by zero or more `[key]` accessors (`@{theme[variant]}`,
 * `@{map[@key]}`). The `@{`…`}` delimiters are owner-LOCKED and unchanged, and a
 * `.`-call inside the body stays INVALID (read-only).
 *
 * This suite gates the PARSER STRUCTURING: every `@{…}` position (value, selector,
 * string, custom-prop name, at-rule prelude) parses the widened body via ONE shared
 * seam, `@{name}` stays valid (byte-identical degenerate case), and the `.`-call is
 * rejected. Note: end-to-end RESOLUTION of `@{head[key]}` is deferred — see the
 * `TODO(§4.1/interp-body-accessor-resolution)` note in src/grammar.ts.
 */
describe('§4.1 — Less @{} interpolation body widened to a read-only value reference', () => {
  const parser = new Parser();
  const parse = parser.parse;
  const errsOf = (src: string): string[] => parse(src, 'Stylesheet').errors.map((e: { message: string }) => e.message);

  describe('the widened body parses at every @{} site', () => {
    const cases: Array<[string, string]> = [
      ['value — bare name (degenerate)', '.a { color: @{name}; }'],
      ['value — head[key]', '.a { color: @{theme[variant]}; }'],
      ['value — head[@varKey]', '.a { color: @{map[@key]}; }'],
      ['selector', '.@{m[p]} { x: 1; }'],
      ['quoted string', '.a { c: "@{m[p]}"; }'],
      ['custom-property name', '.a { --@{m[p]}: 1; }'],
      ['at-rule prelude', '@media @{m[p]} { .a { x: 1; } }']
    ];
    for (const [label, src] of cases) {
      it(label, () => {
        expect(errsOf(src)).toEqual([]);
      });
    }
  });

  describe('a `.`-call inside the body stays INVALID (read-only)', () => {
    it('rejects @{head.call()} in value position', () => {
      expect(errsOf('.a { color: @{m.call()}; }').length).toBeGreaterThan(0);
    });
    it('rejects @{head.call()} in selector position', () => {
      expect(errsOf('.@{m.call()} { x: 1; }').length).toBeGreaterThan(0);
    });
  });

  describe('the bare @{name} case stays byte-identical (one flat interpolation ref)', () => {
    it('value-position @{name} builds a single-replacement Interpolated', () => {
      const { tree, errors } = parse('.a { color: @{name}; }', 'Stylesheet') as {
        tree: { rules: Array<{ rules: Array<{ value: { value?: unknown } }> }> };
        errors: unknown[];
      };
      expect(errors).toEqual([]);
      const v = tree.rules[0]!.rules[0]!.value;
      const node = ((v as { value?: unknown }).value ?? v) as { type: string; source: unknown; replacements: unknown[] };
      expect(node.type).toBe('Interpolated');
      expect(String(node.source)).toBe('%%');
      expect(node.replacements).toHaveLength(1);
    });
  });
});
