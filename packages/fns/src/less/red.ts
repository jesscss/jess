import { type Color, Num } from '@jesscss/core';

export default function red(color: Color) {
  return new Num(color.rgb[0]);
}