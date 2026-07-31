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
import { parse } from '@jesscss/css-parser';
import { parseCssCst } from '@jesscss/css-parser/cst';

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

function selectorTextsOf(source: string): unknown {
  return parse(source).rules[0];
}

describe('CSS constructs discovered outside the parser suites', () => {
  it('accepts a parenthesised component value with no interior whitespace', () => {
    expect(selectorTextsOf('a { b: (c) }')).toMatchObject({
      rules: [{ type: 'Declaration', name: 'b', value: { type: 'Block', delimiter: 'paren' } }]
    });
  });

  it.each([
    ['both sides', 'a { b: ( c ) }'],
    ['leading only', 'a { b: ( c) }'],
    ['trailing only', 'a { b: (c ) }']
  ])('accepts whitespace inside a paren component value (%s)', (_label, source) => {
    /*
     * css-syntax-3 §5.4.7 consumes a simple block by balancing brackets; the
     * whitespace tokens inside are ordinary component values. `ParenValue` now
     * spells its own interior padding — it has to, because the value ladder
     * runs with trivia cleared, so an interior that admits authored padding has
     * to write it.
     */
    expect(() => parse(source)).not.toThrow();
  });

  it.each([
    ['both sides', 'a { b: (/* c */ c /* c */) }'],
    ['leading only', 'a { b: (/* c */ c) }'],
    ['trailing only', 'a { b: (c /* c */) }'],
    ['a comment holding the closer', 'a { b: (/* ) */ c) }']
  ])('accepts a comment inside a paren component value (%s)', (_label, source) => {
    /* A comment is trivia wherever whitespace is trivia (css-syntax-3 §4), so
     * the padding spells `cssValueTrivia` and not a bare whitespace run. */
    expect(() => parse(source), source).not.toThrow();
  });

  it('drops a comment out of var() arguments rather than emitting its bytes', () => {
    /*
     * A comment is trivia. It must not survive into the value as content.
     * This used to emit the `/*`, `c` and `*` + `/` bytes as Any/Keyword
     * siblings, three nodes longer than the author wrote, because nothing
     * consumed the comment as trivia and `VarFallbackPunctuation` took the `/`
     * and `*` as value punctuation. SCSS and Less both produce `[--x, e]`, and
     * so does CSS now.
     */
    expect(selectorTextsOf('a { b: var(--x, /* c */ e) }')).toMatchObject({
      rules: [{
        type: 'Declaration',
        value: {
          type: 'FunctionCall',
          name: 'var',
          args: [
            { type: 'Keyword', src: '--x' },
            { type: 'Keyword', src: 'e' }
          ]
        }
      }]
    });
  });

  it.each([
    ['spaced modifier', 'a[href="x" i]{c:d}'],
    ['spaced s modifier', 'a[href="x" s]{c:d}'],
    ['tight modifier', 'a[href="x"i]{c:d}'],
    ['fully spaced attribute', 'a[ href = "x" i ]{c:d}']
  ])('accepts the attribute case-sensitivity modifier (%s)', (_label, source) => {
    expect(selectorTextsOf(source)).toMatchObject({
      type: 'Ruleset',
      selector: { selectors: [{ type: 'CompoundSelector' }] }
    });
  });

  it('normalises the attribute modifier to its tight spelling', () => {
    /*
     * Divergence found by cross-dialect probe: CSS, SCSS and Jess all emit
     * `[href="x"i]`; Less keeps the authored space. Pinned on both sides so
     * whichever way it is unified, one of the two fails loudly.
     */
    expect(selectorTextsOf('a[href="x" i]{c:d}')).toMatchObject({
      selector: { selectors: [{ value: [{ text: 'a' }, { text: '[href="x"i]' }] }] }
    });
  });

  it('splits a compound selector on whitespace but not on a comment', () => {
    expect(selectorTextsOf('a .b{c:d}')).toMatchObject({
      selector: { selectors: [{ type: 'ComplexSelector', value: [{ text: 'a' }, ' ', { text: '.b' }] }] }
    });
    expect(selectorTextsOf('a/*c*/.b{c:d}')).toMatchObject({
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
    /*
     * `@layeré` is the at-rule `layeré`, not `@layer` followed by `é`
     * (css-syntax-3 §4.3.11 consumes an ident-sequence, and U+00E9 is an
     * ident code point). This used to hard-fail in CSS while SCSS and Jess
     * accepted it.
     */
    expect(() => parse(source)).not.toThrow();
  });

  it.each([
    ['empty body', 'a{;}'],
    ['trailing semicolon', 'a{color:red;;}'],
    ['leading semicolon', 'a{;color:red}']
  ])('accepts a stray semicolon in a declaration block (%s)', (_label, source) => {
    /*
     * css-syntax-3 §5.4.4 drops an empty declaration rather than failing.
     * These were rejected outright until recently.
     */
    expect(() => parse(source)).not.toThrow();
  });

  it.each([
    ['functional supports condition', '@supports selector(a > b) { a { b: c } }'],
    ['functional media feature', '@media foo(bar) { a { b: c } }']
  ])('keeps the function name on a functional at-rule prelude (%s)', (_label, source) => {
    /*
     * These parsed while silently losing the `selector` / `foo` name off the
     * prelude — a wrong tree from a successful parse, the hardest kind to
     * notice. Less still rejects the media form; that is pinned in its suite.
     */
    expect(() => parse(source)).not.toThrow();
  });

  it('PINNED DEFECT — rejects an unbalanced bracket inside a custom property', () => {
    /*
     * css-syntax-3 §5.4.6 gives a custom property an arbitrary token stream;
     * §5.4.8 says a `]` with no open `[` is a parse error but is consumed,
     * not fatal, so `--x: foo(] bar` should reach the declaration as-is. All
     * four dialects reject it. This is the one custom-property shape none of
     * them parse.
     */
    expect(() => parse('a{--x: foo(] bar}')).toThrow();
  });

  it('does not claim a complete stylesheet when only a comment preceded the garbage', () => {
    /*
     * The whitespace form of this (`"\n  !broken"`) is pinned in
     * leftover-input-errors.test.ts. The comment form is the same case and
     * must classify the same way — SCSS currently does not; see its own
     * discovered-constructs suite.
     */
    const failure = failureOf('/* c */ !!!');

    expect(failure.offset).toBe(8);
    expect(failure.message).toBe('Unexpected CSS syntax.');
  });

  it('reports CST truncation through unconsumedFrom, never through ok', () => {
    /*
     * `ok: true` with `errors: []` and a non-null `unconsumedFrom` is the
     * silent-truncation trap: a caller that branches on `ok` alone accepts a
     * half-read document. Pinned so the surface cannot quietly start
     * reporting success differently.
     */
    for (const source of ['.a { color: red; }\n!broken', '\n  !broken', '/* c */ !!!']) {
      const result = parseCssCst(source);

      expect(result.ok, source).toBe(true);
      expect(result.errors, source).toHaveLength(0);
      expect(result.unconsumedFrom, source).not.toBeNull();
    }

    const clean = parseCssCst('.a{color:red}');

    expect(clean.ok).toBe(true);
    expect(clean.unconsumedFrom).toBeNull();
  });
});
