import { describe, expect, it } from 'vitest';
import { lessFns } from '../registry.js';
import { makeDimension } from '@jesscss/core';
import { mod } from '../mod.js';
import { pi } from '../pi.js';

type LegacyDimensionOracle = {
  number: number;
  unit: string;
  bytes: string;
};

/**
 * Pre-cutover Less's `pi` implementation returned this exact tree Dimension.
 * Keep the oracle local so the parity test does not import the implementation
 * that this slice deletes from the public Less path.
 */
function legacyPiOracle(): LegacyDimensionOracle {
  const result = makeDimension(Math.PI);
  return {
    number: result.number,
    unit: result.unit,
    bytes: result.bytes
  };
}

/**
 * Pre-cutover Less's `mod` implementation uses JavaScript remainder and carries
 * the dividend's unit; the divisor's unit is deliberately not consulted.
 */
function legacyModOracle(a: { number: number; unit: string }, b: { number: number; unit: string }): LegacyDimensionOracle {
  const result = makeDimension(a.number % b.number, a.unit);
  return {
    number: result.number,
    unit: result.unit,
    bytes: result.bytes
  };
}

describe('Less pi/mod canonical cutover', () => {
  it('keeps pi unitless and byte-identical to the pre-cutover tree result', () => {
    const expected = legacyPiOracle();
    const result = pi();

    expect(result.type).toBe('Dimension');
    expect(result.number).toBe(expected.number);
    expect(result.unit).toBe(expected.unit);
    expect(result.bytes).toBe(expected.bytes);
  });

  it('keeps the dividend unit and exact remainder bytes across signed inputs', () => {
    const vectors = [
      [{ number: 7.5, unit: 'px' }, { number: 2, unit: 'em' }],
      [{ number: -7.5, unit: '%' }, { number: 2, unit: 'px' }],
      [{ number: 5, unit: '' }, { number: -2, unit: 's' }],
      [{ number: 0.125, unit: 'rem' }, { number: 0.01, unit: 'px' }]
    ] as const;

    for (const [a, b] of vectors) {
      const expected = legacyModOracle(a, b);
      const result = mod(makeDimension(a.number, a.unit), makeDimension(b.number, b.unit));

      expect(result.type).toBe('Dimension');
      expect(result.number).toBe(expected.number);
      expect(result.unit).toBe(expected.unit);
      expect(result.bytes).toBe(expected.bytes);
    }
  });

  it('registers the one canonical callable in the Less registry', () => {
    expect(lessFns.find(fn => fn.name === 'pi')).toBe(pi);
    expect(lessFns.find(fn => fn.name === 'mod')).toBe(mod);
  });
});
