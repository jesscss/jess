import { describe, it, expect } from 'vitest';
import { makeDimension, makeKeyword, makeList, type Dimension } from '@jesscss/core/value';
import { sassMinMax } from '../math/min-max.js';

/**
 * Sass `min()`/`max()` — faithful to dart-sass, fold artifacts included.
 *
 * Oracles: sass-spec `core_functions/math/{min,max}.hrx` (installed under
 * `packages/scss-parser/node_modules/sass-spec`) where it covers the case,
 * dart-sass 1.101.0 directly where it does not — marked `[binary]`.
 *
 * `ce4e942c1` claimed spec verification for a body with no unitless rule at
 * all, which § `units/and_unitless` would have caught. Its citations are not
 * trustworthy; these were re-checked.
 */
const run = (isMin: boolean, strict: boolean, ...args: Dimension[]) =>
  sassMinMax(isMin, makeList(args, ','), strict);

describe('Sass min()/max()', () => {
  it('spec § three_args / units/same / units/compatible', () => {
    expect(run(true, true, makeDimension(3), makeDimension(1), makeDimension(2))).toMatchObject({ number: 1 });
    expect(run(false, true, makeDimension(3), makeDimension(1), makeDimension(2))).toMatchObject({ number: 3 });
    expect(run(true, true, makeDimension(6, 'px'), makeDimension(2, 'px'), makeDimension(10, 'px')))
      .toMatchObject({ number: 2, unit: 'px' });
    expect(run(true, true, makeDimension(1, 'px'), makeDimension(1, 'in'), makeDimension(1, 'cm')))
      .toMatchObject({ number: 1, unit: 'px' });
  });

  it('spec § units/and_unitless — a unitless operand compares on DISPLAY numbers', () => {
    expect(run(true, true, makeDimension(2, 'px'), makeDimension(1))).toMatchObject({ number: 1, unit: '' });
    // [binary] No conversion once a unitless operand appears: 1in does NOT
    // become 96. This is the divergence from Less, which answers 1in.
    expect(run(false, false, makeDimension(1, 'px'), makeDimension(1, 'in'), makeDimension(2)))
      .toMatchObject({ number: 2, unit: '' });
    expect(run(true, false, makeDimension(1, 'px'), makeDimension(1, 'in'), makeDimension(2)))
      .toMatchObject({ number: 1, unit: 'px' });
    // [binary]
    expect(run(false, false, makeDimension(1, 'px'), makeDimension(2, 'px'), makeDimension(3)))
      .toMatchObject({ number: 3, unit: '' });
    expect(run(true, false, makeDimension(1, '%'), makeDimension(2), makeDimension(3, '%')))
      .toMatchObject({ number: 1, unit: '%' });
    expect(run(false, false, makeDimension(1, '%'), makeDimension(2), makeDimension(3, '%')))
      .toMatchObject({ number: 3, unit: '%' });
  });

  it('[binary] reproduces the FOLD-ORDER artifact: min succeeds where max fails', () => {
    // Identical arguments, opposite outcomes, because the running winner goes
    // unitless immediately for min and stays 6em for max. dart-sass does this;
    // a set-wide compatibility check would fail both, which is tidier and wrong.
    const list: Dimension[] = [
      makeDimension(6, 'em'), makeDimension(5), makeDimension(4, 'ex'),
      makeDimension(3), makeDimension(2, 'pt'), makeDimension(1)
    ];
    expect(run(true, false, ...list)).toMatchObject({ number: 1, unit: '' });
    expect(() => run(false, false, ...list)).toThrow('have incompatible units');

    expect(run(true, false, makeDimension(6, 'em'), makeDimension(5), makeDimension(4, 'ex')))
      .toMatchObject({ number: 4, unit: 'ex' });
  });

  it('[binary] fails when two unit-bearing operands actually meet', () => {
    expect(() => run(false, false, makeDimension(1, 'px'), makeDimension(2, 'em')))
      .toThrow('1px and 2em have incompatible units.');
    expect(() => run(true, false, makeDimension(6, 'em'), makeDimension(4, 'ex'), makeDimension(2, 'pt')))
      .toThrow('have incompatible units');
    expect(() => run(true, false, makeDimension(1, 'px'), makeDimension(1, '%')))
      .toThrow('have incompatible units');
  });

  it('spec § error/too_few_args and § error/type — module wording vs global', () => {
    expect(() => sassMinMax(true, [], true)).toThrow('At least one argument must be passed.');
    expect(() => sassMinMax(true, [], false)).toThrow('min() requires at least one argument');
    expect(() => sassMinMax(true, makeList([makeDimension(1), makeKeyword('c')], ','), true))
      .toThrow('c is not a number.');
    expect(() => sassMinMax(true, makeList([makeDimension(1), makeKeyword('c')], ','), false))
      .toThrow('min() requires numeric arguments');
  });

  it('spec § global/trailing_comma — list flattening', () => {
    expect(sassMinMax(true, makeList([[makeDimension(1, 'px'), makeDimension(2, 'px')]], ','), false))
      .toMatchObject({ number: 1, unit: 'px' });
  });
});
