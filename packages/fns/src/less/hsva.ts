import { getNumber, type ColorValue } from '../util/number';
import rgba from './rgba';
import { defineFunction, Dimension } from '@jesscss/core';

const hsva = defineFunction(
  'hsva',
  function(this: any, h: ColorValue, s: ColorValue, v: ColorValue, a: ColorValue) {
    h = ((getNumber(h) % 360) / 360) * 360;
    s = getNumber(s);
    v = getNumber(v);
    a = getNumber(a);

    const i = Math.floor((h / 60) % 6);
    const f = (h / 60) - i;

    const vs = [
      v,
      v * (1 - s),
      v * (1 - f * s),
      v * (1 - (1 - f) * s)
    ];

    const perm = [
      [0, 3, 1],
      [2, 0, 1],
      [1, 0, 3],
      [1, 2, 0],
      [3, 1, 0],
      [0, 1, 2]
    ];

    return rgba.call(
      this,
      vs[perm[i]![0]!]! * 255,
      vs[perm[i]![1]!]! * 255,
      vs[perm[i]![2]!]! * 255,
      a
    );
  },
  {
    params: [{
      name: 'h',
      type: [Dimension, 'number']
    }, {
      name: 's',
      type: [Dimension, 'number']
    }, {
      name: 'v',
      type: [Dimension, 'number']
    }, {
      name: 'a',
      type: [Dimension, 'number']
    }]
  }
);

export default hsva;