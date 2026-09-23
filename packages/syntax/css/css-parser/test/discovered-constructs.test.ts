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
            { value: { type: 'Keyword', src: '--x' } },
            { value: { type: 'Keyword', src: 'e' } }
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
     * notice. The media form is now accepted as `<general-enclosed>` in every
     * dialect (Less's acceptance is pinned in its own discovered-constructs suite).
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

  it('reports CST truncation through both ok and unconsumedFrom', () => {
    /*
     * `ok` means "this tree accounts for the whole input", not "the entry rule
     * returned without failing". It used to mean the latter, so a caller that
     * branched on `ok` alone accepted a half-read document — the
     * silent-truncation trap this pin recorded.
     *
     * `errors` is still empty: `many()` stopping early is not a recovery
     * record, and fabricating one would invent an `expected` no rule produced.
     * `unconsumedFrom` is still the precise fact. What changed is that `ok`
     * no longer disagrees with them.
     */
    for (const source of ['.a { color: red; }\n!broken', '\n  !broken', '/* c */ !!!']) {
      const result = parseCssCst(source);

      expect(result.ok, source).toBe(false);
      expect(result.errors, source).toHaveLength(0);
      expect(result.unconsumedFrom, source).not.toBeNull();
    }

    const clean = parseCssCst('.a{color:red}');

    expect(clean.ok).toBe(true);
    expect(clean.unconsumedFrom).toBeNull();
  });
});

/*
 * Top-level `&` is valid CSS: CSS Nesting L1 §4 says `&` used outside a nesting
 * context "represents the same elements as :scope in that context", so a
 * stylesheet-root `& { … }` is the scoping root, not a parse error (ledger P30,
 * DESIGN-DECISIONS.md; owner 2026-08-29). css now shares ONE ComplexSelector
 * with less/scss/jess instead of a forked TopLevel* tower, so it accepts the
 * `&` arm at the root like the three siblings already did. The root
 * leading-combinator rejection (P29) is preserved by construction: a root
 * `> .a` is an ordinary ComplexSelector, which cannot open with a combinator.
 */
describe('top-level nesting selector (P30)', () => {
  it.each([
    ['bare', '& { color: red }'],
    ['descendant', '& .child { color: red }'],
    ['compounded', '&.foo { color: red }']
  ])('accepts a top-level `&` (%s)', (_label, source) => {
    expect(() => parse(source), source).not.toThrow();
  });

  it('reduces a bare top-level `&` to a single SimpleSelector `&`', () => {
    expect(parse('& { color: red }').rules[0]).toMatchObject({
      type: 'Ruleset',
      selector: {
        type: 'SelectorList',
        selectors: [{ type: 'SimpleSelector', text: '&' }]
      }
    });
  });

  it('still rejects a root leading combinator (P29 boundary preserved)', () => {
    const failure = failureOf('> .a { color: red }');
    expect(failure.message).toBe('Unexpected CSS syntax.');
  });
});

/*
 * The value slash is a SEPARATOR with its own rung in the value hierarchy —
 * comma is loosest, then slash, then whitespace (DESIGN-DECISIONS P33, owner
 * 2026-09-23: "it's a separator. That means it has a similar hierarchy to
 * space-separated items and comma-separated items").
 *
 * The point of these cases is that the leading-slash rejection is EMERGENT, not
 * checked. There is no first-position guard anywhere: a leading `/` fails for
 * the same reason a leading `,` fails, and the `,` case below is the control
 * proving the two are the same failure, at the same offset, with the same
 * message. If a future change reaches this rejection by adding a
 * "may not begin with" predicate, these tests still pass but the model is
 * wrong — the paired `,` assertion is what pins the mechanism.
 */
describe('the value slash is a separator rung (P33)', () => {
  it.each([
    ['bare ident', 'a { p: /img }'],
    ['bare number', 'a { p: /1 }'],
    ['spaced from its operand', 'a { p: / 1 }']
  ])('rejects a value with no left operand for the slash (%s)', (_label, source) => {
    const failure = failureOf(source);
    expect(failure.message).toBe('Unexpected CSS syntax. Expected valid CSS syntax here.');
    expect(failure.offset).toBe(4);
  });

  /*
   * The control. A leading `,` already failed this way before the slash rung
   * existed, and a leading `/` now fails identically — same offset, same
   * message — because both are separators with nothing on their left.
   */
  it.each([
    ['comma', 'a { p: ,img }'],
    ['slash', 'a { p: /img }']
  ])('fails a leading separator the same way (%s)', (_label, source) => {
    const failure = failureOf(source);
    expect(failure.message).toBe('Unexpected CSS syntax. Expected valid CSS syntax here.');
    expect(failure.offset).toBe(4);
  });

  it('separates two space groups, keeping each group whole', () => {
    expect(parse('a { border-radius: 1px 2px / 3px 4px }').rules[0]).toMatchObject({
      rules: [{
        type: 'Declaration',
        name: 'border-radius',
        value: {
          type: 'List',
          sep: '/',
          value: [
            [{ type: 'Dimension', src: '1px' }, { type: 'Dimension', src: '2px' }],
            [{ type: 'Dimension', src: '3px' }, { type: 'Dimension', src: '4px' }]
          ]
        }
      }]
    });
  });

  it('puts the comma ABOVE the slash, not below it', () => {
    expect(parse('a { background: a, 1px / 2px }').rules[0]).toMatchObject({
      rules: [{
        type: 'Declaration',
        name: 'background',
        value: {
          type: 'List',
          sep: ',',
          value: [
            { type: 'Keyword', src: 'a' },
            { type: 'List', sep: '/', value: [{ type: 'Dimension', src: '1px' }, { type: 'Dimension', src: '2px' }] }
          ]
        }
      }]
    });
  });

  it.each([
    ['unspaced', 'a { aspect-ratio: 16/9 }'],
    ['spaced', 'a { aspect-ratio: 16 / 9 }']
  ])('reads the same structure whether or not the slash is spaced (%s)', (_label, source) => {
    expect(parse(source).rules[0]).toMatchObject({
      rules: [{
        type: 'Declaration',
        name: 'aspect-ratio',
        value: { type: 'List', sep: '/', value: [{ type: 'Dimension', src: '16' }, { type: 'Dimension', src: '9' }] }
      }]
    });
  });

  it('chains more than two groups at one slash rung', () => {
    expect(parse('a { grid-area: 1 / 2 / 3 / 4 }').rules[0]).toMatchObject({
      rules: [{
        type: 'Declaration',
        name: 'grid-area',
        value: { type: 'List', sep: '/', value: [{ src: '1' }, { src: '2' }, { src: '3' }, { src: '4' }] }
      }]
    });
  });

  /*
   * A custom property and a `var()` fallback are `<declaration-value>`
   * (css-variables-1 §2): any token sequence, so a leading slash is VALID CSS
   * there and must stay valid. These run through `CustomPropertyValue` and
   * `VarFallbackPunctuation`, which keep their own permissive punctuation run —
   * the slash rung does not reach them.
   */
  it.each([
    ['custom property', 'a { --v: /img }'],
    ['var() fallback', 'a { p: var(--x, /img) }']
  ])('keeps a leading slash valid where <declaration-value> allows it (%s)', (_label, source) => {
    expect(() => parse(source), source).not.toThrow();
  });

  /*
   * The right side of a slash stays ONE space group. If the rung flattened, this
   * would be a three-item list and `font` would render as `12px / 1.5 / Arial`.
   */
  it('keeps each side of the slash as one space group', () => {
    expect(parse('a { font: 12px/1.5 Arial }').rules[0]).toMatchObject({
      rules: [{
        type: 'Declaration',
        name: 'font',
        value: {
          type: 'List',
          sep: '/',
          value: [
            { type: 'Dimension', src: '12px' },
            [{ type: 'Dimension', src: '1.5' }, { type: 'Keyword', src: 'Arial' }]
          ]
        }
      }]
    });
  });

  /*
   * A comment is trivia wherever whitespace is (css-syntax-3 §4), so it is legal
   * padding around the separator and these are regular CSS.
   *
   * REGRESSION: the first spelling of `valueSlashBoundary` padded with a bare
   * `[ \t\n\r\f]*` run and rejected the first two of these, NARROWING the base —
   * they parse on the commit this rung landed on top of, and less still accepts
   * the second. Caught in review, not by either oracle: no corpus file and no
   * authored fixture carries the shape.
   */
  it.each([
    ['comment before the slash', 'a { p: 12px /* c */ / 1.5 }'],
    ['comment after the slash', 'a { p: 12px / /* c */ 1.5 }'],
    ['comment glued on both sides', 'a { p: 12px/*c*//1.5 }'],
    ['trailing comment after the last group', 'a { border-radius: 3px / 7px /* end */ }']
  ])('admits a comment as padding around the separator (%s)', (_label, source) => {
    expect(() => parse(source), source).not.toThrow();
  });

  /*
   * An UNTERMINATED comment opener is still not a separator. This is the whole
   * remaining job of the `not(literal('*'))` guard — a terminated comment is
   * consumed by the padding before the guard is ever reached — and without it
   * `3px /*unclosed` would read as `3px / *unclosed`, which is an acceptance
   * this branch has no business changing.
   */
  it('does not read an unterminated comment opener as a separator', () => {
    expect(() => parse('a { p: 3px /*unclosed }')).toThrow();
  });

  /*
   * A separator missing an operand on EITHER side fails, for the one reason.
   * `1px /` has no right operand; `//` and `a//b` put two separators in a row,
   * so the middle operand is empty.
   */
  it.each([
    ['no right operand', 'a { p: 1px / }'],
    ['bare double slash', 'a { p: // }'],
    ['double slash between operands', 'a { p: a//b }'],
    ['spaced double slash', 'a { p: 1px // 2px }']
  ])('rejects a separator with a missing operand (%s)', (_label, source) => {
    const failure = failureOf(source);
    expect(failure.message).toBe('Unexpected CSS syntax. Expected valid CSS syntax here.');
    expect(failure.offset).toBe(4);
  });

  /*
   * Controls: constructs that contain a `/` but are not the value separator, and
   * must be untouched by the rung.
   */
  it.each([
    ['absolute url path', 'a { background: url(/a.png) no-repeat }'],
    ['protocol-relative url', 'a { p: url(//cdn/x.png) }'],
    ['modern colour alpha component', 'a { p: rgb(15 23 42 / .22) }'],
    ['calc division stays arithmetic', 'a { p: calc(4/2) }'],
    ['An+B is not a value', 'a:nth-child(2n+1) { c: d }'],
    ['font shorthand', 'a { font: 12px/1.5 Arial }'],
    ['leading-dot number', 'a { p: .5px }']
  ])('leaves a non-separator slash alone (%s)', (_label, source) => {
    expect(() => parse(source), source).not.toThrow();
  });
});
