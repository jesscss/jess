import { describe, expect, it } from 'vitest';
import { formatNumber } from '../format-number.js';
import { makeDimension } from '../value-factory.js';
import { serializeDimension } from '../serialize-value.js';

const bytes = (n: number, unit = ''): string => makeDimension(n, unit).bytes;

describe('formatNumber — the output number policy', () => {
  it('drops float-noise digits nobody authored', () => {
    expect(formatNumber(0.1 + 0.2)).toBe('0.3');
    expect(formatNumber(1.005 * 100)).toBe('100.5');
    expect(formatNumber(0.7 + 0.1)).toBe('0.8');
    expect(formatNumber(4.35 * 100)).toBe('435');
  });

  it('keeps digits that are earned, with no significant-figure cap', () => {
    // 1cm in px is 96/2.54 — a genuine repeating decimal, not noise.
    expect(formatNumber(96 / 2.54)).toBe('37.79527559');
    expect(formatNumber(100 / 3)).toBe('33.333333333');
    expect(formatNumber(2 / 3)).toBe('0.6666666667');
    expect(formatNumber(Math.PI)).toBe('3.1415926536');
  });

  it('is magnitude-invariant — a large value keeps its real digits', () => {
    // An 8-significant-figure cap would have printed `393.35276`, discarding
    // digits that a cm->px conversion genuinely produced.
    expect(formatNumber(96 / 2.54 * 10.4)).toBe('393.07086614');
    expect(formatNumber(393.35275590551178)).toBe('393.3527559');
  });

  it('never annihilates a small magnitude the way an 8-decimal floor did', () => {
    // Under `round(n, 8)` every one of these flattened to literally `0`.
    expect(formatNumber(1.23456789e-9)).toBe('0.00000000123456789');
    expect(formatNumber(1e-21)).toBe('0.000000000000000000001');
    expect(formatNumber(-5e-12)).toBe('-0.000000000005');
  });

  it('never emits scientific notation (CSSOM §6.7.2)', () => {
    expect(formatNumber(1e-7)).toBe('0.0000001');
    expect(formatNumber(1.5e21)).toBe('1500000000000000000000');
    expect(formatNumber(-1e-7)).toBe('-0.0000001');
    expect(formatNumber(1.25e-8)).toBe('0.0000000125');
    for (const n of [1e-7, 1e-21, 1.5e21, -3.75e-9, 2.5e22]) {
      expect(formatNumber(n)).not.toContain('e');
    }
  });

  it('round-trips within the stated relative tolerance', () => {
    for (const n of [0.1 + 0.2, 100 / 3, Math.PI, 96 / 2.54, 1.23456789e-9, -86731.985251]) {
      expect(Math.abs(Number(formatNumber(n)) - n)).toBeLessThanOrEqual(Math.abs(n) * 1e-10);
    }
  });

  it('leaves integers and short decimals untouched', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(-0)).toBe('0');
    expect(formatNumber(42)).toBe('42');
    expect(formatNumber(1.5)).toBe('1.5');
    expect(formatNumber(0.000001)).toBe('0.000001');
  });
});

describe('serializeDimension under the policy', () => {
  it('applies the policy to the number and keeps the unit', () => {
    expect(bytes(0.1 + 0.2, 'px')).toBe('0.3px');
    expect(bytes(100 / 3, '%')).toBe('33.333333333%');
    expect(bytes(1.23456789e-9, 'px')).toBe('0.00000000123456789px');
  });

  it('still spells non-finite dimensions the CSS way', () => {
    expect(serializeDimension(makeDimension(Number.NaN, 'px'))).toBe('NaNpx');
    expect(serializeDimension(makeDimension(Number.POSITIVE_INFINITY, 'px'))).toBe('infinitypx');
    expect(serializeDimension(makeDimension(Number.NEGATIVE_INFINITY, 'px'))).toBe('-infinitypx');
  });
});
