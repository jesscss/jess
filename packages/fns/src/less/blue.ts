import { type Color, Num } from '@jesscss/core';

export default function blue(color: Color) {
  return new Num(color.rgb[2]);
}