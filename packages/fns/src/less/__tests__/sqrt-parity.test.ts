import { describe, expect, it } from 'vitest';
import { Dimension as LegacyDimension } from '@jesscss/core';
import { builtinLessFns } from '../../builtins/index.js';
import { sqrt as builtinSqrt } from '../../builtins/sqrt.js';
import { makeDimension } from '@jesscss/core/value';
import sqrt, { sqrt as namedSqrt } from '../sqrt.js';

type LegacyDimensionOracle = {
  number: number;
  unit: string;
  bytes: string;
};

/**
 * Pre-cutover Less's null-output-unit mathHelper path applies Math.sqrt to the
 * scalar and carries the first Dimension's unit without angle normalization.
 * Keep that oracle local so the parity test does not import the implementation
 * being removed.
 */
function legacySqrtOracle(number: number, unit: string): LegacyDimensionOracle {
  const result = new LegacyDimension({ number: Math.sqrt(number), unit: unit || undefined });
  return { number: result.number, unit: result.unit ?? '', bytes: result.toString() };
}

describe('Less sqrt canonical cutover', () => {
  it('keeps numeric, unit, and serialized-byte parity across ordinary and angle units', () => {
    const vectors = [
      [0, ''],
      [0.5, ''],
      [2.4, 'px'],
      [144, 'deg'],
      [100, 'grad'],
      [0.25, 'turn'],
      [-2.4, 'rem']
    ] as const;

    for (const [number, unit] of vectors) {
      const expected = legacySqrtOracle(number, unit);
      const actual = sqrt(makeDimension(number, unit));

      expect(actual).toMatchObject({
        type: 'Dimension',
        number: expected.number,
        unit: expected.unit,
        bytes: expected.bytes
      });
    }
  });

  it('uses one canonical callable at every Less entrypoint and registry slot', () => {
    expect(sqrt).toBe(namedSqrt);
    expect(sqrt).toBe(builtinSqrt);
    expect(builtinLessFns.find(fn => fn.name === 'sqrt')).toBe(builtinSqrt);
  });
});
