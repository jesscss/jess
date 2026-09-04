/*
 * A comment used as the GLUE between an operator and its operands.
 *
 * Standing rule (DESIGN-DECISIONS.md, G22): every language construct we find
 * that the parser suites did not already catch gets a fixture, in the same
 * change that discovers it. Recognition is pinned in
 * `packages/syntax/*\/*-parser/test/operator-adjacency.test.ts`; this file pins
 * what the constructs EVALUATE to, which is where the live defect is.
 *
 * Why these forms and not the whitespace ones: after comment removal
 * `1px/**\/-/**\/2px` tokenises with NO whitespace at all. Every whitespace
 * form of the same construct behaves correctly today, so the defect below is
 * invisible to any test that does not use a comment as the glue. A lane has
 * already shipped a wrong widening on exactly this blind spot — three `less`
 * sum arms were widened at once and `1/**\/-/**\/2` started parsing as math,
 * because the glued arms' `(?![0-9.])` lookahead sees the `/` and not the `2`.
 *
 * The root cause is that the Less grammar's `sumOperator` hand-spells its
 * operand boundary as `[ \t\n\r\f]` and therefore does not know that a comment
 * is trivia, while the value-trivia spellings a few lines away do. The fix is
 * to stop spelling boundaries locally and assert ADJACENCY against the
 * dialect's own trivia table.
 *
 * PINNED DEFECT
 * -------------
 * Cases whose title starts with `PINNED DEFECT` assert the CURRENT, WRONG
 * behaviour. They are pins, not endorsements. When the underlying defect is
 * fixed, the pin fails — flip the assertion to the oracle answer recorded in
 * each case and drop the marker.
 */
import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';

const compiler = new Compiler({ compile: { plugins: [lessPlugin()] } });

const render = async (source: string) =>
  (await compiler.renderString(source, { language: 'less' })).replace(/\s+/g, ' ').trim();

describe('Less math with a comment on the operator boundary', () => {
  /*
   * The control group. Whitespace boundaries evaluate correctly, which is
   * exactly why the comment forms went unnoticed.
   */
  it('evaluates whitespace-bounded and glued sums as math', async () => {
    await expect(render('.a { width: 1px - 2px; }')).resolves.toBe('.a { width: -1px; }');
    await expect(render('.a { width: 1px-2px; }')).resolves.toBe('.a { width: -1px; }');
  });

  /*
   * The coupling that constrains any fix: `-` ADJACENT to its operand is a
   * sign, so this stays a space-separated list of two values and must NOT
   * become subtraction. lessc 4.x: `1px -2px`.
   */
  it('keeps an adjacent sign a space-separated list, not a subtraction', async () => {
    await expect(render('.a { width: 1px -2px; }')).resolves.toBe('.a { width: 1px -2px; }');
  });

  it.each([
    ['glued on both sides', '1px/**/-/**/2px'],
    ['spaced, with an interior comment', '1px /**/ - 2px'],
    ['comment after the operator', '1px - /**/ 2px'],
    ['comment before the operator, spaced after', '1px/**/- 2px'],
    ['comment before the operator, glued after', '1px/**/-2px'],
    ['line comment as the separator', '1px //c\n- 2px'],
    ['addition, glued on both sides', '1px/**/+/**/2px']
  ])('treats a comment on the boundary as an operand separator (%s)', async (_label, value) => {
    /*
     * Pins flipped. These asserted that a comment on the boundary silently
     * disabled the math and that the comment bytes were emitted verbatim into
     * the CSS as value content — three top-level byte divergences from the
     * lessc 4.x oracle, which folds all of them.
     *
     * The cause was the sum pad hand-spelling its own trivia as
     * `comment* ws+ (comment ws*)*`: because it REQUIRED a whitespace run, a
     * comment standing alone as the separator did not count. Naming the
     * dialect's `mathTrivia` table instead (DESIGN-DECISIONS G24) removes the
     * private definition and the divergence with it. `1px/**\/+/**\/2px` did
     * not merely mis-evaluate, it failed to parse at all.
     */
    const expected = value.includes('+') ? '3px' : '-1px';
    await expect(render(`.a { width: ${value}; }`)).resolves.toBe(
      `.a { width: ${expected}; }`
    );
  });

  /*
   * Where we now DIVERGE from lessc 4.x, deliberately. lessc gives opposite
   * answers to mirror-image inputs: `1px/**\/- 2px` folds to `-1px` but its
   * mirror `1px -/**\/2px` stays a list. That is the same self-inconsistency
   * class as the SCSS four-arm `sumOperator`, and reference behaviour is not
   * intent — a separator is a separator on whichever side it appears, so we
   * fold both (G20: equivalent inputs, equivalent artifacts).
   */
  it('folds the mirror form that lessc 4.x leaves unfolded', async () => {
    await expect(render('.a { width: 1px -/**/2px; }')).resolves.toBe('.a { width: -1px; }');
  });

  /*
   * Pin flipped. `1px-/**\/2px` — a `-` glued to the unit, then a comment — used
   * to read as one dimension with unit `px-` and emit verbatim, because the
   * shared/CSS `dimensionUnit` admits any hyphen not glued to a DIGIT
   * (`-(?![0-9])`), so the operand ate the operator before `sumOperator` could
   * see it. That lookahead is comment-blind in the same way the sum operator's
   * was (`1px-2px` splits, `1px-/**\/2px` did not). The Less grammar now uses a
   * `lessDimensionUnit` terminal that also refuses a `-` before a comment opener
   * (`/*` or `//`), so the dimension stops at `px` and the operator folds to
   * `-1px` like lessc. This is a Less-only value-math delta: CSS and SCSS keep
   * the shared terminal, where the same input is a two-item list per their
   * oracles (G32; the deferred-half tracking row G34 in DESIGN-DECISIONS.md).
   */
  it('folds a glued-before pad like lessc', async () => {
    await expect(render('.a { width: 1px-/**/2px; }')).resolves.toBe('.a { width: -1px; }');
  });

  /*
   * The coupling that scopes the fix above: a `-` glued to the unit but followed
   * by WHITESPACE (then a comment) is NOT comment-adjacent, so `lessDimensionUnit`
   * still absorbs it into the unit (`px-`) and this stays a two-item list — the
   * dimension never reaches the sum operator. Unchanged by the narrowing; the
   * `-1px` fold requires the comment to immediately follow the operator `-`.
   */
  it('leaves a whitespace-after glued dash a two-item list', async () => {
    await expect(render('.a { width: 1px- /**/2px; }')).resolves.toBe('.a { width: 1px- /**/2px; }');
  });

  /*
   * The consequence of freeing the dash as an operator: with a comment then NO
   * right operand (`1px-/**\/`), the `-` is a subtraction with nothing to
   * subtract, which is a parse error — as it would be for `1px - ;`. lessc reads
   * the same dash as an operator, so this is the operator's error, not a
   * regression toward the old `px-` unit. (Degenerate input; absent from every
   * corpus, so no oracle/fixture is affected.)
   */
  it('rejects a glued-before dash with no right operand', async () => {
    await expect(render('.a { width: 1px-/**/; }')).rejects.toThrow();
  });
});
