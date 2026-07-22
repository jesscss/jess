import { type ColorValue } from '../util/number.js';
import hsva from './hsva.js';
import { Color, ColorFormat, defineFunction, Dimension } from '@jesscss/core';

/**
 * Less `hsv()` — construct a `Color` from hue (degrees), saturation and value
 * (each `0–100%`), delegating to {@link hsva} with a fully-opaque alpha.
 * @param h hue in degrees
 * @param s saturation (`0–100%`)
 * @param v value/brightness (`0–100%`)
 * @returns the resulting `Color`
 */
const hsv = defineFunction(
  'hsv',
  function(this: any, h: ColorValue, s: ColorValue, v: ColorValue) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const out = Function.prototype.call.call(hsva, this, h, s, v, new Dimension({ number: 1 })) as Color;
    out.options.format = ColorFormat.HEX;
    return out;
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
    }]
  }
);

export default hsv;
