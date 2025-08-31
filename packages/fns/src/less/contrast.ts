import {
  Color,
  ColorFormat,
  type Context,
  Dimension,
  defineFunction
} from '@jesscss/core';
import { toNumber } from '@jesscss/core';
import { getLuma } from '../util/get-luma';

const contrast = defineFunction(
  'contrast',
  function(this: Context, color: Color, dark?: Color, light?: Color, threshold?: number) {
    if (!light) {
      light = new Color({
        format: ColorFormat.RGB,
        rgb: [255, 255, 255],
        alpha: 1
      });
    }
    if (!dark) {
      dark = new Color({
        format: ColorFormat.RGB,
        rgb: [0, 0, 0],
        alpha: 1
      });
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
      thresholdNum = threshold;
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
      convert: [toNumber()],
      optional: true
    }]
  }
);

export default contrast;