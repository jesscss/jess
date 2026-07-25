import { describe, it, expect } from 'vitest';
import { makeDimension, makeKeyword, makeList, type Dimension } from '@jesscss/core/value';
import { cssMinMax } from '../min-max.js';
import min from '../min.js';
import max from '../max.js';

/**
 * `min()`/`max()` are the CSS Values 4 § 10.2 math functions and behave
 * IDENTICALLY in css/less/scss/jess. There is one body; these are its tests.
 *
 * The reduction cases are verified against BOTH lessc 4.8.0 and dart-sass
 * 1.101.0, which agree on every one of them. They do NOT agree on every
 * UNREDUCIBLE shape — where they diverge, jess follows the coherent rule
 * (reduce, else fail) rather than either engine's argument-order quirk.
 *
 * The failure cases assert a THROW, never a verbatim call. Whether a failed
 * call is preserved or reported is the engine's decision (`functionMode`, via
 * `evaluator.ts` `recoverCallFailure`), not this body's — a function that
 * swallows its own failure makes that setting silently inert. End-to-end
 * preservation is covered in `packages/jess/test/css-min-max-dialect.test.ts`.
 */
describe('CSS min()/max() — shared by every dialect', () => {
  const reduce = (isMin: boolean, strict: boolean, ...args: Dimension[]) =>
    cssMinMax(isMin, makeList(args, ','), strict);

  it('reduces same-unit arguments (lessc 4.8.0 + dart-sass agree)', () => {
    const args: Dimension[] = [makeDimension(6, 'px'), makeDimension(2, 'px'), makeDimension(10, 'px')];
    expect(reduce(true, false, ...args)).toMatchObject({ number: 2, unit: 'px' });
    expect(reduce(false, false, ...args)).toMatchObject({ number: 10, unit: 'px' });
  });

  it('reduces convertible units and keeps the WINNING argument verbatim', () => {
    const args: Dimension[] = [makeDimension(1, 'px'), makeDimension(1, 'in'), makeDimension(1, 'cm')];
    expect(reduce(true, false, ...args)).toMatchObject({ number: 1, unit: 'px' });
    expect(reduce(false, false, ...args)).toMatchObject({ number: 1, unit: 'in' });
  });

  it('compares a unitless argument against the DISPLAY number, not a canonical one', () => {
    // min(2px, 1) → 1 / max(2px, 1) → 2px; min(3, 1cm) → 1cm / max(3, 1cm) → 3.
    expect(reduce(true, false, makeDimension(2, 'px'), makeDimension(1))).toMatchObject({ number: 1, unit: '' });
    expect(reduce(false, false, makeDimension(2, 'px'), makeDimension(1))).toMatchObject({ number: 2, unit: 'px' });
    expect(reduce(true, false, makeDimension(3), makeDimension(1, 'cm'))).toMatchObject({ number: 1, unit: 'cm' });
    expect(reduce(false, false, makeDimension(3), makeDimension(1, 'cm'))).toMatchObject({ number: 3, unit: '' });
  });

  it('THROWS on unreducible units rather than emitting a verbatim call itself', () => {
    // Every one of these renders verbatim end-to-end under the default
    // `functionMode: 'preserve'` — but that is the engine's doing, not ours.
    expect(() => reduce(false, false, makeDimension(1, 'px'), makeDimension(2, 'em')))
      .toThrow('max() arguments have incompatible units');
    expect(() => reduce(false, false, makeDimension(1, 'px'), makeDimension(1, '%')))
      .toThrow('max() arguments have incompatible units');
    // The multi-argument case that previously partially reduced to `max(3px, 2em)`.
    // lessc 4.8.0 and dart-sass both preserve THIS shape verbatim (a leading
    // unit'd argument makes less.js throw). They do NOT agree on the shape where
    // a unitless argument intervenes — see call-failure-boundary.test.ts.
    expect(() => reduce(false, false, makeDimension(1, 'px'), makeDimension(2, 'em'), makeDimension(3, 'px')))
      .toThrow('max() arguments have incompatible units');
  });

  it('THROWS on a non-numeric argument and on no arguments', () => {
    expect(() => cssMinMax(true, makeList([makeDimension(1, 'px'), makeKeyword('var(--x)')], ','), false))
      .toThrow('min() requires numeric arguments');
    expect(() => cssMinMax(true, [], false)).toThrow('min() requires at least one argument');
  });

  it('flattens list arguments', () => {
    const flattened = cssMinMax(true, makeList([[makeDimension(1, 'px'), makeDimension(5, 'px')]], ','), false);
    expect(flattened).toMatchObject({ number: 1, unit: 'px' });
  });

  it('registers one fn per name, reused by every dialect', () => {
    expect(min.name).toBe('min');
    expect(max.name).toBe('max');
  });

  describe('the strict MODULE form (math.min/math.max)', () => {
    it('carries Sass diagnostic wording — spec core_functions/math/{min,max}.hrx', () => {
      expect(() => reduce(true, true, makeDimension(1, 'px'), makeDimension(2, 's')))
        .toThrow('1px and 2s have incompatible units.');
      expect(() => cssMinMax(true, makeList([makeDimension(1), makeKeyword('c')], ','), true))
        .toThrow('c is not a number.');
      expect(() => cssMinMax(true, [], true)).toThrow('At least one argument must be passed.');
    });

    it('reduces exactly as the CSS form does — only failure REPORTING differs', () => {
      expect(reduce(true, true, makeDimension(3), makeDimension(1), makeDimension(2))).toMatchObject({ number: 1 });
      expect(reduce(false, true, makeDimension(3), makeDimension(1), makeDimension(2))).toMatchObject({ number: 3 });
    });
  });
});
