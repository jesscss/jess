import { colorBlend } from '../util/colorHelper.js';
import { Color, defineFunction } from '@jesscss/core';

export function softlightBase(cb: number, cs: number) {
  let d = 1;
  let e = cb;
  if (cs > 0.5) {
    e = 1;
    d = (cb > 0.25)
      ? Math.sqrt(cb)
      : ((16 * cb - 12) * cb + 4) * cb;
  }
  return cb - (1 - 2 * cs) * e * (d - cb);
}

export default defineFunction(
  'softlight',
  function(color1: Color, color2: Color) {
    return colorBlend(softlightBase, color1, color2);
  },
  {
    params: [{
      name: 'color1',
      type: Color
    }, {
      name: 'color2',
      type: Color
    }]
  }
);
