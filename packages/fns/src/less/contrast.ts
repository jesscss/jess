import {
  type Color,
  type Context,
  type Dimension
} from '@jesscss/core';
import { getNumber } from '../util/number';
import { getLuma } from '../util/get-luma';
import rgba from './rgba';

export default function contrast(
  this: Context,
  color: Color,
  dark?: Color,
  light?: Color,
  threshold?: Dimension
) {
  if (!light) {
    light = rgba.call(this, { r: 255, g: 255, b: 255, a: 1.0 });
  }
  if (!dark) {
    dark = rgba.call(this, { r: 0, g: 0, b: 0, a: 1.0 });
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
}