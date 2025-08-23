import {
  Color,
  type Context,
  Dimension,
  defineFunction
} from '@jesscss/core';
import { getNumber } from '../util/number';
import { getLuma } from '../util/get-luma';
import rgba from './rgba';

const contrast = defineFunction(
  'contrast',
  function(this: Context, color: Color, dark?: Color, light?: Color, threshold?: Dimension) {
    if (!light) {
      light = rgba.call(this, 255, 255, 255, 1.0);
    }
    if (!dark) {
      dark = rgba.call(this, 0, 0, 0, 1.0);
    }
    // Figure out which is actually light and dark:
    if (getLuma(dark!) > getLuma(light!)) {
      const t = light;
      light = dark;
      dark = t;
    }
    let thresholdNum: number;
    if (!threshold) {
      thresholdNum = 0.43;
    } else {
      thresholdNum = getNumber(threshold);
    }
    if (getLuma(color) < thresholdNum) {
      return light;
    } else {
      return dark;
    }
  },
  {
    params: [{
      name: 'color',
      type: Color
    }, {
      name: 'dark',
      type: Color,
      optional: true
    }, {
      name: 'light',
      type: Color,
      optional: true
    }, {
      name: 'threshold',
      type: Dimension,
      optional: true
    }]
  }
);

export default contrast;