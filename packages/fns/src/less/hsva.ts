import { defineFunction, Dimension, Color, ColorFormat } from '@jesscss/core';
import { normalizeHue, percentOf, alphaToNumber, toNumber } from '@jesscss/core';

const hsva = defineFunction(
  'hsva',
  function(this: any, h: number, s: number, v: number, a: number) {
    // Values are already converted to numbers by the conversion plugins
    h = ((h % 360) / 360) * 360;

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

    return new Color({
      format: ColorFormat.RGB,
      rgb: [
        vs[perm[i]![0]!]! * 255,
        vs[perm[i]![1]!]! * 255,
        vs[perm[i]![2]!]! * 255
      ],
      alpha: a
    });
  },
  {
    params: [{
      name: 'h',
      type: Dimension,
      convert: [normalizeHue(), toNumber()]
    }, {
      name: 's',
      type: Dimension,
      convert: [percentOf(1), toNumber()]
    }, {
      name: 'v',
      type: Dimension,
      convert: [percentOf(1), toNumber()]
    }, {
      name: 'a',
      type: Dimension,
      convert: [alphaToNumber(), toNumber()]
    }],
    splitSequence: true
  }
);

export default hsva;