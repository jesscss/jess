/*
 * Operator adjacency: what separates two operands, and who decides.
 *
 * Standing rule (DESIGN-DECISIONS.md, G22): every language construct we find
 * that the parser suites did not already catch gets a fixture in the parser
 * suites, in the same change that discovers it.
 *
 * CSS is the base the other three dialects compose on, and it carries the one
 * boundary rule that is a real SPEC requirement rather than a dialect
 * preference: css-values-4 §10.1 requires actual whitespace around `+` and `-`
 * inside `calc()`, and imposes NO such requirement on `*` and `/`. A comment
 * does not satisfy it, because comments are removed at tokenisation
 * (css-syntax-3 §4) — `calc(1px/**\/-/**\/2px)` reduces to the token stream
 * `1px` `-2px`, two values, and the declaration is dropped.
 *
 * That makes CSS the dialect where "whitespace but NOT comments" has to stay
 * expressible after the adjacency conversion, and stated explicitly at the
 * production rather than implied by a regex that happens to omit the comment
 * alternative.
 *
 * CSS also has NO line comments. `//` must never become trivia here, however
 * Less, SCSS and Jess spell theirs.
 *
 * PINNED DEFECT
 * -------------
 * Cases whose title starts with `PINNED DEFECT` assert the CURRENT, WRONG
 * behaviour. They are pins, not endorsements. When the underlying defect is
 * fixed, the pin fails — flip the assertion and drop the marker. Grep
 * `PINNED DEFECT` across `packages/syntax` for the set.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@jesscss/css-parser';

const accepts = (source: string) => expect(() => parse(source)).not.toThrow();
const rejects = (source: string) => expect(() => parse(source)).toThrow();

describe('CSS operator adjacency', () => {
  /*
   * Plain CSS performs no arithmetic in value position, so none of these is a
   * sum — they are component values and all four must round-trip. Recorded so a
   * later adjacency conversion of the calc productions cannot leak a math
   * reading into bare values.
   */
  it('treats bare values as component values, whatever the spacing', () => {
    accepts('a { b: 1px - 2px }');
    accepts('a { b: 1px -2px }');
    accepts('a { b: 1px-2px }');
    accepts('a { b: 1px/**/-/**/2px }');
  });

  it('accepts a calc() sum with real whitespace on both sides', () => {
    accepts('a { b: calc(1px - 2px) }');
  });

  /*
   * Correctly rejected, and NOT a pin: `1px-2px` tokenises as the two dimension
   * tokens `1px` and `-2px` with no operator between them, so §10.1 is not
   * merely unsatisfied, there is no sum at all. Less and SCSS both accept this
   * form; that is a dialect divergence, not a CSS defect.
   */
  it('rejects a calc() sum with no separator', () => {
    rejects('a { b: calc(1px-2px) }');
  });

  it.each([
    ['both sides', 'a { b: calc(1px/**/-/**/2px) }'],
    ['left only', 'a { b: calc(1px/**/- 2px) }'],
    ['right only', 'a { b: calc(1px -/**/2px) }']
  ])('PINNED DEFECT — rejects a comment around calc() sum (%s)', (_label, source) => {
    /*
     * Rejection is the SPEC answer for the token stream, but not the answer we
     * ship: the owner ruling is to accept, normalise to `calc(1px - 2px)` on
     * emit, and warn. Pinned as rejection until the normalise-and-warn path
     * lands, so the change is loud.
     */
    rejects(source);
  });

  it('PINNED DEFECT — rejects a comment around a calc() PRODUCT operator', () => {
    /*
     * §10.1's whitespace requirement covers `+` and `-` only. `*` and `/` have
     * none, so `calc(1px/**\/*\/**\/2)` is valid CSS and must parse. Less
     * accepts it; CSS, SCSS and Jess all reject it, which is the whitespace
     * requirement having been copied onto the wrong operator class by a
     * hand-spelled boundary.
     */
    rejects('a { b: calc(1px/**/*/**/2) }');
  });

  it('accepts a calc() product with no separator', () => {
    accepts('a { b: calc(1px*2) }');
  });
});

/*
 * The wider defect the operator cases are only a symptom of.
 *
 * css-syntax-3 §4 makes a comment valid ANYWHERE whitespace is valid. The
 * whitespace REQUIREMENT of css-values-4 §10.1 applies to `+`/`-` only, and it
 * is a requirement that whitespace be PRESENT — it is not a licence to reject
 * comments elsewhere. So every case below is valid CSS.
 *
 * All four dialects get this wrong, and each gets it wrong differently — four
 * different accept sets for one question:
 *
 *   position                     css    less   scss   jess
 *   leading edge  calc(/**\/1px …)  rej    rej    ACC    rej
 *   trailing edge calc(… 2px/**\/)  rej    rej    ACC    rej
 *   around `*`    calc(1px/**\/*…)  rej    ACC    rej    rej
 *   around `-`    calc(1px/**\/-…)  rej    rej    rej    rej
 *
 * No two dialects agree, and none matches the spec. That is the signature of
 * four independent hand-spelled boundaries rather than one trivia table.
 */
describe('CSS comments inside calc()', () => {
  it.each([
    ['leading edge', 'a { b: calc(/**/1px + 2px) }'],
    ['trailing edge, glued', 'a { b: calc(1px + 2px/**/) }'],
    ['trailing edge, spaced', 'a { b: calc(1px + 2px /**/) }'],
    ['after a nested paren', 'a { b: calc((1px)/**/) }'],
    ['around the product operator', 'a { b: calc(1px* /**/ 2) }']
  ])('PINNED DEFECT — rejects a comment inside calc() (%s)', (_label, source) => {
    rejects(source);
  });

  it('accepts calc() with no comment at all', () => {
    accepts('a { b: calc(1px) }');
    accepts('a { b: calc(1px + 2px) }');
  });
});

/*
 * Selector position is the other place adjacency decides meaning, and CSS is
 * the dialect that gets it right — recorded here so a conversion cannot
 * regress it into agreement with the dialects that get it wrong.
 *
 * `.e` and `.f` with nothing between them are a COMPOUND selector (both
 * classes on ONE element); with a separator they are a DESCENDANT pair. Those
 * match different elements, so `.e/*y*\/.f` is not a formatting question.
 *
 * Measured, four engines, three answers:
 *
 *   lessc 4.x    `.e.f`        oracle
 *   jess (css)   `.e.f`        <- asserted below
 *   jess (less)  `.e.f`
 *   jess (jess)  `.e .f`       pinned in packages/jess/test/jess/
 *   dart-sass    `.e .f`
 *   jess (scss)  parse error   pinned in the SCSS parser suite
 *
 * EXPECTED ANSWER, NOT YET RULED ON: `.e.f` in all four. css-syntax-3 §4
 * removes comments during tokenisation, so nothing separates `.e` from `.f`
 * by the time selector structure is decided. Trivia does not split a compound.
 */
describe('CSS selector adjacency across a block comment', () => {
  it('keeps a compound selector compound across a comment', () => {
    accepts('.e/*y*/.f { g: h }');
  });

  it('accepts a comment used as a descendant separator', () => {
    accepts('a /* x */ b { c: d }');
    accepts('a/*x*/ b { c: d }');
  });
});
