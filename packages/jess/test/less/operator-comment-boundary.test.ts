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
   * Unchanged, and NOT fixed by this: a pad on one side with the operator glued
   * to a number on the other. lessc folds these to `-1px`; we leave them as
   * lists. The glued arms use `(?![0-9.])` as their proxy for "this sign is not
   * glued to a number", and a comment defeats that proxy — in `1px/**\/-2px`
   * the lookahead sees `/` rather than the digit that is actually there. Fixing
   * it needs the operand's adjacency asserted directly rather than sniffed
   * through a lookahead, which is what `notAdjacent()` is for.
   */
  it.each([
    ['comment before, glued after', '1px/**/-2px'],
    ['glued before, comment after', '1px-/**/2px']
  ])('PINNED DEFECT — leaves a one-sided pad unfolded where lessc folds it (%s)', async (_label, value) => {
    await expect(render(`.a { width: ${value}; }`)).resolves.toBe(`.a { width: ${value}; }`);
  });
});
