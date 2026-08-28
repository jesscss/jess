import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

/**
 * Sass `==` lowers to a named PRIMITIVE, not to an operator (§5.1).
 *
 * Sass equality is unit-strict on numbers (→ `.jess` `==`) and quote-insensitive
 * on text (→ `.jess` `=`). Neither `.jess` operator reproduces it alone, and for
 * `$a == $b` the operand types are unknown until eval, so the front end cannot
 * pick one — it lowers to `sass-equal`, which DISPATCHES on operand type.
 *
 * This is what replaced `equalityMode`. The difference between the dialects is
 * now carried by what the lowered node SAYS, not by a flag the evaluator reads
 * from ambient config.
 */
const branchTaken = async (condition: string): Promise<boolean> => {
  const css = await new Compiler().renderString(
    `@if ${condition} { .hit { a: b; } }`,
    { filePath: 'entry.scss', extension: '.scss' }
  );
  return css.includes('.hit');
};

describe('Sass `==` is the `sass-equal` primitive', () => {
  it('is UNIT-STRICT on a numeric pair — the `==` arm', async () => {
    expect(await branchTaken('1 == 1px')).toBe(false);
    expect(await branchTaken('2 == 2%')).toBe(false);
    expect(await branchTaken('1px == 1px')).toBe(true);
  });

  it('still converts compatible units, because the TYPE is the unit group', async () => {
    expect(await branchTaken('1in == 96px')).toBe(true);
    expect(await branchTaken('1in == 2.54cm')).toBe(true);
  });

  it('is QUOTE-INSENSITIVE on text — the `=` arm, on the same operator', async () => {
    expect(await branchTaken('a == "a"')).toBe(true);
    expect(await branchTaken('"a" == a')).toBe(true);
    expect(await branchTaken('a == "b"')).toBe(false);
  });

  it('compares colours on the colour ground, however each side is spelled', async () => {
    expect(await branchTaken('black == #000000')).toBe(true);
    expect(await branchTaken('black == #00000000')).toBe(false);
  });

  it('`!=` is the same primitive under `not`', async () => {
    expect(await branchTaken('1 != 2')).toBe(true);
    expect(await branchTaken('1 != 1')).toBe(false);
    expect(await branchTaken('1 != 1px')).toBe(true);
    expect(await branchTaken('a != "a"')).toBe(false);
  });
});
