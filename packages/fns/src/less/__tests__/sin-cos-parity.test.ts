import { describe, expect, it } from 'vitest';
import { lessFns } from '../registry.js';
import { makeDimension } from '@jesscss/core/value';
import { cos } from '../cos.js';
import { sin } from '../sin.js';

type LegacyDimensionOracle = {
  number: number;
  unit: string;
  bytes: string;
};

/**
 * Pre-cutover Less's math helper normalizes angle units before applying the
 * trig function, then returns a unitless tree Dimension. Keep this oracle
 * local so the parity test does not import the implementation being deleted.
 */
function legacyTrigOracle(
  fn: (value: number) => number,
  number: number,
  unit: string
): LegacyDimensionOracle {
  const radians = unit === 'deg'
    ? number * Math.PI / 180
    : unit === 'grad'
      ? number * Math.PI / 200
      : unit === 'turn'
        ? number * 2 * Math.PI
        : number;
  const result = makeDimension(fn(radians));
  return { number: result.number, unit: result.unit, bytes: result.bytes };
}

describe('Less sin/cos canonical cutover', () => {
  it('keeps numeric, unit, and serialized-byte parity across angle and ordinary units', () => {
    const vectors = [
      [0.5, ''],
      [90, 'deg'],
      [100, 'grad'],
      [0.25, 'turn'],
      [-2.4, 'px'],
      [0.125, 'rem']
    ] as const;

    for (const [number, unit] of vectors) {
      const expectedSin = legacyTrigOracle(Math.sin, number, unit);
      const expectedCos = legacyTrigOracle(Math.cos, number, unit);
      const actualSin = sin(makeDimension(number, unit));
      const actualCos = cos(makeDimension(number, unit));

      expect(actualSin).toMatchObject({
        type: 'Dimension',
        number: expectedSin.number,
        unit: expectedSin.unit,
        bytes: expectedSin.bytes
      });
      expect(actualCos).toMatchObject({
        type: 'Dimension',
        number: expectedCos.number,
        unit: expectedCos.unit,
        bytes: expectedCos.bytes
      });
    }
  });

  it('registers the one canonical callable in the Less registry', () => {
    expect(lessFns.find(fn => fn.name === 'sin')).toBe(sin);
    expect(lessFns.find(fn => fn.name === 'cos')).toBe(cos);
  });
});
