/**
 * Regression coverage for `nativeGuardCmp` dimension/unit reconciliation (A2.2).
 *
 * Ground truth is `npx less@4.6.3` (guard `when (...)` evaluation), NOT the repo's
 * legacy `Dimension.compare` (which diverges: it normalizes `%`→/100 and throws on
 * incompatible units — real Less 4.6.3 does neither in a guard). Verified cases:
 *   1cm = 10mm  → true      1s > 500ms → true      100ms = 0.1s → true
 *   50% = 0.5   → false     50% = 50   → true       50% = 50%    → true
 *   2px < 1em   → false (incomparable, no throw)    foo < bar    → false
 */
import { describe, expect, it } from 'vitest';
import { nativeGuardCmp } from '../value-operate.js';
import { makeDimension, makeKeyword, makeQuoted } from '../value-factory.js';
import type { ValueObj } from '../value-eval.js';

const dim = (n: number, u = ''): ValueObj => makeDimension(n, u);

describe('nativeGuardCmp — dimension unit reconciliation (vs less@4.6.3)', () => {
  it('converts compatible length units', () => {
    expect(nativeGuardCmp('=', dim(1, 'cm'), dim(10, 'mm'))).toBe(true);
    expect(nativeGuardCmp('=', dim(1, 'in'), dim(96, 'px'))).toBe(true);
    expect(nativeGuardCmp('=', dim(1, 'pc'), dim(12, 'pt'))).toBe(true);
    expect(nativeGuardCmp('<', dim(1, 'cm'), dim(2, 'cm'))).toBe(true);
  });

  it('converts compatible duration + angle units', () => {
    expect(nativeGuardCmp('>', dim(1, 's'), dim(500, 'ms'))).toBe(true);
    expect(nativeGuardCmp('=', dim(100, 'ms'), dim(0.1, 's'))).toBe(true);
    expect(nativeGuardCmp('=', dim(360, 'deg'), dim(1, 'turn'))).toBe(true);
  });

  it('treats % as a REGULAR unit (no /100 normalization)', () => {
    expect(nativeGuardCmp('=', dim(50, '%'), dim(0.5))).toBe(false);
    expect(nativeGuardCmp('=', dim(50, '%'), dim(50))).toBe(true);
    expect(nativeGuardCmp('=', dim(50, '%'), dim(50, '%'))).toBe(true);
    expect(nativeGuardCmp('=', dim(0, '%'), dim(0))).toBe(true);
  });

  it('incompatible / non-convertible units are INCOMPARABLE (never throw)', () => {
    expect(nativeGuardCmp('<', dim(2, 'px'), dim(1, 'em'))).toBe(false);
    expect(nativeGuardCmp('>', dim(2, 'px'), dim(1, 'em'))).toBe(false);
    expect(nativeGuardCmp('=', dim(2, 'px'), dim(1, 'em'))).toBe(false);
  });

  it('same-unit + unitless comparisons unchanged', () => {
    expect(nativeGuardCmp('=', dim(5, 'px'), dim(5, 'px'))).toBe(true);
    expect(nativeGuardCmp('>', dim(3, 'px'), dim(2, 'px'))).toBe(true);
    expect(nativeGuardCmp('>', dim(2), dim(1))).toBe(true);
    expect(nativeGuardCmp('>=', dim(5, 'px'), dim(5, 'px'))).toBe(true);
    expect(nativeGuardCmp('<', dim(2, 'px'), dim(0))).toBe(false);
  });

  it('non-dimension ordered comparison does NOT fall back to lexical bytes', () => {
    expect(nativeGuardCmp('>', makeKeyword('foo'), makeKeyword('bar'))).toBe(false);
    expect(nativeGuardCmp('<', makeKeyword('foo'), makeKeyword('bar'))).toBe(false);
    expect(nativeGuardCmp('>', makeQuoted('abc', '"', false), makeQuoted('abd', '"', false))).toBe(false);
    // equality on non-dimensions still holds (byte match), and self-order is reflexive.
    expect(nativeGuardCmp('=', makeKeyword('foo'), makeKeyword('foo'))).toBe(true);
    expect(nativeGuardCmp('=', makeKeyword('foo'), makeKeyword('bar'))).toBe(false);
    expect(nativeGuardCmp('>=', makeKeyword('foo'), makeKeyword('foo'))).toBe(true);
    expect(nativeGuardCmp('>', makeKeyword('foo'), makeKeyword('foo'))).toBe(false);
  });
});
