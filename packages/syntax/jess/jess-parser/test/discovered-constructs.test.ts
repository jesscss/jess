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
import { parse } from '@jesscss/jess-parser';
import { parseJessCst } from '@jesscss/jess-parser/cst';

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

describe('Jess constructs discovered outside the parser suites', () => {
  it.each([
    ['tight', 'a { b: (c) }'],
    ['both sides', 'a { b: ( c ) }'],
    ['leading only', 'a { b: ( c) }'],
    ['trailing only', 'a { b: (c ) }'],
    ['arithmetic group', 'a { b: (1 + 2) }']
  ])('accepts a plain parenthesised component value (%s)', (_label, source) => {
    /*
     * Valid CSS is valid in every dialect, one way. `b: (c)` is an ordinary
     * css-syntax-3 §5.4.7 simple block, and CSS, Less and SCSS all accept it
     * (P18(a), DESIGN-DECISIONS.md). The parens make a plain component-value
     * block, NOT the `$(…)` expression group asserted below — the block is
     * inert and never evaluated. A bare infix arithmetic value with no parens
     * is a separate construct that still rejects (P17), asserted below.
     */
    expect(() => parse(source)).not.toThrow();
  });

  it('models a parenthesised component value as a paren Block', () => {
    expect(firstRule('a { b: (c) }')).toMatchObject({
      rules: [{
        type: 'Declaration',
        name: 'b',
        value: { type: 'Block', delimiter: 'paren', value: { type: 'Keyword', src: 'c' } }
      }]
    });
  });

  it('keeps a bare infix arithmetic value a parse error outside parens (P17)', () => {
    /*
     * P17: `.jess` arithmetic is spelled ONLY as `$(…)`; a bare `1 + 2` at
     * value top level "shouldn't even parse". The paren block above does not
     * license the unparenthesised form — the boundary is exactly the parens.
     */
    expect(() => parse('a { b: 1 + 2 }')).toThrow();
  });

  it.each([
    ['empty', 'a { b: () }'],
    ['whitespace only', 'a { b: ( ) }']
  ])('keeps an empty parenthesised block a parse error (%s)', (_label, source) => {
    /*
     * P18(a) settles `(c)` / `( c )` / `(1 + 2)` and is silent on the empty
     * block. The raw simple-block fallback declines it so `()` stays the clean
     * rejection Jess already produced, rather than minting an empty `Any`.
     */
    expect(() => parse(source)).toThrow();
  });

  it.each([
    ['nested parens', 'a { b: (1 + (2)) }', '1 + (2)'],
    ['nested brackets', 'a { b: (1 + [2]) }', '1 + [2]'],
    ['nested braces', 'a { b: (1 + {2}) }', '1 + {2}'],
    ['string with a close paren', 'a { b: ("a)b" + 2) }', '"a)b" + 2'],
    ['comment with a close paren', 'a { b: (1 /* ) */ + 2) }', '1 /* ) */ + 2']
  ])('keeps a nested delimiter, string or comment from closing the raw block early (%s)', (_label, source, inner) => {
    /*
     * The raw §5.4.7 fallback scans to the matching `)`, skipping balanced
     * groups, strings and comments — so an inner `)` cannot end the block.
     * Pins the balanced/skip helpers: without them the block would close at the
     * first inner `)` and the tail would be a parse error.
     */
    expect(firstRule(source)).toMatchObject({
      rules: [{ type: 'Declaration', name: 'b', value: { type: 'Block', delimiter: 'paren', value: { type: 'Any', src: inner } } }]
    });
  });

  it('accepts the Jess expression group', () => {
    expect(firstRule('a { b: $(c) }')).toMatchObject({
      rules: [{ type: 'Declaration', name: 'b', value: { type: 'Interpolation' } }]
    });
  });

  it('parses var() with no comment in the fallback', () => {
    expect(firstRule('a { b: var(--x, e) }')).toMatchObject({
      rules: [{ value: { type: 'FunctionCall', name: 'var' } }]
    });
  });

  it('drops a comment out of var() arguments rather than emitting its bytes', () => {
    /*
     * A comment is trivia wherever whitespace is trivia (css-syntax-3 §4), so
     * it must neither be rejected nor reach the value. The comment leaves no
     * trace in the args — the same shape the CSS suite asserts, where the old
     * behaviour leaked the comment's bytes in as `Any` nodes.
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

  it.each([
    ['spaced modifier', 'a[href="x" i]{c:d}'],
    ['spaced s modifier', 'a[href="x" s]{c:d}'],
    ['tight modifier', 'a[href="x"i]{c:d}'],
    ['fully spaced attribute', 'a[ href = "x" i ]{c:d}']
  ])('accepts the attribute case-sensitivity modifier (%s)', (_label, source) => {
    expect(() => parse(source)).not.toThrow();
  });

  /*
   * Ledger O7 (owner ruling): an attribute selector keeps its authored
   * whitespace in all four dialects — the same table the CSS and Less suites
   * pin. A gap is one space, whatever whitespace or comment filled it.
   */
  it.each([
    ['a[href="x" i]{c:d}', '[href="x" i]'],
    ['a[href="x"i]{c:d}', '[href="x"i]'],
    ['a[ href = "x" i ]{c:d}', '[ href = "x" i ]'],
    ['a[data-x=y i]{c:d}', '[data-x=y i]'],
    ['a[href  =\n"x"]{c:d}', '[href = "x"]'],
    ['a[href/* c */="x"]{c:d}', '[href ="x"]']
  ])('keeps the authored whitespace inside an attribute selector (%s)', (source, attribute) => {
    expect(firstRule(source)).toMatchObject({
      selector: { selectors: [{ value: [{ text: 'a' }, { text: attribute }] }] }
    });
  });

  it('splits a compound selector on whitespace', () => {
    expect(firstRule('a .b{c:d}')).toMatchObject({
      selector: { selectors: [{ type: 'ComplexSelector', value: [{ text: 'a' }, ' ', { text: '.b' }] }] }
    });
  });

  it('keeps a compound selector compound across a comment', () => {
    /*
     * `a/*c*` + `/.b` is the single compound `a.b`: a comment is trivia, not
     * a descendant combinator, so it must not introduce one (DESIGN-DECISIONS
     * G26). CSS and Less already produce a CompoundSelector here; Jess now
     * agrees. Only the no-whitespace form is compound — `a/*x*` + `/ b` and
     * `a /*x*` + `/ b` stay descendant, asserted below.
     */
    expect(firstRule('a/*c*/.b{c:d}')).toMatchObject({
      selector: { selectors: [{ type: 'CompoundSelector', value: [{ text: 'a' }, { text: '.b' }] }] }
    });
  });

  it('keeps a comment with adjacent whitespace a descendant separator', () => {
    /*
     * A block comment followed (or preceded) by real whitespace is an authored
     * descendant combinator, not a manufactured one — the compound stops at the
     * whitespace exactly as CSS and Less do. Guards against widening G26 past
     * the no-whitespace case.
     */
    expect(firstRule('a/*x*/ b{c:d}')).toMatchObject({
      selector: { selectors: [{ type: 'ComplexSelector', value: [{ text: 'a' }, ' ', { text: 'b' }] }] }
    });
  });

  it('keeps a compound compound across a comment inside a pseudo argument', () => {
    /*
     * The same rule holds inside a functional pseudo: `:is(.e/*y*` + `/.f)` is
     * `:is(.e.f)`, matching the CSS base, which reuses the one compound
     * production everywhere.
     */
    expect(firstRule('a:is(.e/*y*/.f){c:d}')).toMatchObject({
      selector: {
        selectors: [{
          type: 'CompoundSelector',
          value: [
            { text: 'a' },
            {
              type: 'PseudoSelector',
              name: ':is',
              args: { selectors: [{ type: 'CompoundSelector', value: [{ text: '.e' }, { text: '.f' }] }] }
            }
          ]
        }]
      }
    });
  });

  it('accepts a relative selector with no leading combinator', () => {
    expect(() => parse('a:has(.b){c:d}')).not.toThrow();
  });

  it.each([
    ['child', 'a:has(> .b){c:d}'],
    ['next sibling', 'a:has(+ .b){c:d}'],
    ['subsequent sibling', 'a:has(~ .b){c:d}']
  ])('accepts a leading combinator in a relative selector (%s)', (_label, source) => {
    /*
     * selectors-4 §4.2: a relative selector may start with a combinator. CSS,
     * Less and SCSS all admit a leading combinator on the shared selector-pseudo
     * argument, and it is plain CSS, so Jess accepts it too.
     */
    expect(() => parse(source)).not.toThrow();
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

  it('does not claim a complete stylesheet when only a comment preceded the garbage', () => {
    const failure = failureOf('/* c */ !!!');

    expect(failure.offset).toBe(8);
    expect(failure.message).toBe('Unexpected Jess syntax.');
  });

  it('reports CST truncation through both ok and unconsumedFrom', () => {
    /*
     * `ok: true` with `errors: []` and a non-null `unconsumedFrom` is the
     * silent-truncation trap: branching on `ok` alone accepts a half-read
     * document.
     */
    for (const source of ['.a { color: red; }\n!broken', '\n  !broken', '/* c */ !!!']) {
      const result = parseJessCst(source);

      expect(result.ok, source).toBe(false);
      expect(result.errors, source).toHaveLength(0);
      expect(result.unconsumedFrom, source).not.toBeNull();
    }

    const clean = parseJessCst('.a{color:red}');

    expect(clean.ok).toBe(true);
    expect(clean.unconsumedFrom).toBeNull();
  });

  /*
   * The escape is an OPTIONAL PREFIX on ONE quoted body, not a second copy of
   * it. `~` used to lead its own full spelling of every arm — four copies of
   * the body across `Quoted` alone — so the copies were free to drift. These
   * pin the two forms together: whatever the plain form accepts, the `~` form
   * must accept, and the only difference is `escaped`.
   */
  it.each([
    ['double quotes', 'a { b: ~"raw" }', '"'],
    ['single quotes', 'a { b: ~\'raw\' }', '\'']
  ])('records a static escaped string as one Quoted node with escaped: true (%s)', (_label, source, quote) => {
    expect(firstRule(source)).toMatchObject({
      rules: [{ value: { type: 'Quoted', value: 'raw', quote, escaped: true } }]
    });
  });

  it.each([
    ['double quotes', 'a { b: "raw" }', '"'],
    ['single quotes', 'a { b: \'raw\' }', '\'']
  ])('records an unescaped string as the same node with escaped: false (%s)', (_label, source, quote) => {
    expect(firstRule(source)).toMatchObject({
      rules: [{ value: { type: 'Quoted', value: 'raw', quote, escaped: false } }]
    });
  });

  it.each([
    ['double quotes', 'a { b: ~"x$(1 + 1)y" }', '"'],
    ['single quotes', 'a { b: ~\'x$(1 + 1)y\' }', '\'']
  ])('records an escaped INTERPOLATED string as the same escaped Quoted node, carrying its template (%s)', (_label, source, quote) => {
    /*
     * An escaped string is a string whether or not it interpolates (owner
     * 2026-10-06, ledger V3): `~"x$(…)y"` is the `Quoted` the static arms
     * produce, with `escaped` and its quote, its authored content in `value`,
     * and its content template — whose parts carry no quote literals, since the
     * quotes are the node's — in `interp`.
     */
    expect(firstRule(source)).toMatchObject({
      rules: [{
        value: {
          type: 'Quoted',
          quote,
          escaped: true,
          src: `~${quote}x$(1 + 1)y${quote}`,
          value: 'x$(1 + 1)y',
          interp: { type: 'Interpolation', parts: [{ lit: 'x' }, { ref: { type: 'Expression' }, unquote: true }, { lit: 'y' }] }
        }
      }]
    });
  });

  it.each([
    ['double quotes', 'a { b: "x$(1 + 1)y" }', '"'],
    ['single quotes', 'a { b: \'x$(1 + 1)y\' }', '\'']
  ])('records an UNESCAPED interpolated string as the same Quoted node, carrying its template (%s)', (_label, source, quote) => {
    /* The same node with `escaped: false` (ledger C2): the quotes are the node's, not literal parts. */
    expect(firstRule(source)).toMatchObject({
      rules: [{
        value: {
          type: 'Quoted',
          quote,
          escaped: false,
          src: `${quote}x$(1 + 1)y${quote}`,
          interp: { type: 'Interpolation', parts: [{ lit: 'x' }, { ref: { type: 'Expression' }, unquote: true }, { lit: 'y' }] }
        }
      }]
    });
  });

  it('replays an interpolating string key and argument by their authored spelling', () => {
    // Was `$m(~"ab")[r]` / `$m[~"a"]`: the string's src held its literal text with every hole emptied.
    expect(firstRule('a { b: $m(~"a${x}b")[r] }')).toMatchObject({ rules: [{ value: { type: 'Reference', raw: '$m(~"a${x}b")[r]' } }] });
    expect(firstRule('a { b: $m[~"a${x}"] }')).toMatchObject({ rules: [{ value: { type: 'Reference', raw: '$m[~"a${x}"]' } }] });
    expect(firstRule('a { b: $m["a${x}"] }')).toMatchObject({ rules: [{ value: { type: 'Reference', raw: '$m["a${x}"]' } }] });
  });

  it.each([
    ['double quotes', 'a { b: "x$(1 + 1)y" }', '"'],
    ['single quotes', 'a { b: \'x$(1 + 1)y\' }', '\'']
  ])('builds the same Quoted inside a `$( … )` computation (%s)', (_label, source, quote) => {
    /* The expression family's string is the value family's node, not a second shape. */
    const inner = source.replace(/: (.*) \}$/u, ': $($1) }');
    expect(firstRule(inner)).toMatchObject({
      rules: [{
        value: {
          type: 'Interpolation',
          parts: [{
            ref: {
              type: 'Expression',
              value: { type: 'Quoted', quote, escaped: false, src: `${quote}x$(1 + 1)y${quote}`, interp: { type: 'Interpolation' } }
            }
          }]
        }
      }]
    });
  });

  it.each([
    ['Sass namespaced call', 'a { b: ns.fn() }'],
    ['Sass namespaced variable', 'a { b: ns.$var }'],
    ['Sass named argument', 'a { b: f($x: 1) }'],
    ['Sass spread argument', 'a { b: f($x...) }']
  ])('PINNED DEFECT — rejects a Sass call/member form (%s)', (_label, source) => {
    /*
     * Not Jess syntax today. Pinned alongside the SCSS pins so that whatever
     * grammar admits them there is checked against Jess for leakage in the
     * same change.
     */
    expect(() => parse(source)).toThrow();
  });
});
