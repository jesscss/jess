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
import { parse } from '@jesscss/less-parser';
import { parseLessCst } from '@jesscss/less-parser/cst';

/*
 * Narrowed by predicate rather than by assertion: the dialect error class is
 * bundled per entry point, so `instanceof` against the imported class is not
 * reliable, and an `as` cast would silently accept a non-parse throw.
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

describe('Less constructs discovered outside the parser suites', () => {
  it.each([
    ['tight', 'a { b: (c) }'],
    ['both sides', 'a { b: ( c ) }'],
    ['leading only', 'a { b: ( c) }'],
    ['trailing only', 'a { b: (c ) }']
  ])('admits whitespace inside a paren component value (%s)', (_label, source) => {
    /*
     * Less is the dialect that gets this right; CSS, SCSS and Jess reject the
     * spaced forms and pin that rejection in their own suites. Keeping the
     * correct side asserted here means a "fix" that regresses Less fails too.
     */
    expect(firstRule(source)).toMatchObject({
      rules: [{ type: 'Declaration', name: 'b', value: { type: 'Block', delimiter: 'paren', value: { type: 'Keyword', src: 'c' } } }]
    });
  });

  it('drops a comment out of var() arguments rather than emitting its bytes', () => {
    /*
     * The CSS parser leaks the comment bytes into the argument list as Any
     * nodes; that defect is pinned in the CSS suite. Less is correct.
     */
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

  it('keeps the whole star-hack property name on the declaration', () => {
    /*
     * `*color` is one property name to the parser (the leading `*` is an
     * IE hack, not a selector). SCSS currently produces `name: "*"` and drops
     * `color` outright; that is pinned in the SCSS suite.
     */
    expect(firstRule('a{*color:red}')).toMatchObject({
      rules: [{ type: 'Declaration', name: '*color', value: { src: 'red' } }]
    });
  });

  it.each([
    ['spaced modifier', 'a[href="x" i]{c:d}'],
    ['spaced s modifier', 'a[href="x" s]{c:d}'],
    ['tight modifier', 'a[href="x"i]{c:d}'],
    ['fully spaced attribute', 'a[ href = "x" i ]{c:d}'],
    ['spaced unquoted value', 'a[ href = x i ]{c:d}']
  ])('accepts the attribute case-sensitivity modifier (%s)', (_label, source) => {
    /*
     * selectors-4 §6.3 puts optional whitespace on both sides of the
     * attribute matcher and before the modifier, and the modifier needs no
     * separating whitespace at all. The last three were a PINNED DEFECT: Less
     * alone rejected them, which broke "valid CSS is valid in every dialect".
     * Whitespace inside `[` … `]` is now trivia in Less as it already was in
     * the CSS base.
     */
    expect(() => parse(source)).not.toThrow();
  });

  it('PINNED DEFECT — keeps the authored space before the attribute modifier', () => {
    /*
     * Cross-dialect divergence: CSS, SCSS and Jess all normalise to
     * `[href="x"i]`. Both spellings are pinned so unifying them fails loudly
     * on whichever side moves.
     */
    expect(firstRule('a[href="x" i]{c:d}')).toMatchObject({
      selector: { selectors: [{ value: [{ text: 'a' }, { text: '[href="x" i]' }] }] }
    });
  });

  it('splits a compound selector on whitespace but not on a comment', () => {
    expect(firstRule('a .b{c:d}')).toMatchObject({
      selector: { selectors: [{ type: 'ComplexSelector', value: [{ text: 'a' }, ' ', { text: '.b' }] }] }
    });
    expect(firstRule('a/*c*/.b{c:d}')).toMatchObject({
      selector: { selectors: [{ type: 'CompoundSelector', value: [{ text: 'a' }, { text: '.b' }] }] }
    });
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
    /*
     * `--x: foo(] bar` is the one custom-property shape none of the four
     * dialects parse; css-syntax-3 §5.4.8 makes the stray `]` a consumed
     * parse error, not a fatal one.
     */
    expect(() => parse('a{--x: foo(] bar}')).toThrow();
  });

  it('does not claim a complete stylesheet when only a comment preceded the garbage', () => {
    const failure = failureOf('/* c */ !!!');

    expect(failure.offset).toBe(8);
    expect(failure.message).toBe('Unexpected Less syntax.');
  });

  it('reports CST truncation through both ok and unconsumedFrom', () => {
    /*
     * `ok: true` with `errors: []` and a non-null `unconsumedFrom` is the
     * silent-truncation trap: branching on `ok` alone accepts a half-read
     * document.
     */
    for (const source of ['.a { color: red; }\n!broken', '\n  !broken', '/* c */ !!!']) {
      const result = parseLessCst(source);

      expect(result.ok, source).toBe(false);
      expect(result.errors, source).toHaveLength(0);
      expect(result.unconsumedFrom, source).not.toBeNull();
    }

    const clean = parseLessCst('.a{color:red}');

    expect(clean.ok).toBe(true);
    expect(clean.unconsumedFrom).toBeNull();
  });

  it('accepts a functional media query prelude as general-enclosed', () => {
    /*
     * `@media foo(bar)` is the `<general-enclosed>` function form
     * (media-queries-5 §2.1/§3.1: `<function-token> <any-value> )`); CSS, SCSS
     * and Jess all accept it and Less used to reject it alone. Valid CSS is
     * valid in every dialect, one way, so the Less media-query prelude reuses
     * the SAME general-enclosed node `@supports` already carries — the payload
     * is opaque, so any-value contents parse rather than being read as a typed
     * Less argument list.
     */
    const media = parse('@media foo(bar) { a { b: c } }').rules[0];
    const prelude = media?.type === 'AtRuleBlock' ? media.prelude : null;

    expect(prelude).toMatchObject({
      type: 'FunctionCall',
      name: 'foo',
      args: [
        { name: undefined, spread: false, value: { type: 'Interpolation' } }
      ]
    });

    // The general-enclosed payload is an opaque any-value, not a typed arg list.
    expect(() => parse('@media foo(a b !weird$) { a { b: c } }')).not.toThrow();
  });

  it.each([
    ['empty body', 'a{;}'],
    ['trailing semicolon', 'a{color:red;;}'],
    ['leading semicolon', 'a{;color:red}']
  ])('accepts a stray semicolon in a declaration block (%s)', (_label, source) => {
    expect(() => parse(source)).not.toThrow();
  });

  it.each([
    ['namespaced function', 'a { b: ns.fn() }'],
    ['namespaced variable', 'a { b: ns.$var }'],
    ['namespaced map read', 'a { b: map.get($m, k) }'],
    ['namespaced colour helper', 'a { b: color.mix(red, blue) }'],
    ['namespaced assignment', 'ns.$v: value;']
  ])('PINNED DEFECT — rejects Sass module-system member access (%s)', (_label, source) => {
    /*
     * `ns.member` is Sass module syntax, not Less syntax, so rejection here
     * is arguably right — but it is pinned because the SCSS parser rejects it
     * too (see the SCSS suite), and whatever admits it there will be reviewed
     * against these fixtures for dialect leakage.
     */
    expect(() => parse(source)).toThrow();
  });

  it('admits a keyword argument in a function call', () => {
    /*
     * `@name:` in a call is the SAME construct `.m(@name: 1)` already spelled
     * on the mixin lane, so it is the same node — one `CallArg` carrying the
     * authored keyword — and the callee's own parameter names bind it. It was
     * a hard parse error before `FunctionCall.args` had a slot to hold it.
     */
    const ast = parse('a { b: fade(@c, @amount: 50%) }');
    const rule = ast.rules[0];
    const value = rule?.type === 'Ruleset' && rule.rules[0]?.type === 'Declaration'
      ? rule.rules[0].value
      : null;

    expect(value).toMatchObject({
      type: 'FunctionCall',
      name: 'fade',
      args: [
        { name: undefined, spread: false, value: { type: 'Lookup', name: 'c' } },
        { name: 'amount', spread: false, value: { type: 'Dimension' } }
      ]
    });
  });

  it('does not read a colon as a keyword argument when no variable precedes it', () => {
    /* The key regex carries the operator lookahead, so only `@name:` opens the
     * keyword arm — `f(name: 1)` is no more accepted than it was before. */
    expect(() => parse('a { b: f(name: 1) }')).toThrow();
  });
});
