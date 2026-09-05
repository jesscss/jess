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
import { serialize as serializeMaybeAsync, type SerializeResult } from '../../../../core/src/ast/serialize.js';

/*
 * These fixtures are all-sync, so `serialize` never lifts onto its async branch;
 * asserting that lets a case read `.css` directly and fails loudly rather than
 * comparing against a pending Promise.
 */
function serialize(...args: Parameters<typeof serializeMaybeAsync>): SerializeResult {
  const result = serializeMaybeAsync(...args);
  if (result instanceof Promise) {
    throw new TypeError('This SCSS test expects a synchronous serialize result.');
  }
  return result;
}

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
          args: [{ value: { type: 'Keyword', src: '--x' } }, { value: { type: 'Keyword', src: 'e' } }]
        }
      }]
    });
  });

  it('keeps the whole property name on a star-hack declaration', () => {
    /*
     * `*color: red` reaches the AST with `name: "*color"` — the leading `*` is
     * an IE hack that is part of the property name, and Less produces exactly
     * that (G31 / pinned-defect D16). SCSS formerly produced `name: "*"` with
     * `color` silently discarded; `token(...)` around the starred property arm
     * now collapses `*color` into one property-name token.
     */
    expect(firstRule('a{*color:red}')).toMatchObject({
      rules: [{ type: 'Declaration', name: '*color', value: { type: 'Keyword', src: 'red' } }]
    });
  });

  it('keeps the whole property name on other star-hack properties', () => {
    expect(firstRule('a{*width:1px}')).toMatchObject({
      rules: [{ type: 'Declaration', name: '*width', value: { type: 'Dimension' } }]
    });
  });

  it('leaves an ordinary property name unstarred', () => {
    expect(firstRule('a{color:red}')).toMatchObject({
      rules: [{ type: 'Declaration', name: 'color', value: { type: 'Keyword', src: 'red' } }]
    });
  });

  it('keeps a custom property name intact', () => {
    expect(firstRule('a{--x:red}')).toMatchObject({
      rules: [{ type: 'Declaration', name: '--x' }]
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

  it('accepts a leading functional media-query term as general-enclosed', () => {
    /*
     * `@media foo(bar)` is the `<general-enclosed>` function form
     * (media-queries-5 §2.1/§3.1: `<function-token> <any-value> )`); css, less
     * and jess render it `@media foo(bar)`. SCSS used to read the leading
     * `foo` as a media-type keyword and `(bar)` as a separate feature, emitting
     * `foo (bar)` with a stray space — a "valid CSS, valid in every dialect"
     * byte-identity divergence. It now reuses the SAME `QueryFunction`
     * general-enclosed node the shared query grammar already carries.
     */
    const sheet = parse('@media foo(bar) { a { b: c } }');
    const media = sheet.rules[0];
    const prelude = media?.type === 'AtRuleBlock' ? media.prelude : null;

    expect(prelude).toMatchObject({
      type: 'FunctionCall',
      name: 'foo',
      args: [
        { spread: false, value: { type: 'Any', src: 'bar' } }
      ]
    });

    /*
     * The emitted bytes, not just the tree: `foo(bar)` with no stray space,
     * byte-identical to what css/less/jess render for the same source.
     */
    expect(serialize(sheet).css).toBe('@media foo(bar) {\n  a {\n    b: c;\n  }\n}\n');

    // The general-enclosed payload is an opaque any-value, not a typed arg list.
    expect(() => parse('@media foo(a b !weird$) { a { b: c } }')).not.toThrow();

    // A bare `( … )` group still falls through to the feature/condition arms.
    expect(() => parse('@media (min-width: 10px) { a { b: c } }')).not.toThrow();
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

  it('reports CST truncation through both ok and unconsumedFrom', () => {
    /*
     * `ok: true` with `errors: []` and a non-null `unconsumedFrom` is the
     * silent-truncation trap: branching on `ok` alone accepts a half-read
     * document.
     */
    for (const source of ['.a { color: red; }\n!broken', '\n  !broken', '/* c */ !!!']) {
      const result = parseScssCst(source);

      expect(result.ok, source).toBe(false);
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

  it('admits a keyword argument in a function call', () => {
    /*
     * `$name:` in a call is core Sass syntax and involves no namespace, so it
     * was never gated behind the module system above — it was simply missing.
     * It is the SAME construct `@include m($x: 1)` already spelled, so it is
     * the same node: one `CallArg` carrying the authored keyword, which the
     * callee's own parameter names bind.
     */
    const ast = parse('a { b: f($x: 1) }');
    const rule = ast.rules[0];
    const value = rule?.type === 'Ruleset' && rule.rules[0]?.type === 'Declaration'
      ? rule.rules[0].value
      : null;

    expect(value).toMatchObject({
      type: 'FunctionCall',
      name: 'f',
      args: [{ name: 'x', spread: false, value: { type: 'Dimension' } }]
    });
  });

  it('PINNED DEFECT — rejects a Sass call argument form (spread argument)', () => {
    expect(() => parse('a { b: f($x...) }')).toThrow();
  });

  it('admits a bare variable as an @if condition', () => {
    /*
     * `@if $a` is truthiness on the value, valid Sass. The grammar hold on the
     * bare condition lifted with the SEMANTICS (§4.4.2, phase 5) and never
     * before them — widening the grammar alone would not have failed, it would
     * have silently taken the wrong branch. The bare operand lowers to
     * `not(($a == false) or ($a == null))`, which is Sass's rule written in
     * plain `.jess`.
     */
    expect(() => parse('@if $a { a { b: c } }')).not.toThrow();
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
  ])('accepts an interpolated structured pseudo argument (%s)', (_label, source) => {
    /*
     * FLIPPED. These were pinned rejecting because core's serializer DROPPED
     * the interpolated member: `pseudoCanonical` is the static join over
     * `PseudoSelector.args`, an interp-only member has `text: null`, and the
     * argument serialized away (`.card:not(a#{$x})` → `.card:not(a)`). The
     * grammar was narrowed rather than let one more spelling reach a dropping
     * serializer. Core now resolves pseudo arguments per frame, so the
     * narrowing is gone and interpolation POSITIONS are dialect invariant
     * again. Emitted-CSS gate:
     * `packages/jess/test/scss/interpolated-pseudo-argument.test.ts`.
     */
    expect(() => parse(source)).not.toThrow();
  });

  /*
   * A module path is a plain `QuotedString` — the SAME terminal `@import`
   * takes (`UseRule ::= '@use' QuotedString …`, sass `spec/at-rules/use.md`;
   * `ImportUrl ::= QuotedString | InterpolatedUrl`, `spec/at-rules/import.md`)
   * — i.e. a CSS `<string-token>`, in which `\` always starts an escape
   * (CSS Syntax 3 §4.3.1). `@use`/`@forward` used to run through a private
   * escape-free copy of the quoted production, so a backslash parsed in every
   * other SCSS string and failed here. There is now ONE `Quoted` rule and
   * every quoted-string site references it by name; these cases are what that
   * buys, so they must stay tied together.
   */
  it.each([
    ['@use, double quotes', '@use "a\\62 c";'],
    ['@use, single quotes', '@use \'a\\62 c\';'],
    ['@forward', '@forward "a\\62 c";'],
    ['@import', '@import "a\\62 c";'],
    ['a value', '$x: "a\\62 c";'],
    ['a keyframe name', '@keyframes "a\\62 c" { from { color: red } }']
  ])('accepts a backslash escape in a quoted string (%s)', (_label, source) => {
    expect(() => parse(source)).not.toThrow();
  });

  it('preserves an escape in a module path verbatim, as in any other string', () => {
    expect(firstRule('@use "a\\62 c";')).toMatchObject({
      target: { type: 'Quoted', value: 'a\\62 c', quote: '"' }
    });
    expect(firstRule('$x: "a\\62 c";')).toMatchObject({
      value: { type: 'Quoted', value: 'a\\62 c', quote: '"' }
    });
  });

  it.each([
    ['a protocol-relative path is not a line comment', '@use "//host/lib";', '//host/lib'],
    ['a bare `#` is not an interpolation opener', '@use "a#b";', 'a#b']
  ])('keeps module-path lexing intact (%s)', (_label, source, value) => {
    expect(firstRule(source)).toMatchObject({ target: { type: 'Quoted', value } });
  });

  it.each([
    ['@use', '@use "#{$x}";'],
    ['@forward', '@forward "#{$x}";']
  ])('rejects an interpolated module path (%s)', (_label, source) => {
    /*
     * Still rejected, but now as a SEMANTIC failure from the reducer rather
     * than a lexical one: the spec's terminal is `QuotedString`, not an
     * interpolated string, so the grammar recognizes the shape (it must, or an
     * escape-bearing path cannot be reached at all) and the reducer refuses a
     * non-static path. dart-sass reports the same thing as "Expected string.".
     */
    expect(() => parse(source)).toThrow(/requires a quoted module path/);
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

  /*
   * `scssOwnAtKeyword` (grammar.ts) is the hand-maintained list of SCSS-only
   * at-rule names that `ScssGenericAtRuleName` subtracts from the opaque
   * fallback. Its CSS half cannot drift — it inverts cssSyntax's own
   * `TypedAtKeywordSharedRoutes`/`ConditionalAtKeyword`/`ImportAtKeyword`
   * leaves — but this SCSS-only half is a second copy of "which names have a
   * typed route", and NOTHING checks it against the routes.
   *
   * It has drifted. Nine of its twenty-four names have no production anywhere
   * in the grammar, so the exclusion removes their only remaining route: they
   * are neither typed nor opaque, and `@while`/`@debug`/`@warn`/
   * `@error` are ordinary Sass that this parser now rejects outright. (`@content`
   * was the tenth; it now routes to `ContentRule`, which lowers it to the
   * documented built-in `$content()`.) That is
   * the failure mode `descriptorAtKeywordCssOnly` was split out to prevent
   * (recognition.ts: "excluding a name it cannot otherwise parse makes that
   * at-rule unparseable rather than better-diagnosed") — the same bug, on the
   * list that split never covered.
   *
   * These two cases are the missing check, not a fix. Opaque capture is NOT
   * the fix for the remaining names: an evaluated directive emitted verbatim
   * would put the directive in the CSS output, which grammar.ts calls out as
   * the reason these names are excluded at all. They need productions. The
   * `@-…` compiler namespace is the same story — jess-parser routes all five,
   * scss-parser routes none.
   *
   * `@while`, `@debug`, `@warn` and `@error` have since been routed and moved
   * to the list above. `@while` builds the canonical `While`; the three
   * diagnostics build NOTHING — they own no AST kind, so their production
   * reduces to null and the statement collector drops it.
   */
  it.each([
    ['@use', '@use "x";'],
    ['@forward', '@forward "x";'],
    ['@mixin', '@mixin m { a: b; }'],
    ['@include', '.x { @include m; }'],
    ['@function/@return', '@function f() { @return 1; }'],
    ['@if', '@if $a == 1 { a: b; }'],
    ['@else', '@if $a == 1 { a: b; } @else { c: d; }'],
    ['@each', '@each $i in 1, 2 { a: b; }'],
    ['@for', '@for $i from 1 through 2 { a: b; }'],
    ['@extend', '.x { @extend .y; }'],
    ['@at-root', '.x { @at-root { a: b; } }'],
    ['@charset', '@charset "UTF-8";'],
    ['@namespace', '@namespace svg url(http://www.w3.org/2000/svg);'],
    ['@content', '@content;'],
    ['@content with args', '@content(1);'],
    ['@while', '@while $i > 0 { a: b; }'],
    ['@debug', '@debug 1;'],
    ['@warn', '@warn 1;'],
    ['@error', '@error 1;']
  ])('routes the excluded SCSS at-keyword %s to a typed production', (_label, source) => {
    expect(() => parse(source)).not.toThrow();
  });

  it.each([
    ['@-use', '@-use "x";'],
    ['@-compose', '@-compose "x";'],
    ['@-export', '@-export "x";'],
    ['@-import', '@-import "x";'],
    ['@-from', '@-from "x";']
  ])(
    'PINNED DEFECT — %s is excluded from the opaque branch but has no production',
    (_label, source) => {
      /*
       * `Unexpected SCSS syntax.` is the signature of falling off the end of
       * the statement choice with no arm having claimed the at-keyword. A name
       * that reaches a real production fails differently (`@at-root .y {`
       * reports `Expected: "(", "{"`), so this message — not merely "it
       * throws" — is what distinguishes an unrouted name from a diagnosed one.
       */
      expect(() => parse(source)).toThrow(/Unexpected SCSS syntax/);
    }
  );
});
