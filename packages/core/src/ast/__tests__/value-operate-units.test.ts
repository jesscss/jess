/**
 * Cross-unit dimension arithmetic (E2) — a faithful port of less.js `Dimension.operate`.
 *
 * Ground truth is `less@4.6.7` run with `math: 'parens-division'` (the default paren
 * math the alpha corpus assumes). Cross-unit `*`/`/` and incompatible `+`/`-` COMPUTE
 * (they do NOT throw or fall back to `calc()`): they keep the LHS unit, converting a
 * compatible RHS first, and cancel the numerator/denominator multiset so a chained
 * op resolves the surviving unit (`8cats * 9dogs / 4cats` → `18dogs`).
 *
 * That port is now the `loose` rung. §4.7 puts an operation whose composed unit
 * CSS CANNOT EXPRESS on a three-rung ladder — `loose` folds, the default
 * `preserve` keeps the authored expression as `calc(…)`, `strict` rejects it —
 * so the rows below name the mode they assert rather than assuming one answer.
 */
import { describe, expect, it } from 'vitest';
import { operate, validateFinalUnits } from '../value-operate.js';
import { makeBlock, makeDimension, makeList } from '../value-factory.js';
import type { EvalModes, Value } from '../value-eval.js';

const PRESERVE: EvalModes = { unitMode: 'preserve' };
const LOOSE: EvalModes = { unitMode: 'loose' };
const STRICT: EvalModes = { unitMode: 'strict' };

const dim = (n: number, u = ''): Value => makeDimension(n, u);
const bytesOf = (op: string, a: Value, b: Value, m = PRESERVE) => operate(op, a, b, m).bytes;

describe('cross-unit arithmetic — parens-division (unit algebra vs less@4.6.7; digits per DD F6)', () => {
  it('division keeps the LHS unit for incompatible units', () => {
    expect(bytesOf('/', dim(4, 'em'), dim(2, 'cm'))).toBe('2em');
    expect(bytesOf('/', dim(14, 'px'), dim(1.4, 'em'))).toBe('10px');
    expect(bytesOf('/', dim(2, 'px'), dim(3, 's'))).toBe('0.6666666667px');
  });

  /*
   * §4.7 — a PRODUCT of two united operands is an area, and CSS has no area
   * unit, so `preserve` keeps the authored expression instead of fabricating one
   * out of `backupUnit`. `loose` still answers less.js's LHS-unit fold, which is
   * what these rows asserted before the ladder existed; the answer did not
   * change, the rung that produces it did.
   */
  it('a unit product preserves in preserve mode and folds to the LHS unit in loose', () => {
    expect(bytesOf('*', dim(4, 'em'), dim(2, 'cm'))).toBe('calc(4em * 2cm)');
    expect(bytesOf('*', dim(2, 'px'), dim(3, 'px'))).toBe('calc(2px * 3px)');
    expect(bytesOf('*', dim(4, 'em'), dim(2, 'cm'), LOOSE)).toBe('8em');
    expect(bytesOf('*', dim(2, 'px'), dim(3, 'px'), LOOSE)).toBe('6px');
  });

  it('preserves percentage products as a calc value in preserve mode', () => {
    expect(bytesOf('*', dim(100, '%'), dim(100, '%'))).toBe('calc(100% * 100%)');
    expect(bytesOf('*', dim(100, '%'), dim(100, '%'), LOOSE)).toBe('10000%');
  });

  /*
   * §4 row g2. Like units CANCEL, and the cancelled result is a genuine unitless
   * number in EVERY mode — reaching for `backupUnit` there would re-attach a unit
   * the value no longer carries. less.js answers `4px`; that is the one row of
   * this file where every mode diverges from it, because the divergence is the
   * ruling rather than a mode.
   */
  it('same-unit division cancels to a unitless number in every mode', () => {
    expect(bytesOf('/', dim(8, 'px'), dim(2, 'px'))).toBe('4');
    expect(bytesOf('/', dim(4, 'em'), dim(2, 'em'))).toBe('2');
    expect(bytesOf('/', dim(8, 'px'), dim(2, 'px'), LOOSE)).toBe('4');
    expect(bytesOf('/', dim(8, 'px'), dim(2, 'px'), STRICT)).toBe('4');
  });

  it('numerator/denominator cancel across a chain, in EVERY mode', () => {
    /*
     * (8cats * 9dogs) / 4cats → 18dogs, and `preserve` is not an exception.
     *
     * This is the row that says what §4.7's `preserve` actually governs. The
     * intermediate `8cats * 9dogs` has no CSS spelling, so it is SPELLED as the
     * authored expression — but it is still a computed dimension carrying 72 and
     * the multiset `cats·dogs`, so dividing by `4cats` cancels `cats` and lands
     * on a plain, expressible `18dogs`. The preserved spelling is then simply not
     * carried forward, because there is nothing left to preserve.
     *
     * An earlier revision made `preserve` DECLINE the intermediate, returning an
     * opaque `calc(8cats * 9dogs)` keyword. That answered `calc(8cats * 9dogs /
     * 4cats)` here — a chain that can never cancel, because the magnitude and the
     * multiset were thrown away at the first unexpressible step. `preserve`
     * governs the SPELLING of an unexpressible result; it never declines to
     * compute.
     */
    const prod = operate('*', dim(8, 'cats'), dim(9, 'dogs'), LOOSE);
    expect(bytesOf('/', prod, dim(4, 'cats'), LOOSE)).toBe('18dogs');
    expect(bytesOf('/', operate('*', dim(8, 'cats'), dim(9, 'dogs'), PRESERVE), dim(4, 'cats')))
      .toBe('18dogs');
  });

  it('an unexpressible intermediate still cancels back to an expressible unit', () => {
    // `1px * 1px` is an area with no CSS unit; `/ 1px` returns it to a length.
    const area = operate('*', dim(1, 'px'), dim(1, 'px'), PRESERVE);
    expect(area.bytes).toBe('calc(1px * 1px)');
    expect(bytesOf('/', area, dim(1, 'px'))).toBe('1px');
  });

  it('addition/subtraction convert a compatible RHS, else operate on raw magnitudes', () => {
    expect(bytesOf('+', dim(20, 'mm'), dim(1, 'cm'))).toBe('30mm');
    expect(bytesOf('+', dim(90, 'deg'), dim(0.25, 'turn'))).toBe('180deg');
    expect(bytesOf('+', dim(1, 'px'), dim(1, 'em'))).toBe('2px'); // em non-convertible → raw add
    expect(bytesOf('-', dim(100, '%'), dim(10, 'px'))).toBe('90%'); // % non-convertible → raw sub
  });

  it('unitless operands adopt the other operand unit', () => {
    expect(bytesOf('/', dim(100, '%'), dim(4))).toBe('25%');
    expect(bytesOf('*', dim(42, 'octocats'), dim(10))).toBe('420octocats');

    /*
     * §4 row h — EXCEPT a unitless NUMERATOR over a united denominator, whose
     * result is a reciprocal unit. There is no `px⁻¹` in CSS, so `preserve`
     * preserves and `loose` answers less.js's dimensionally false `2.5px`.
     */
    expect(bytesOf('/', dim(5), dim(2, 'px'))).toBe('calc(5 / 2px)');
    expect(bytesOf('/', dim(5), dim(2, 'px'), LOOSE)).toBe('2.5px');
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
