import { describe, expect, it } from 'vitest';
import { Dimension as LegacyDimension } from '@jesscss/core';
import { makeDimension } from '@jesscss/core/value';
import { builtinLessFns } from '../../builtins/index.js';
import { pow as builtinPow } from '../../builtins/pow.js';
import pow, { pow as namedPow } from '../pow.js';

type LegacyDimensionOracle = {
  number: number;
  unit: string;
  bytes: string;
};

/**
 * Pre-cutover Less `pow()` kept the base unit and applied JavaScript's scalar
 * `Math.pow`. Keep the oracle local so the parity test does not call the
 * implementation being removed from the public Less path.
 */
function legacyPowOracle(
  base: { number: number; unit: string },
  exponent: { number: number; unit: string }
): LegacyDimensionOracle {
  const result = new LegacyDimension({
    number: Math.pow(base.number, exponent.number),
    unit: base.unit || undefined
  });
  return {
    number: result.number,
    unit: result.unit ?? '',
    bytes: result.toString()
  };
}

describe('Less pow canonical cutover', () => {
  it('keeps numeric, unit, and serialized-byte parity across signed and fractional inputs', () => {
    const vectors = [
      [{ number: 3, unit: 'rem' }, { number: 2, unit: '' }],
      [{ number: -2, unit: 'px' }, { number: 3, unit: 'em' }],
      [{ number: 9, unit: '' }, { number: 0.5, unit: 'deg' }],
      [{ number: 0.25, unit: '%' }, { number: -2, unit: 's' }]
    ] as const;

    for (const [base, exponent] of vectors) {
      const expected = legacyPowOracle(base, exponent);
      const actual = pow(makeDimension(base.number, base.unit), makeDimension(exponent.number, exponent.unit));

      expect(actual).toMatchObject({
        type: 'Dimension',
        number: expected.number,
        unit: expected.unit,
        bytes: expected.bytes
      });
    }
  });

  it('uses one canonical callable at every Less entrypoint and registry slot', () => {
    expect(pow).toBe(namedPow);
    expect(pow).toBe(builtinPow);
    expect(builtinLessFns.find(fn => fn.name === 'pow')).toBe(builtinPow);
  });
});
