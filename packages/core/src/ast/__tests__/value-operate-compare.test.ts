/**
 * Regression coverage for `compare` dimension/unit reconciliation (A2.2).
 *
 * Ground truth is `npx less@4.6.3` (guard `when (...)` evaluation), NOT the repo's
 * legacy `Dimension.compare` (which diverges: it normalizes `%`→/100 and throws on
 * incompatible units — real Less 4.6.3 does neither in a guard). Verified cases:
 *   1cm = 10mm  → true      1s > 500ms → true      100ms = 0.1s → true
 *   50% = 0.5   → false     50% = 50   → true       50% = 50%    → true
 *   2px < 1em   → false (incomparable, no throw)
 *
 * `foo < bar` is the one row where less@4.6.3 is NOT ground truth: it answers
 * false to that AND to `bar < foo`, which §4.2 rules out — see the row below.
 */
import { describe, expect, it } from 'vitest';
import { compare, compareMatch } from '../value-guards.js';
import { makeAny, makeColorRgb, makeDimension, makeKeyword, makeQuoted } from '../value-factory.js';
import { IncomparableOperandsError, UnitArithmeticError, type Value } from '../value-eval.js';

const dim = (n: number, u = ''): Value => makeDimension(n, u);

describe('compare — dimension unit reconciliation (vs less@4.6.3)', () => {
  it('converts compatible length units', () => {
    expect(compare('=', dim(1, 'cm'), dim(10, 'mm'))).toBe(true);
    expect(compare('=', dim(1, 'in'), dim(96, 'px'))).toBe(true);
    expect(compare('=', dim(1, 'pc'), dim(12, 'pt'))).toBe(true);
    expect(compare('<', dim(1, 'cm'), dim(2, 'cm'))).toBe(true);
  });

  it('converts compatible duration + angle units', () => {
    expect(compare('>', dim(1, 's'), dim(500, 'ms'))).toBe(true);
    expect(compare('=', dim(100, 'ms'), dim(0.1, 's'))).toBe(true);
    expect(compare('=', dim(360, 'deg'), dim(1, 'turn'))).toBe(true);
  });

  it('treats % as a REGULAR unit (no /100 normalization)', () => {
    expect(compare('=', dim(50, '%'), dim(0.5))).toBe(false);
    expect(compare('=', dim(50, '%'), dim(50))).toBe(true);
    expect(compare('=', dim(50, '%'), dim(50, '%'))).toBe(true);
    expect(compare('=', dim(0, '%'), dim(0))).toBe(true);
  });

  it('incompatible / non-convertible units are INCOMPARABLE (never throw)', () => {
    expect(compare('<', dim(2, 'px'), dim(1, 'em'))).toBe(false);
    expect(compare('>', dim(2, 'px'), dim(1, 'em'))).toBe(false);
    expect(compare('=', dim(2, 'px'), dim(1, 'em'))).toBe(false);
  });

  it('same-unit + unitless comparisons unchanged', () => {
    expect(compare('=', dim(5, 'px'), dim(5, 'px'))).toBe(true);
    expect(compare('>', dim(3, 'px'), dim(2, 'px'))).toBe(true);
    expect(compare('>', dim(2), dim(1))).toBe(true);
    expect(compare('>=', dim(5, 'px'), dim(5, 'px'))).toBe(true);

    /*
     * Less accepts the historical `=<` spelling as the same inclusive
     * less-than comparison; the AST intentionally retains that authored token.
     */
    expect(compare('=<', dim(5, 'px'), dim(5, 'px'))).toBe(true);
    expect(compare('=<', dim(4, 'px'), dim(5, 'px'))).toBe(true);
    expect(compare('=<', dim(6, 'px'), dim(5, 'px'))).toBe(false);
    expect(compare('<', dim(2, 'px'), dim(0))).toBe(false);
  });

  /*
   * RESOLVED-SEMANTICS-AND-NAMING.md §4.2 AMENDS this row. Less 4.6.3 answers
   * `false` to BOTH `foo > bar` and `bar > foo`, which leaves the author unable
   * to tell "genuinely not greater" from "never comparable"; relational is
   * trichotomous over every pair that has a ground, and two same-kind operands
   * ground on their own spelling.
   */
  it('same-kind ordered comparison IS lexicographic on the operands own spelling', () => {
    expect(compare('>', makeKeyword('foo'), makeKeyword('bar'))).toBe(true);
    expect(compare('<', makeKeyword('foo'), makeKeyword('bar'))).toBe(false);
    expect(compare('<', makeKeyword('bar'), makeKeyword('foo'))).toBe(true);
    expect(compare('>', makeQuoted('abc', '"', false), makeQuoted('abd', '"', false))).toBe(false);
    expect(compare('<', makeQuoted('abc', '"', false), makeQuoted('abd', '"', false))).toBe(true);

    // equality on non-dimensions still holds (byte match), and self-order is reflexive.
    expect(compare('=', makeKeyword('foo'), makeKeyword('foo'))).toBe(true);
    expect(compare('=', makeKeyword('foo'), makeKeyword('bar'))).toBe(false);
    expect(compare('>=', makeKeyword('foo'), makeKeyword('foo'))).toBe(true);
    expect(compare('>', makeKeyword('foo'), makeKeyword('foo'))).toBe(false);
  });

  /*
   * §4.1's last row: no common ground. Equality is `false` and never raises;
   * relational REFUSES, because inventing an order is the only alternative.
   */
  it('a pair with NO common ground is false for equality and an ERROR for relational', () => {
    const red = makeColorRgb([255, 0, 0], 1, 1);
    expect(compare('=', dim(1, 'px'), red)).toBe(false);
    expect(compare('==', dim(1, 'px'), red)).toBe(false);
    expect(() => compare('>', dim(1, 'px'), red)).toThrow(IncomparableOperandsError);
    expect(() => compare('<', red, dim(1, 'px'))).toThrow(IncomparableOperandsError);
    expect(() => compare('>=', dim(1, 'px'), red)).toThrow(/share no common ground/);
  });

  /*
   * `e("3")` and `~"3"` both land as opaque unquoted bytes (`Any`), which take
   * §4.1's STRING ground against any operand. The ground belongs to the PAIR, so
   * the SAME ground answers equality and ordering — `3 = e("3")` is true and
   * `5 > e("4")` is true, and neither is a special case of the other.
   */
  it('takes a string ground against an escaped/e() CSS-word result, for BOTH operators', () => {
    expect(compare('=', dim(3), makeAny('3'))).toBe(true);
    expect(compare('=', makeAny('3'), dim(3))).toBe(true);
    expect(compare('=', dim(3), makeAny('4'))).toBe(false);
    expect(compare('>', dim(5), makeAny('4'))).toBe(true);
    expect(compare('<', dim(5), makeAny('4'))).toBe(false);
    expect(compare('<', makeAny('4'), dim(5))).toBe(true);
  });

  /*
   * A bare identifier is NOT a string. §4.1's last row gives it no ground with a
   * number, which is the distinction that makes `1px > red` an error while
   * `5 > ~"4"` is an answer.
   */
  it('shares no ground between a bare keyword and a number', () => {
    expect(compare('=', dim(1), makeKeyword('true'))).toBe(false);
    expect(() => compare('<', dim(1), makeKeyword('true'))).toThrow(IncomparableOperandsError);
  });
});

/*
 * §4.2a. The guard-position primitive. Ground truth here IS less@4.6.3, which
 * emits the non-match for `.generic(1, true) when (@a < @b)` rather than
 * failing — as does the owner-maintained expected CSS for
 * `tests-unit/mixins-guards/mixins-guards.less`.
 */
describe('compareMatch — guard position answers, never raises on a groundless pair', () => {
  it('is false rather than an error for every relational operator', () => {
    const red = makeColorRgb([255, 0, 0], 1, 1);
    for (const op of ['<', '>', '<=', '>=', '=<']) {
      expect(compareMatch(op, dim(1), makeKeyword('true'))).toBe(false);
      expect(compareMatch(op, dim(1, 'px'), red)).toBe(false);
    }
    expect(compareMatch('=', dim(1), makeKeyword('true'))).toBe(false);
  });

  /*
   * The two positions must differ ONLY on the groundless pair. Every row that
   * has a ground is the same answer from both, which is what makes them two
   * readers of one table rather than two comparison semantics.
   */
  it('agrees with compare on every pair that HAS a ground', () => {
    const rows: Array<[string, Value, Value]> = [
      ['<', dim(1, 'cm'), dim(2, 'cm')],
      ['>', dim(1, 's'), dim(500, 'ms')],
      ['=', dim(1), dim(1, 'px')],
      ['==', dim(1), dim(1, 'px')],
      ['>', makeQuoted('b'), makeQuoted('a')],
      ['<', makeKeyword('a'), makeKeyword('b')],
      ['>', dim(5), makeAny('4')],
      ['<=', dim(2, 'px'), dim(1, 'em')]
    ];
    for (const [op, left, right] of rows) {
      expect(compareMatch(op, left, right)).toBe(compare(op, left, right));
    }
  });

  /*
   * `unitMode: 'strict'` still RAISES through a guard. An incompatible unit pair
   * is a different defect from a groundless one — the operands do share numeric
   * ground and the author asked for a conversion that does not exist — so §4.2a
   * does not swallow it, and a guard is not a place errors go to die.
   */
  it('still raises for strict-mode incompatible units', () => {
    expect(() => compareMatch('>', dim(2, 'px'), dim(1, 'em'), 'strict')).toThrow(UnitArithmeticError);
  });
});

describe('compare — unitMode reaches comparison, not just arithmetic', () => {
  /*
   * Less 4.6.3 (and jess before this) made `strictUnits` govern ARITHMETIC only:
   * `1px + 3em` was a hard error while `2px > 1em` stayed a silent `false`, in the
   * SAME mode, on the SAME operand pair. The author could not tell "not greater"
   * from "never comparable". Measured against less@4.6.3, whose comparison is
   * `false` in every mode including `strictUnits: true`.
   */
  it('keeps Less 4.x incomparable-is-false when unitMode is not strict', () => {
    expect(compare('>', dim(2, 'px'), dim(1, 'em'))).toBe(false);
    expect(compare('=', dim(2, 'px'), dim(1, 'em'), 'preserve')).toBe(false);
    expect(compare('<', dim(2, 'px'), dim(1, 'em'), 'loose')).toBe(false);
  });

  it('throws on an unreconcilable pair under strict, as arithmetic already does', () => {
    expect(() => compare('>', dim(2, 'px'), dim(1, 'em'), 'strict')).toThrow(UnitArithmeticError);
    expect(() => compare('=', dim(2, 'px'), dim(1, 'em'), 'strict')).toThrow(UnitArithmeticError);
    expect(() => compare('<=', dim(1, 'em'), dim(2, 'px'), 'strict')).toThrow(UnitArithmeticError);
  });

  it('names both offending units, matching the arithmetic message', () => {
    expect(() => compare('>', dim(2, 'px'), dim(1, 'em'), 'strict'))
      .toThrow(/Bad units: 'px' and 'em'/);
  });

  it('does NOT throw for units that reconcile, whatever the mode', () => {
    expect(compare('=', dim(1, 'in'), dim(96, 'px'), 'strict')).toBe(true);
    expect(compare('>', dim(1, 's'), dim(500, 'ms'), 'strict')).toBe(true);
  });

  /*
   * A unitless operand is not a unit CLASH — Less reconciles it by magnitude, and
   * strict mode must not turn that into an error or the common `@n > 0` guard
   * breaks.
   */
  it('does NOT throw when one side is unitless', () => {
    expect(compare('>', dim(2, 'px'), dim(1), 'strict')).toBe(true);
    expect(compare('>', dim(1), dim(0), 'strict')).toBe(true);
  });

  it('does not reach non-dimension operands', () => {
    expect(compare('=', makeKeyword('foo'), makeKeyword('bar'), 'strict')).toBe(false);
    expect(compare('>', makeQuoted('b'), makeQuoted('a'), 'strict')).toBe(true);
  });
});
