/*
 * Constructs discovered OUTSIDE the parser suites — by one-off probes, corpus
 * sweeps, sass-spec triage and oracle diffs — and backfilled here.
 *
 * Standing rule (DESIGN-DECISIONS.md, G22): every language construct we find
 * that the parser suites did not already catch gets a fixture in the parser
 * suites, in the same change that discovers it. The parser suites are the only
 * instrument that runs on every commit; a construct fixed without a fixture is
 * a defect with nothing watching it.
 *
 * PINNED DEFECT
 * -------------
 * Cases whose title starts with `PINNED DEFECT` assert the CURRENT, WRONG
 * behaviour. They are pins, not endorsements: a pinned wrong answer that
 * changes loudly beats a gap that changes silently. When the underlying defect
 * is fixed, the pin fails — flip the assertion to the correct behaviour and
 * drop the marker. Grep `PINNED DEFECT` across `packages/syntax` for the set.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@jesscss/scss-parser';
import { parseScssCst } from '@jesscss/scss-parser/cst';

/*
 * Narrowed by predicate rather than by assertion: the dialect error class is
 * bundled per entry point, so `instanceof` against the imported class is not
 * reliable, and an `as` cast would hide a non-parse throw — the reducer
 * TypeError pinned at the bottom of this file is exactly that case.
 */
function isLocatedFailure(value: unknown): value is Error & { offset: number } {
  return value instanceof Error && 'offset' in value && typeof value.offset === 'number';
}

function failureOf(source: string): Error & { offset: number } {
  try {
    parse(source);
  } catch (error) {
    if (isLocatedFailure(error)) {
      return error;
    }
    throw error;
  }
  throw new Error(`Expected ${JSON.stringify(source)} to fail to parse.`);
}

function firstRule(source: string): unknown {
  return parse(source).rules[0];
}

describe('SCSS constructs discovered outside the parser suites', () => {
  it('accepts a parenthesised component value with no interior whitespace', () => {
    expect(firstRule('a { b: (c) }')).toMatchObject({
      rules: [{ type: 'Declaration', name: 'b', value: { type: 'Block', delimiter: 'paren' } }]
    });
  });

  it.each([
    ['both sides', 'a { b: ( c ) }'],
    ['leading only', 'a { b: ( c) }'],
    ['trailing only', 'a { b: (c ) }']
  ])('accepts whitespace inside a paren component value (%s)', (_label, source) => {
    /*
     * `Paren` now spells its own interior padding. It has to: the value ladder
     * runs with trivia cleared, so an interior that admits authored padding
     * has to write it — and it has to write the comment-bearing `valueTrivia`,
     * because the SCSS document trivia table names whitespace and `//` only, so
     * a block comment is never ambient inside a value. Both columns below.
     */
    expect(() => parse(source)).not.toThrow();
  });

  it.each([
    ['both sides', 'a { b: (/* c */ c /* c */) }'],
    ['leading only', 'a { b: (/* c */ c) }'],
    ['trailing only', 'a { b: (c /* c */) }'],
    ['a comment holding the closer', 'a { b: (/* ) */ c) }']
  ])('accepts a comment inside a paren component value (%s)', (_label, source) => {
    expect(() => parse(source), source).not.toThrow();
  });

  it('drops a comment out of var() arguments rather than emitting its bytes', () => {
    expect(firstRule('a { b: var(--x, /* c */ e) }')).toMatchObject({
      rules: [{
        value: {
          type: 'FunctionCall',
          name: 'var',
          args: [{ type: 'Keyword', src: '--x' }, { type: 'Keyword', src: 'e' }]
        }
      }]
    });
  });

  it('PINNED DEFECT — drops the property name off a star-hack declaration', () => {
    /*
     * `*color: red` must reach the AST with `name: "*color"` — the leading
     * `*` is an IE hack that is part of the property name, and Less produces
     * exactly that. SCSS instead produces `name: "*"` with `red` as the
     * value, silently discarding `color`. This is data loss, not a rejection,
     * which is why it went unnoticed: the parse "succeeds".
     */
    expect(firstRule('a{*color:red}')).toMatchObject({
      rules: [{ type: 'Declaration', name: '*', value: { type: 'Keyword', src: 'red' } }]
    });
  });

  it.each([
    ['spaced modifier', 'a[href="x" i]{c:d}'],
    ['spaced s modifier', 'a[href="x" s]{c:d}'],
    ['tight modifier', 'a[href="x"i]{c:d}'],
    ['fully spaced attribute', 'a[ href = "x" i ]{c:d}']
  ])('accepts the attribute case-sensitivity modifier (%s)', (_label, source) => {
    expect(() => parse(source)).not.toThrow();
  });

  it('splits a compound selector on whitespace', () => {
    expect(firstRule('a .b{c:d}')).toMatchObject({
      selector: { selectors: [{ type: 'ComplexSelector', value: [{ text: 'a' }, ' ', { text: '.b' }] }] }
    });
  });

  it('PINNED DEFECT — rejects a comment inside a compound selector', () => {
    /*
     * A comment is not a descendant combinator and must not split a compound
     * selector: `a/*c*` + `/.b` is the single compound `a.b`. CSS, Less and
     * Jess all parse it that way; SCSS rejects the whole stylesheet.
     */
    expect(() => parse('a/*c*/.b{c:d}')).toThrow();
  });

  it('accepts a leading combinator in a relative selector', () => {
    expect(() => parse('a:has(> .b){c:d}')).not.toThrow();
  });

  it('accepts an A+B microsyntax with no spaces around the sign', () => {
    expect(() => parse('a:nth-child(2n+1){c:d}')).not.toThrow();
  });

  it.each([
    ['@layer', '@layeré{}'],
    ['@document', '@documenté{}'],
    ['@keyframes', '@keyframesé{}']
  ])('reads a full ident for a known at-rule name rather than a known-name prefix (%s)', (_label, source) => {
    expect(() => parse(source)).not.toThrow();
  });

  it('PINNED DEFECT — rejects an unbalanced bracket inside a custom property', () => {
    expect(() => parse('a{--x: foo(] bar}')).toThrow();
  });

  it('PINNED DEFECT — claims a complete stylesheet when only a comment preceded the garbage', () => {
    /*
     * `"\n  !broken"` — leading *whitespace* then garbage — correctly reports
     * "Unexpected SCSS syntax" (pinned in leftover-input-errors.test.ts). The
     * *comment* form is the same case: no rule was parsed, so there is no
     * stylesheet to be "after". CSS, Less and Jess all say "syntax"; SCSS
     * alone says "after a complete stylesheet", which sends the author
     * looking for a stray `}` that does not exist.
     */
    const failure = failureOf('/* c */ !!!');

    expect(failure.offset).toBe(8);
    expect(failure.message).toBe('Unexpected SCSS input after a complete stylesheet.');
  });

  it('reports CST truncation through unconsumedFrom, never through ok', () => {
    /*
     * `ok: true` with `errors: []` and a non-null `unconsumedFrom` is the
     * silent-truncation trap: branching on `ok` alone accepts a half-read
     * document.
     */
    for (const source of ['.a { color: red; }\n!broken', '\n  !broken', '/* c */ !!!']) {
      const result = parseScssCst(source);

      expect(result.ok, source).toBe(true);
      expect(result.errors, source).toHaveLength(0);
      expect(result.unconsumedFrom, source).not.toBeNull();
    }

    const clean = parseScssCst('.a{color:red}');

    expect(clean.ok).toBe(true);
    expect(clean.unconsumedFrom).toBeNull();
  });

  it.each([
    ['namespaced function call', 'a { b: ns.fn() }'],
    ['namespaced variable read', 'a { b: ns.$var }'],
    ['namespaced map read', 'a { b: map.get($m, k) }'],
    ['namespaced colour helper', 'a { b: color.mix(red, blue) }']
  ])('accepts Sass module-system member access (%s)', (_label, source) => {
    /*
     * `map.get(...)` is the modern spelling of `map-get(...)` under
     * `@use "sass:map"`, and the hyphenated legacy form was already covered
     * (ast-grammar.test.ts, "lowers SCSS map-get to the shared $[…] accessor
     * read") while the dotted namespaced form had no grammar at all — the
     * suites only ever exercised the legacy spelling, which is exactly how
     * this got missed. Both spellings are now admitted; the resulting trees
     * are asserted in ast-grammar.test.ts ("keeps the authored callee path of
     * a @use-namespaced function call" and "lowers a @use-namespaced variable
     * read to the shared $[…] accessor"), so this case guards recognition
     * only.
     */
    expect(() => parse(source)).not.toThrow();
  });

  it('PINNED DEFECT — rejects a namespaced variable assignment', () => {
    expect(() => parse('ns.$v: value;')).toThrow();
  });

  it.each([
    ['named argument', 'a { b: f($x: 1) }'],
    ['spread argument', 'a { b: f($x...) }']
  ])('PINNED DEFECT — rejects a Sass call argument form (%s)', (_label, source) => {
    /*
     * Named and rest arguments are core Sass call syntax and involve no
     * namespace, so they are not gated behind the module system above.
     */
    expect(() => parse(source)).toThrow();
  });

  it('PINNED DEFECT — rejects a bare variable as an @if condition', () => {
    /*
     * `@if $a` is truthiness on the value, valid Sass. The condition grammar
     * currently demands a comparison operator or a literal boolean — the
     * error even lists them.
     */
    const failure = failureOf('@if $a { a { b: c } }');

    expect(failure.message).toContain('Expected:');
  });

  it.each([
    ['@at-root prelude', '@at-root /**/ {}'],
    ['@for bound', '@for $i from /**/ 1 through 10 {}'],
    ['@forward configuration', '@forward "o" with ($a: /**/ b)']
  ])('PINNED DEFECT — does not admit a comment as trivia (%s)', (_label, source) => {
    /*
     * A comment is trivia everywhere or it is trivia nowhere. These three
     * at-rule preludes each have a position where the trivia rule is not
     * applied, so an authored comment turns a valid stylesheet into a parse
     * error.
     */
    expect(() => parse(source)).toThrow();
  });

  it.each([
    ['flat bracket list', 'a { b: [1, 2] }'],
    ['single nested bracket list', 'a { b: [[1, 2]] }'],
    /*
     * A SPACE separator inside the brackets makes the interior slot an array,
     * which the reducer used to narrow to a single node — throwing a bare
     * `TypeError` past the dialect error type every caller catches. Discovered
     * via `meta.inspect([[1, 2] [3, 4]])` in sass-spec; `[c d]` is the minimal
     * repro, and it had nothing to do with `meta.inspect` or with nesting.
     */
    ['space-separated members', 'a { b: [c d] }'],
    ['two adjacent nested lists', 'a { b: [[1, 2] [3, 4]] }']
  ])('lowers a bracketed list to a Block (%s)', (_label, source) => {
    expect(firstRule(source)).toMatchObject({
      rules: [{ type: 'Declaration', name: 'b', value: { type: 'Block' } }]
    });
  });

  it('PINNED DEFECT — rejects a comment before a value-list comma', () => {
    /*
     * `c /* z *` + `/, d` is the two-item list `c, d`; the comment is trivia.
     * CSS, Less and Jess all parse it. Same root cause as the at-rule-prelude
     * pins above: trivia is not applied at every position it belongs.
     */
    expect(() => parse('a { b: c /* z */, d }')).toThrow();
  });

  it.each([
    ['leading class', '.#{$x} .b { c: d }'],
    ['element prefix', 'a#{$x} { c: d }']
  ])('accepts interpolation attached to a selector (%s)', (_label, source) => {
    expect(() => parse(source)).not.toThrow();
  });

  it.each([
    ['whole compound', '#{$x} { c: d }'],
    ['interpolation then combinator', '#{$x} .b { c: d }'],
    ['interpolation then suffix', '#{$x}-y { c: d }'],
    ['two interpolated terms', '#{$a} #{$b} { c: d }'],
    ['interpolation then child combinator', '#{$a} > .b { c: d }'],
    ['interpolation then pseudo', '#{$selector}:first-child { c: d }'],
    ['quoted interpolation body', '#{\'.foo\'} { c: d }'],
    ['call interpolation body', '#{data(\'bar\')} { c: d }'],
    ['not the first term of a list', '.a, #{$x} { c: d }'],
    ['nested', 'a { #{$x} { c: d } }']
  ])('accepts a selector that STARTS with interpolation (%s)', (_label, source) => {
    /*
     * The optional leading `.`/`#` sigil was claiming the `#` that OPENS the
     * interpolation, so `.#{$x}` and `a#{$x}` parsed while `#{$x}` did not.
     * Interpolation BODIES vary by dialect; interpolation POSITIONS do not.
     */
    expect(() => parse(source)).not.toThrow();
  });

  it.each([
    ['leading', '.card:not(#{$x}) { c: d }'],
    ['after a static prefix', '.card:not(a#{$x}) { c: d }'],
    ['after a comma', '.card:not(.a, #{$x}) { c: d }'],
    ['after a combinator', '.x:has(> #{$a}) { c: d }']
  ])('rejects an interpolated structured pseudo argument (%s)', (_label, source) => {
    /*
     * NOT a parse limitation — the tree is fully typed. `pseudoCanonical` is
     * the STATIC join over `PseudoSelector.args`, an interp-only member has
     * `text: null`, and the whole argument therefore SERIALIZES AWAY:
     * `.card:not(a#{$x})` parsed on dev and emitted `.card:not()`. Rejecting is
     * the honest answer until core resolves pseudo args per-frame; the
     * dropping serializer is the defect to fix, and then these flip.
     */
    expect(() => parse(source)).toThrow();
  });

  it('PINNED DEFECT — rejects a parent selector in value position', () => {
    /*
     * `#{&}` (the whole `spec/libsass/base-level-parent/` family) is blocked
     * by the interpolation BODY, not by its position: `a { b: & }` fails
     * identically, and `#{$x}` in the same selector slot now parses. `&` as a
     * VALUE has no node — Sass evaluates it to the parent selector — so this
     * needs a model decision, not a grammar arm.
     */
    expect(() => parse('a { b: & }')).toThrow();
    expect(() => parse('#{&} { c: d }')).toThrow();
  });
});
