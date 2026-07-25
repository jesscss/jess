/**
 * Cross-unit dimension arithmetic (E2) — a faithful port of less.js `Dimension.operate`.
 *
 * Ground truth is `less@4.6.7` run with `math: 'parens-division'` (the default paren
 * math the alpha corpus assumes). Cross-unit `*`/`/` and incompatible `+`/`-` COMPUTE
 * (they do NOT throw or fall back to `calc()`): they keep the LHS unit, converting a
 * compatible RHS first, and cancel the numerator/denominator multiset so a chained
 * op resolves the surviving unit (`8cats * 9dogs / 4cats` → `18dogs`).
 */
import { describe, expect, it } from 'vitest';
import { operate, validateFinalUnits } from '../value-operate.js';
import { makeBlock, makeDimension, makeList } from '../value-factory.js';
import type { EvalModes, ValueObj } from '../value-eval.js';

const PRESERVE: EvalModes = { unitMode: 'preserve' };
const LOOSE: EvalModes = { unitMode: 'loose' };
const STRICT: EvalModes = { unitMode: 'strict' };

const dim = (n: number, u = ''): ValueObj => makeDimension(n, u);
const bytesOf = (op: string, a: ValueObj, b: ValueObj, m = PRESERVE) => operate(op, a, b, m).bytes;

describe('cross-unit arithmetic — vs less@4.6.7 (parens-division)', () => {
  it('division keeps the LHS unit for incompatible units', () => {
    expect(bytesOf('/', dim(4, 'em'), dim(2, 'cm'))).toBe('2em');
    expect(bytesOf('/', dim(14, 'px'), dim(1.4, 'em'))).toBe('10px');
    expect(bytesOf('/', dim(2, 'px'), dim(3, 's'))).toBe('0.6666666667px');
  });

  it('multiplication keeps the LHS unit', () => {
    expect(bytesOf('*', dim(4, 'em'), dim(2, 'cm'))).toBe('8em');
    expect(bytesOf('*', dim(2, 'px'), dim(3, 'px'))).toBe('6px');
  });

  it('preserves percentage products as a calc value in preserve mode', () => {
    expect(bytesOf('*', dim(100, '%'), dim(100, '%'))).toBe('calc(100% * 100%)');
    expect(bytesOf('*', dim(100, '%'), dim(100, '%'), LOOSE)).toBe('10000%');
  });

  it('same-unit division retains the unit via backupUnit', () => {
    expect(bytesOf('/', dim(8, 'px'), dim(2, 'px'))).toBe('4px');
    expect(bytesOf('/', dim(4, 'em'), dim(2, 'em'))).toBe('2em');
  });

  it('numerator/denominator cancel across a chain (custom units)', () => {
    // (8cats * 9dogs) / 4cats → 18dogs
    const prod = operate('*', dim(8, 'cats'), dim(9, 'dogs'), PRESERVE);
    expect(bytesOf('/', prod, dim(4, 'cats'))).toBe('18dogs');
  });

  it('addition/subtraction convert a compatible RHS, else operate on raw magnitudes', () => {
    expect(bytesOf('+', dim(20, 'mm'), dim(1, 'cm'))).toBe('30mm');
    expect(bytesOf('+', dim(90, 'deg'), dim(0.25, 'turn'))).toBe('180deg');
    expect(bytesOf('+', dim(1, 'px'), dim(1, 'em'))).toBe('2px'); // em non-convertible → raw add
    expect(bytesOf('-', dim(100, '%'), dim(10, 'px'))).toBe('90%'); // % non-convertible → raw sub
  });

  it('unitless operands adopt the other operand unit', () => {
    expect(bytesOf('/', dim(100, '%'), dim(4))).toBe('25%');
    expect(bytesOf('/', dim(5), dim(2, 'px'))).toBe('2.5px');
    expect(bytesOf('*', dim(42, 'octocats'), dim(10))).toBe('420octocats');
  });

  it('computes identically in loose and preserve (no calc() fallback)', () => {
    expect(bytesOf('/', dim(4, 'em'), dim(2, 'cm'), LOOSE)).toBe('2em');
    expect(bytesOf('/', dim(4, 'em'), dim(2, 'cm'), PRESERVE)).toBe('2em');
  });

  it('strict defers non-singular validation until final materialization', () => {
    const compound = operate('*', dim(2, 'px'), dim(3, 's'), STRICT);
    expect(compound.bytes).toBe('6px');
    expect(() => validateFinalUnits(compound, STRICT)).toThrow(/Multiple units/);
  });

  it('strict allows intermediate units to cancel before final validation', () => {
    const first = operate('/', dim(10, 'px'), dim(5, 'em'), STRICT);
    const second = operate('/', first, dim(1, 'px'), STRICT);
    const third = operate('*', second, dim(3, 'em'), STRICT);
    const final = operate('*', third, dim(1, 'px'), STRICT);
    expect(final.bytes).toBe('6px');
    expect(() => validateFinalUnits(final, STRICT)).not.toThrow();

    const unitless = operate('/', dim(1, 'px'), dim(1, 'px'), STRICT);
    expect(unitless.bytes).toBe('1');
    expect(() => validateFinalUnits(unitless, STRICT)).not.toThrow();
  });

  it('validates every nested structural value group at the final boundary', () => {
    const compound = operate('*', dim(2, 'px'), dim(3, 's'), STRICT);
    const nested = makeBlock([
      makeDimension(1, 'px'),
      makeList([makeDimension(2, 'px'), compound], ',')
    ], 'square');

    expect(() => validateFinalUnits(nested, STRICT)).toThrow(/Multiple units/);
  });

  it('strict still rejects incompatible additive units immediately', () => {
    expect(() => operate('+', dim(1, 'px'), dim(1, 'em'), STRICT)).toThrow(/Incompatible units/);
  });
});
