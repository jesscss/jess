import { describe, expect, it } from 'vitest';
import { lessFns } from '../registry.js';
import { makeDimension } from '@jesscss/core';
import { sqrt } from '../sqrt.js';

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
  const result = makeDimension(Math.sqrt(number), unit);
  return { number: result.number, unit: result.unit, bytes: result.bytes };
}

describe('Less sqrt canonical cutover', () => {
  it('keeps numeric, unit, and serialized-byte parity across ordinary and angle units', () => {
    const vectors = [
      [0, ''],
      [0.5, ''],
      [2.4, 'px'],
      [144, 'deg'],
      [100, 'grad'],
      [0.25, 'turn']
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

  /*
   * Ledger V7. The `-2.4rem` vector used to sit in the parity table above, pinning
   * `sqrt(-2.4rem)` to the bytes `NaNrem` — invalid CSS the pre-cutover oracle
   * happened to produce. A negative radicand has no real square root, so the call
   * fails and `functionMode` decides what the stylesheet shows.
   */
  it('refuses a negative radicand rather than emitting NaN', () => {
    expect(() => sqrt(makeDimension(-2.4, 'rem'))).toThrow(RangeError);
  });

  it('registers the one canonical callable in the Less registry', () => {
    expect(lessFns.find(fn => fn.name === 'sqrt')).toBe(sqrt);
  });
});
