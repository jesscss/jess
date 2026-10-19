import { describe, it, expect } from 'vitest';
import { makeDimension, makeKeyword, makeList, type Dimension } from '@jesscss/core';
import { minMax } from '../min-max.js';

/**
 * Less `min()`/`max()`. Less coerces a unitless argument INTO the reference
 * unit and compares canonically. `max(1px, 1in, 2)` → `1in` is the case that
 * pins it against Sass, which answers `2` — see
 * `sass/__tests__/math-min-max.test.ts`. A unitless winner takes the reference
 * unit, as a unitless `+`/`-` operand does (ledger C20, V27; orchestrator
 * judgment under owner delegation 2026-10-06), where lessc 4.8.0 returns it
 * bare; every other expectation is lessc's.
 */
const run = (isMin: boolean, ...args: Dimension[]) => minMax(isMin, makeList(args, ','));

describe('Less min()/max()', () => {
  it('reduces same and convertible units, returning the argument as authored', () => {
    expect(run(true, makeDimension(1, 'cm'), makeDimension(3, 'mm'))).toMatchObject({ number: 3, unit: 'mm' });
    expect(run(false, makeDimension(1, 'px'), makeDimension(1, 'in'))).toMatchObject({ number: 1, unit: 'in' });
    expect(run(false, makeDimension(3, 'em'), makeDimension(1, 'em'), makeDimension(5, 'em')))
      .toMatchObject({ number: 5, unit: 'em' });
  });

  it('coerces a unitless argument INTO the reference unit, which a unitless winner takes', () => {
    // 2 is read as 2px, so 1in (96px) still wins — the Less/Sass divergence.
    expect(run(false, makeDimension(1, 'px'), makeDimension(1, 'in'), makeDimension(2)))
      .toMatchObject({ number: 1, unit: 'in' });
    expect(run(true, makeDimension(1, 'px'), makeDimension(1, 'in'), makeDimension(2)))
      .toMatchObject({ number: 1, unit: 'px' });
    expect(run(true, makeDimension(2, 'px'), makeDimension(1))).toMatchObject({ number: 1, unit: 'px' });
    expect(run(true, makeDimension(6, 'em'), makeDimension(5))).toMatchObject({ number: 5, unit: 'em' });
    expect(run(false, makeDimension(3), makeDimension(1, 'cm'))).toMatchObject({ number: 3, unit: 'cm' });
    expect(run(true, makeDimension(3), makeDimension(1, 'cm'))).toMatchObject({ number: 1, unit: 'cm' });
    expect(run(false, makeDimension(4), makeDimension(3, 'px'))).toMatchObject({ number: 4, unit: 'px', bytes: '4px' });
  });

  it('reads the reference unit from the FIRST unit-bearing argument', () => {
    expect(run(true, makeDimension(1, '%'), makeDimension(2), makeDimension(3, '%')))
      .toMatchObject({ number: 1, unit: '%' });
    expect(run(false, makeDimension(1, '%'), makeDimension(2), makeDimension(3, '%')))
      .toMatchObject({ number: 3, unit: '%' });
    expect(run(false, makeDimension(1, 'px'), makeDimension(2, 'px'), makeDimension(3)))
      .toMatchObject({ number: 3, unit: 'px' });
  });

  it('fails on incompatible units rather than partially reducing', () => {
    /*
     * less.js emits `min(5, 4ex)` here, reducing each unit group and keeping the
     * survivors — a branch it reaches only when an intervening unitless argument
     * resets its bookkeeping, so the same expression reduces or is preserved
     * depending on argument ORDER. Not ported; the engine preserves instead.
     */
    expect(() => run(true, makeDimension(6, 'em'), makeDimension(5), makeDimension(4, 'ex')))
      .toThrow('min() arguments have incompatible units');
    expect(() => run(false, makeDimension(1, 'px'), makeDimension(2, 'em')))
      .toThrow('max() arguments have incompatible units');
    expect(() => run(true, makeDimension(1, 'px'), makeDimension(2, 's')))
      .toThrow('min() arguments have incompatible units');
    expect(() => run(true, makeDimension(1, 'px'), makeDimension(1, '%'), makeDimension(2)))
      .toThrow('min() arguments have incompatible units');
  });

  it('fails on a non-numeric argument and on no arguments', () => {
    expect(() => minMax(true, makeList([makeDimension(1, 'px'), makeKeyword('var(--x)')], ',')))
      .toThrow('min() requires numeric arguments');
    expect(() => minMax(true, [])).toThrow('min() requires at least one argument');
  });

  it('flattens list arguments and passes a single argument through', () => {
    expect(minMax(true, makeList([[makeDimension(1, 'px'), makeDimension(5, 'px')]], ',')))
      .toMatchObject({ number: 1, unit: 'px' });
    expect(run(false, makeDimension(1, 'px'))).toMatchObject({ number: 1, unit: 'px' });
  });
});
