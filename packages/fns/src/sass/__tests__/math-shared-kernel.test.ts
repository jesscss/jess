/**
 * `sass:math`'s `pow`, `sqrt` and trig members compute through the kernel Less's
 * functions of the same names use (`shared/math/math-helper.ts`). On the
 * arguments both dialects accept, the two give the same number; they differ only
 * in the unit rules each wrapper states. Inputs are sass-spec
 * `core_functions/math/**` arguments.
 */
import { makeDimension } from '@jesscss/core';
import { describe, expect, it } from 'vitest';
import { call } from '../../__tests__/harness.js';
import { pow as lessPow } from '../../less/pow.js';
import { sqrt as lessSqrt } from '../../less/sqrt.js';
import { sin as lessSin } from '../../less/sin.js';
import { cos as lessCos } from '../../less/cos.js';
import { tan as lessTan } from '../../less/tan.js';
import { pow } from '../math/pow.js';
import { sqrt } from '../math/sqrt.js';
import { sin, cos, tan } from '../math/trig.js';

const px = makeDimension(1, 'px');

describe('sass:math and Less share the math kernel', () => {
  it('pow and sqrt agree on unitless numbers', () => {
    expect(call(pow, makeDimension(2), makeDimension(0.5))).toEqual(call(lessPow, makeDimension(2), makeDimension(0.5)));
    expect(call(sqrt, makeDimension(2))).toEqual(call(lessSqrt, makeDimension(2)));
  });

  it.each(['', 'deg', 'grad', 'rad', 'turn'])('sin, cos and tan agree on 1%s', (unit) => {
    const angle = makeDimension(1, unit);
    expect(call(sin, angle)).toEqual(call(lessSin, angle));
    expect(call(cos, angle)).toEqual(call(lessCos, angle));
    expect(call(tan, angle)).toEqual(call(lessTan, angle));
  });

  it('only Less accepts a unit on pow, sqrt and sin', () => {
    expect(call(lessPow, px, makeDimension(0))).toMatchObject({ number: 1, unit: 'px' });
    expect(() => call(pow, px, makeDimension(0))).toThrow('$base: Expected 1px to have no units.');
    expect(() => call(sqrt, px)).toThrow('$number: Expected 1px to have no units.');
    expect(() => call(sin, px)).toThrow('$number: Expected 1px to have an angle unit (deg, grad, rad, turn).');
  });
});
