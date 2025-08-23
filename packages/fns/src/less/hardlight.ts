import { colorBlend } from '../util/colorHelper';
import { overlayBase } from './overlay';
import { Color, defineFunction } from '@jesscss/core';

export function hardLightBase(cb: number, cs: number) {
  return overlayBase(cs, cb);
}

const hardlight = defineFunction(
  'hardlight',
  function(color1: Color, color2: Color) {
    return colorBlend(hardLightBase, color1, color2);
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

export default hardlight;
