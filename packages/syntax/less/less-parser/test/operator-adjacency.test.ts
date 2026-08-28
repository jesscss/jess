/*
 * Operator adjacency: what separates two operands, and who decides.
 *
 * Standing rule (DESIGN-DECISIONS.md, G22): every language construct we find
 * that the parser suites did not already catch gets a fixture in the parser
 * suites, in the same change that discovers it.
 *
 * These cases exist because the dialect grammars each hand-spelled their own
 * answer to "what may appear between an operator and its operand" as a local
 * regex, instead of deferring to the dialect's trivia table and asserting
 * ADJACENCY. Independent hand-spellings drifted: in `grammar.ts`,
 * `sumOperator` admits only whitespace around `-`, while the value-trivia
 * spellings admit whitespace OR a block comment. Nobody decided that.
 *
 * The comment forms below are the ones no whitespace-only test can see. After
 * comment removal `1px/**\/-/**\/2px` tokenises with NO whitespace, so a
 * lookahead written as `(?![0-9.])` sees the `/` and not the `2`. A lane has
 * already shipped a wrong widening on exactly that blind spot.
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

const accepts = (source: string) => expect(() => parse(source)).not.toThrow();
const rejects = (source: string) => expect(() => parse(source)).toThrow();

describe('Less operator adjacency', () => {
  /*
   * The coupling the whole feature turns on, and the reason a mandatory
   * separator cannot be expressed with ambient trivia alone: `-` followed by a
   * NON-adjacent operand is subtraction, `-` ADJACENT to its operand is a sign.
   * Both forms must keep parsing; it is the adjacency of `-` to `2px` that
   * chooses between them, not the presence of a separator.
   */
  it('accepts a spaced sum, an adjacent sign and a fully glued sum', () => {
    accepts('a { b: 1px - 2px }');
    accepts('a { b: 1px -2px }');
    accepts('a { b: 1px-2px }');
  });

  /*
   * Comments as the glue. These parse today, so there is no pin on
   * RECOGNITION — the defect is in what they evaluate to, pinned in the
   * evaluation suite. Recognition is asserted here so a future adjacency
   * conversion cannot silently start rejecting them.
   */
  it.each([
    ['both sides glued', 'a { b: 1px/**/-/**/2px }'],
    ['spaced with an interior comment', 'a { b: 1px /**/ - 2px }'],
    ['comment after the operator', 'a { b: 1px - /**/ 2px }'],
    ['comment before the operator', 'a { b: 1px /**/ - 2px }']
  ])('accepts a comment as an operator boundary (%s)', (_label, source) => {
    accepts(source);
  });

  /*
   * `calc()` is the one context where the whitespace/comment distinction is a
   * real POLICY rather than an accident. css-values-4 §10.1 requires actual
   * whitespace around `+` and `-`, because after comment removal
   * `calc(1px/**\/-/**\/2px)` tokenises as `1px` `-2px` — two values, which a
   * browser drops. `*` and `/` carry no such requirement.
   *
   * Owner ruling: the comment form is ACCEPTED, normalised to `calc(1px - 2px)`
   * on emit, and WARNED — a comment there is likelier a typo than an intent,
   * and silently normalising it means the author never learns the stylesheet
   * was one byte from being discarded. These pins are on recognition only.
   */
  it.each([
    ['both sides', 'a { b: calc(1px/**/-/**/2px) }'],
    ['left only', 'a { b: calc(1px/**/- 2px) }'],
    ['right only', 'a { b: calc(1px -/**/2px) }']
  ])('accepts a comment around a calc() sum (%s)', (_label, source) => {
    /*
     * Pin flipped: these were PINNED DEFECT rejections until the sum pad
     * stopped hand-spelling its own trivia and named the dialect's `mathTrivia`
     * table instead (DESIGN-DECISIONS G24). The calc ladder reaches the same
     * sum terminal, so fixing the operand separator fixed `calc()` with it.
     *
     * This realises the auto-fix half of G25 and, as ruled, it matches NEITHER
     * oracle. For `calc(100%/**\/-/**\/10px)` we emit `calc(100% - 10px)` —
     * valid CSS. lessc 4.x emits `calc(100%-10px /**\/ /**\/)`, which is
     * invalid and a browser drops the declaration; dart-sass over-folds and
     * loses the `calc()` entirely. Normalising the separator to a real space is
     * a deliberate choice and better than both.
     */
    accepts(source);
  });

  it('accepts calc() sum with real whitespace, and the glued product forms', () => {
    accepts('a { b: calc(1px - 2px) }');

    // `*` has no whitespace requirement in calc, so a comment there is harmless.
    accepts('a { b: calc(1px/**/*/**/2) }');
    accepts('a { b: calc(1px*2) }');
  });
});

/*
 * The wider defect the operator cases are only a symptom of.
 *
 * css-syntax-3 §4 makes a comment valid ANYWHERE whitespace is valid. The
 * whitespace REQUIREMENT of css-values-4 §10.1 applies to `+`/`-` only, and it
 * requires whitespace to be PRESENT — it is not a licence to reject comments
 * elsewhere. So every case below is valid CSS.
 *
 * All four dialects get this wrong, and each differently — four accept sets
 * for one question, no two agreeing and none matching the spec:
 *
 *   position                     css    less   scss   jess
 *   leading edge  calc(/**\/1px …)  rej    rej    ACC    rej
 *   trailing edge calc(… 2px/**\/)  rej    rej    ACC    rej
 *   around `*`    calc(1px/**\/*…)  rej    ACC    rej    rej
 *   around `-`    calc(1px/**\/-…)  rej    rej    rej    rej
 *
 * Less is the only dialect that admits a comment around a calc OPERATOR, and
 * the only one that then rejects it at the calc EDGES. That inversion is not a
 * policy anyone chose.
 */
describe('Less comments inside calc()', () => {
  it.each([
    ['leading edge', 'a { b: calc(/**/1px + 2px) }'],
    ['trailing edge, glued', 'a { b: calc(1px + 2px/**/) }'],
    ['trailing edge, spaced', 'a { b: calc(1px + 2px /**/) }'],
    ['after a nested paren', 'a { b: calc((1px)/**/) }']
  ])('accepts a comment at a calc() edge (%s)', (_label, source) => {
    /* `CalcFunction` now spells its interior padding, the same combinator the
     * `Paren` production next to it already spelled. That also makes `Paren`'s
     * own padding reachable from inside a calc, which is the `(1px)/**\/` row. */
    accepts(source);
  });

  it('accepts a comment around a calc() product operator', () => {
    accepts('a { b: calc(1px* /**/ 2) }');
    accepts('a { b: calc(1px /**/ * /**/ 2) }');
  });
});
