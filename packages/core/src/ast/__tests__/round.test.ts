import { describe, expect, it } from 'vitest';
import { round } from '../round.js';

/**
 * Tie direction follows CSS Values 4 `round(nearest, A, B)` (§10.3): when A is exactly
 * halfway between the lower and upper multiple, choose the UPPER one — toward
 * `+infinity`, for negative values too.
 */
describe('round — the rounding kernel', () => {
  it('breaks an exact tie toward +infinity', () => {
    expect(round(2.5)).toBe(3);
    expect(round(1.5)).toBe(2);
    expect(round(-1.5)).toBe(-1);
    expect(round(-2.5)).toBe(-2);
  });

  it('rounds a negative tie that lands on zero to negative zero', () => {
    // §10.3: "if upper B would be zero, it is specifically equal to 0⁻".
    expect(round(-0.5)).toBe(-0);
  });

  it('applies the same tie rule at a decimal precision', () => {
    expect(round(1.55, 1)).toBe(1.6);
    expect(round(-1.55, 1)).toBe(-1.5);
    expect(round(-2.345, 2)).toBe(-2.34);
  });

  it('leaves non-ties to the nearest value in either direction', () => {
    expect(round(-1.6)).toBe(-2);
    expect(round(-1.4)).toBe(-1);
    expect(round(-1.56, 1)).toBe(-1.6);
  });

  it('keeps the decimal exponential shift for decimally-exact ties', () => {
    // `toFixed` reads the binary double `1.00499…` and returns `1.00`.
    expect(round(1.005, 2)).toBe(1.01);
    expect(round(-1.005, 2)).toBe(-1);
  });
});
