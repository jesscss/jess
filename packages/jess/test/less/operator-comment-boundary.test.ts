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
    ['comment after the operator', '1px - /**/ 2px']
  ])(
    'PINNED DEFECT — a comment on the boundary silently disables the math (%s)',
    async (_label, value) => {
      /*
       * lessc 4.x evaluates all three to `-1px` (relocating the comment bytes
       * to the end of the value: `-1px /**\/`). We perform NO arithmetic and
       * emit the source bytes verbatim, comment included. That is a top-level
       * byte divergence from the 4.x oracle in the Less dialect, and it means
       * comment bytes reach the CSS output as value content — a comment is
       * trivia and must never survive into a value as content.
       *
       * When the adjacency conversion lands, each of these must evaluate to
       * `-1px`; flip the expectation and drop the marker.
       */
      await expect(render(`.a { width: ${value}; }`)).resolves.toBe(
        `.a { width: ${value}; }`
      );
    }
  );
});
