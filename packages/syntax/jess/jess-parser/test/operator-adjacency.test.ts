/*
 * Operator adjacency: what separates two operands, and who decides.
 *
 * Standing rule (DESIGN-DECISIONS.md, G22): every language construct we find
 * that the parser suites did not already catch gets a fixture in the parser
 * suites, in the same change that discovers it.
 *
 * This file is the specimen the whole adjacency change was opened on. Jess's
 * `grammar.ts` answers "what separates two operands" TWICE, in two places, with
 * two different answers:
 *
 *   expressionBoundary  /(?:[ \t\n\r\f]|\/\*(?:[^*]|\*(?!\/))*\*\/)+/   ws OR comment
 *   calcSumOperator     /[ \t\n\r\f]+[-+][ \t\n\r\f]+/                  ws only
 *
 * `expressionBoundary` is additionally used as `noTrivia(sequence(boundary,
 * symbol, boundary))` — trivia switched OFF and then hand-spelled back in. That
 * shape is the defect: a production must never disable trivia and re-define it.
 * The correct question is not "is a separator present" but "are these two
 * tokens ADJACENT", which needs no local spelling of what trivia looks like and
 * so cannot drift from the dialect's trivia table.
 *
 * The whitespace-vs-comment split between the two constants above is not pure
 * drift — inside `calc()` it is a genuine POLICY (css-values-4 §10.1) and must
 * survive. It just has to be STATED at the production rather than fall out of
 * two regexes that happen to differ.
 *
 * PINNED DEFECT
 * -------------
 * Cases whose title starts with `PINNED DEFECT` assert the CURRENT, WRONG
 * behaviour. They are pins, not endorsements. When the underlying defect is
 * fixed, the pin fails — flip the assertion and drop the marker. Grep
 * `PINNED DEFECT` across `packages/syntax` for the set.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@jesscss/jess-parser';

const accepts = (source: string) => expect(() => parse(source)).not.toThrow();
const rejects = (source: string) => expect(() => parse(source)).toThrow();

describe('Jess operator adjacency', () => {
  /*
   * Jess has no `1 -2` ambiguity in VALUE position: math lives in `$( … )`, so
   * a bare `1px -2px` is unambiguously a space-separated list and a bare
   * `1px - 2px` is not math at all. The coupling constraint that binds Less and
   * SCSS therefore does not bind Jess here — record that, so a later adjacency
   * conversion does not "fix" it into existence.
   */
  it('keeps bare value position free of math', () => {
    accepts('a { b: 1px -2px }');
    rejects('a { b: 1px - 2px }');
    rejects('a { b: 1px-2px }');
  });

  /*
   * Inside `$( … )` the operands must not be adjacent to the operator. This is
   * what `expressionBoundary` is really asserting, spelled as a regex.
   */
  it('requires non-adjacent operands inside a $( ) expression', () => {
    accepts('a { b: $(1px - 2px) }');
    rejects('a { b: $(1px -2px) }');
    rejects('a { b: $(1px-2px) }');
  });

  /*
   * `expressionBoundary` admits a block comment, so this is math. This is the
   * settled Jess answer and must survive the conversion — it is the half of the
   * policy split that says "a comment separates".
   */
  it('accepts a comment as an operand boundary inside $( )', () => {
    accepts('a { b: $(1px/**/-/**/2px) }');
    accepts('a { b: $(1px /**/ - 2px) }');
  });

  /*
   * `calcSumOperator` is whitespace-only, so `calc()` gives the OPPOSITE answer
   * to `$( )` in the same file. Inside `calc()` that is correct policy, not
   * drift: css-values-4 §10.1 requires real whitespace around `+`/`-` because
   * after comment removal `calc(1px/**\/-/**\/2px)` tokenises as `1px` `-2px`,
   * two values, which a browser drops.
   *
   * Owner ruling: ACCEPT the comment form, normalise it to `calc(1px - 2px)` on
   * emit, and WARN naming the construct and position. Auto-fix alone would hide
   * that the stylesheet was one byte from being discarded; the warning is what
   * makes it a fix rather than a cover-up. The pins below are on recognition.
   */
  it.each([
    ['both sides', 'a { b: calc(1px/**/-/**/2px) }'],
    ['left only', 'a { b: calc(1px/**/- 2px) }'],
    ['right only', 'a { b: calc(1px -/**/2px) }']
  ])('PINNED DEFECT — rejects a comment around calc() sum (%s)', (_label, source) => {
    rejects(source);
  });

  it('PINNED DEFECT — rejects a comment around a calc() PRODUCT operator', () => {
    /* §10.1's whitespace requirement is on `+` and `-` ONLY. `*` and `/` carry
     * none, so a comment there is harmless and must parse. Less already
     * accepts this form; Jess, SCSS and CSS all reject it. */
    rejects('a { b: calc(1px/**/*/**/2) }');
  });

  it('accepts calc() sum with real whitespace', () => {
    accepts('a { b: calc(1px - 2px) }');
  });
});

/*
 * The wider defect the operator cases are only a symptom of.
 *
 * css-syntax-3 §4 makes a comment valid ANYWHERE whitespace is valid, and
 * css-values-4 §10.1's whitespace requirement is on `+`/`-` only. So every
 * case below is valid CSS. All four dialects get this wrong, each differently:
 *
 *   position                     css    less   scss   jess
 *   leading edge  calc(/**\/1px …)  rej    rej    ACC    rej
 *   trailing edge calc(… 2px/**\/)  rej    rej    ACC    rej
 *   around `*`    calc(1px/**\/*…)  rej    ACC    rej    rej
 *   around `-`    calc(1px/**\/-…)  rej    rej    rej    rej
 *
 * Jess and CSS reject a comment in EVERY position inside `calc()`, which means
 * the calc region is not consulting the dialect trivia table at all — the
 * hand-spelled operator regexes are the only boundary it has. This is the
 * clearest statement of the defect in the file: the productions did not merely
 * spell trivia badly, they replaced it.
 */
describe('Jess comments inside calc()', () => {
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
