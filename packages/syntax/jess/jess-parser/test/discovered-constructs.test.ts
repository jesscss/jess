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
  ])('PINNED DEFECT — rejects a bare parenthesised component value (%s)', (_label, source) => {
    /*
     * Valid CSS is valid in every dialect, one way. `b: (c)` is an ordinary
     * css-syntax-3 §5.4.7 simple block and CSS, Less and SCSS all accept at
     * least the tight spelling — Jess accepts none of them. Jess spells an
     * *expression* group `$(…)`, which is a separate construct and is
     * asserted below; that spelling does not license rejecting the plain
     * paren block.
     */
    expect(() => parse(source)).toThrow();
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
          args: [{ type: 'Keyword', src: '--x' }, { type: 'Keyword', src: 'e' }]
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

  it('splits a compound selector on whitespace', () => {
    expect(firstRule('a .b{c:d}')).toMatchObject({
      selector: { selectors: [{ type: 'ComplexSelector', value: [{ text: 'a' }, ' ', { text: '.b' }] }] }
    });
  });

  it('PINNED DEFECT — splits a compound selector on a comment', () => {
    /*
     * `a/*c*` + `/.b` is the single compound `a.b`: a comment is trivia, not
     * a descendant combinator, so it must not introduce one. Jess parses it
     * as the *descendant* `a .b` — byte-identical output to the authored
     * source, so it never surfaced, but the selector means something else
     * entirely. CSS and Less both produce a CompoundSelector here; SCSS
     * rejects the input (pinned in its own suite). Three different answers
     * to one construct.
     */
    expect(firstRule('a/*c*/.b{c:d}')).toMatchObject({
      selector: { selectors: [{ type: 'ComplexSelector', value: [{ text: 'a' }, ' ', { text: '.b' }] }] }
    });
  });

  it('accepts a relative selector with no leading combinator', () => {
    expect(() => parse('a:has(.b){c:d}')).not.toThrow();
  });

  it.each([
    ['child', 'a:has(> .b){c:d}'],
    ['next sibling', 'a:has(+ .b){c:d}']
  ])('PINNED DEFECT — rejects a leading combinator in a relative selector (%s)', (_label, source) => {
    /*
     * selectors-4 §4.2: a relative selector may start with a combinator.
     * CSS, Less and SCSS all accept `:has(> .b)`; only Jess does not, and it
     * is plain CSS, so this is a Jess selector-grammar gap rather than a
     * dialect decision.
     */
    expect(() => parse(source)).toThrow();
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
    ['double quotes', 'a { b: ~"x$(1 + 1)y" }'],
    ['single quotes', 'a { b: ~\'x$(1 + 1)y\' }']
  ])('PINNED DEFECT — an escaped INTERPOLATED string loses its escape and its quotes (%s)', (_label, source) => {
    /*
     * `~"x$(…)y"` reduces to a bare `Interpolation` whose parts carry NO quote
     * literals and no record that `~` was written, while the plain `"x$(…)y"`
     * keeps its quote literals as parts. What the escape MEANS — that it
     * strips the delimiters — is an eval-time decision made at parse time, so
     * the tree cannot answer "was this escaped?" at all. Correct shape is one
     * `Quoted` node with `escaped: true`, as the static arms above already
     * produce and as `Block` does for `~(`/`~[`; that needs `Quoted.value` to
     * admit an interpolation, which is an AST model change. Pinned so it
     * changes loudly.
     */
    const value = (firstRule(source) as { rules: Array<{ value: { type: string; parts: Array<{ lit?: string }> } }> }).rules[0]!.value;

    expect(value.type).toBe('Interpolation');
    expect(value.parts.some(part => part.lit === '"' || part.lit === '\'')).toBe(false);
    expect(value).not.toHaveProperty('escaped');
  });

  it.each([
    ['double quotes', 'a { b: "x$(1 + 1)y" }', '"'],
    ['single quotes', 'a { b: \'x$(1 + 1)y\' }', '\'']
  ])('keeps the quote literals of an UNESCAPED interpolated string (%s)', (_label, source, quote) => {
    const value = (firstRule(source) as { rules: Array<{ value: { type: string; parts: Array<{ lit?: string }> } }> }).rules[0]!.value;

    expect(value.type).toBe('Interpolation');
    expect(value.parts[0]).toMatchObject({ lit: expect.stringContaining(quote) });
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
