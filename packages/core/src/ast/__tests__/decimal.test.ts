import { describe, expect, it } from 'vitest';
import { addExact, modExact, mulExact, percentToFraction, subExact } from '../decimal.js';

describe('exact base-10 arithmetic (ledger V6)', () => {
  it('three chained subtractions of 0.33333333333333 land on 1e-14, where float gives 9.88e-15', () => {
    expect(subExact(subExact(subExact(1, 0.33333333333333), 0.33333333333333), 0.33333333333333)).toBe(1e-14);
  });

  it('adds, multiplies and takes a remainder in base 10', () => {
    expect(addExact(0.1, 0.2)).toBe(0.3);
    expect(mulExact(1.1, 1.1)).toBe(1.21);
    expect(modExact(5.3, 0.1)).toBe(0);
    expect(modExact(-5.5, 2)).toBe(-1.5);
    expect(percentToFraction(33.333333333333)).toBe(0.33333333333333);
  });

  it('reads exponent spellings', () => {
    expect(addExact(1e-7, 2e-7)).toBe(3e-7);
    expect(mulExact(1.5e21, 2.5)).toBe(3.75e21);
  });

  it('keeps float where float is exact or there is no number', () => {
    expect(Object.is(mulExact(-2.5, 0), -0)).toBe(true);
    expect(modExact(1.5, 0)).toBeNaN();
    expect(addExact(Number.NaN, 0.5)).toBeNaN();
    expect(subExact(Number.POSITIVE_INFINITY, 0.5)).toBe(Number.POSITIVE_INFINITY);
  });
});
