import {
  Color,
  ColorFormat,
  type Context,
  Dimension,
  defineFunction
} from '@jesscss/core';
import { percentOf, toNumber } from '@jesscss/core';
import { getLuma } from '../util/get-luma.js';

const contrast = defineFunction(
  'contrast',
  function(this: Context, color: Color, dark?: Color, light?: Color, threshold?: number) {
    if (!light) {
      light = new Color({
        rgb: [255, 255, 255],
        alpha: 1
      }, {
        format: ColorFormat.RGB
      });
    }
    if (!dark) {
      dark = new Color({
        rgb: [0, 0, 0],
        alpha: 1
      }, {
        format: ColorFormat.RGB
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
    const out = getLuma(color) < thresholdNum ? light : dark;
    out!.options.format = color.options.format;
    return out;
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
      convert: [percentOf(1), toNumber()],
      optional: true
    }]
  }
);

export default contrast;