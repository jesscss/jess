import { describe, expect, it } from 'vitest';
import { makeDimension } from '@jesscss/core/value';
import { lessFns } from '../registry.js';
import { pow } from '../pow.js';

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
  const result = makeDimension(Math.pow(base.number, exponent.number), base.unit);
  return {
    number: result.number,
    unit: result.unit,
    bytes: result.bytes
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

  it('registers the one canonical callable in the Less registry', () => {
    expect(lessFns.find(fn => fn.name === 'pow')).toBe(pow);
  });
});
