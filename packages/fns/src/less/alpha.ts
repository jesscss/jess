import { type Color, Num } from '@jesscss/core';

export default function alpha(color: Color) {
  return new Num(color.alpha);
}