/*
 * Operator adjacency: what separates two operands, and who decides.
 *
 * Standing rule (DESIGN-DECISIONS.md, G22): every language construct we find
 * that the parser suites did not already catch gets a fixture in the parser
 * suites, in the same change that discovers it.
 *
 * SCSS is the sharpest illustration of why a hand-spelled boundary is the
 * wrong mechanism. `grammar.ts` spells the sum boundary as
 *
 *     /(?:\+[ \t\n\r\f]*|-[ \t\n\r\f]*|[ \t\n\r\f]+\+[ \t\n\r\f]*|[ \t\n\r\f]+-[ \t\n\r\f]+)/
 *
 * — four arms, ASYMMETRIC between the left and right of the operator, and
 * blind to comments. The asymmetry is not a decision anyone made; it is what
 * the arms happen to add up to. It is directly observable below:
 * `calc(1px/**\/- 2px)` is accepted and its mirror `calc(1px -/**\/2px)` is
 * rejected. Under an adjacency assertion the two are the same question asked
 * twice and cannot disagree.
 *
 * PINNED DEFECT
 * -------------
 * Cases whose title starts with `PINNED DEFECT` assert the CURRENT, WRONG
 * behaviour. They are pins, not endorsements. When the underlying defect is
 * fixed, the pin fails — flip the assertion and drop the marker. Grep
 * `PINNED DEFECT` across `packages/syntax` for the set.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@jesscss/scss-parser';

const accepts = (source: string) => expect(() => parse(source)).not.toThrow();
const rejects = (source: string) => expect(() => parse(source)).toThrow();

describe('SCSS operator adjacency', () => {
  /*
   * The coupling: `-` NOT adjacent to its operand is subtraction, `-` ADJACENT
   * to its operand is a sign, so `1px -2px` stays a space-separated list. Both
   * must keep parsing.
   */
  it('accepts a spaced sum, an adjacent sign and a fully glued sum', () => {
    accepts('a { b: 1px - 2px }');
    accepts('a { b: 1px -2px }');
    accepts('a { b: 1px-2px }');
  });

  /*
   * dart-sass accepts `1px/**\/-/**\/2px` and evaluates it to `-1px`; it treats
   * a comment as an ordinary operand boundary. SCSS here rejects it outright,
   * which is a recognition divergence from the oracle, not a policy choice.
   */
  it('PINNED DEFECT — rejects a comment-glued sum that dart-sass evaluates to -1px', () => {
    rejects('a { b: 1px/**/-/**/2px }');
  });

  /*
   * The asymmetry, stated as a pair so it cannot be fixed on one side only.
   * These two sources are mirror images of each other and the grammar gives
   * them opposite answers.
   */
  it('accepts a comment on the LEFT of a calc() sum operator', () => {
    accepts('a { b: calc(1px/**/- 2px) }');
  });

  it('PINNED DEFECT — rejects a comment on the RIGHT of a calc() sum operator', () => {
    /* Mirror of the case above. The only difference is which side the comment
     * is on, and the four-arm regex only spells the left one. */
    rejects('a { b: calc(1px -/**/2px) }');
  });

  it('PINNED DEFECT — rejects a comment around a calc() PRODUCT operator', () => {
    /* css-values-4 §10.1 imposes a whitespace requirement on `+` and `-` only.
     * `*` and `/` have none, so a comment there is harmless and must parse. */
    rejects('a { b: calc(1px/**/*/**/2) }');
  });

  it('accepts the whitespace and glued forms that need no comment handling', () => {
    accepts('a { b: calc(1px - 2px) }');
    accepts('a { b: calc(1px-2px) }');
    accepts('a { b: calc(1px*2) }');
  });
});
