import { describe, expect, it } from 'vitest';
import { round } from '../round.js';

/**
 * Tie direction is half-away-from-zero (ledger V8): Less 4.x `round()` and dart-sass
 * `math.round` both break an exact half that way. The tie expectations are lessc 4.9.1
 * output for the same calls.
 */
describe('round — the rounding kernel', () => {
  it('breaks an exact tie away from zero', () => {
    expect(round(2.5)).toBe(3);
    expect(round(1.5)).toBe(2);
    expect(round(-0.5)).toBe(-1);
    expect(round(-1.5)).toBe(-2);
    expect(round(-2.5)).toBe(-3);
  });

  it('applies the same tie rule at a decimal precision', () => {
    expect(round(1.55, 1)).toBe(1.6);
    expect(round(-1.55, 1)).toBe(-1.6);
    expect(round(-0.05, 1)).toBe(-0.1);
    expect(round(-2.345, 2)).toBe(-2.35);
  });

  it('rounds a negative value that lands on zero to zero, at any precision', () => {
    // The zero's sign is not part of the contract (the two paths differ); both emit `0`.
    expect(Math.abs(round(-0.4))).toBe(0);
    expect(Math.abs(round(-0.04, 1))).toBe(0);
  });

  it('leaves non-ties to the nearest value in either direction', () => {
    expect(round(-1.6)).toBe(-2);
    expect(round(-1.4)).toBe(-1);
    expect(round(-1.54, 1)).toBe(-1.5);
  });

  it('keeps the decimal exponential shift for decimally-exact ties', () => {
    // `toFixed` reads the binary double `1.00499…` and returns `1.00`.
    expect(round(1.005, 2)).toBe(1.01);
    expect(round(-1.005, 2)).toBe(-1.01);
  });
});
