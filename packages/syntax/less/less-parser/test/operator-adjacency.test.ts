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
  ])('PINNED DEFECT — rejects a comment around calc() sum (%s)', (_label, source) => {
    rejects(source);
  });

  it('accepts calc() sum with real whitespace, and the glued product forms', () => {
    accepts('a { b: calc(1px - 2px) }');

    // `*` has no whitespace requirement in calc, so a comment there is harmless.
    accepts('a { b: calc(1px/**/*/**/2) }');
    accepts('a { b: calc(1px*2) }');
  });
});
