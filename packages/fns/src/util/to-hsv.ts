import { type Color } from '@jesscss/core';

// Adapted from http://mjijackson.com/2008/02/rgb-to-hsl-and-rgb-to-hsv-color-model-conversion-algorithms-in-javascript
export function toHSV(color: Color) {
  const rgb = color.rgb;
  const rawRgb = color._rgb;
  const r = rgb[0] / 255;
  const g = rgb[1] / 255;
  const b = rgb[2] / 255;
  const a = color.alpha;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h: number;
  let s: number;
  const v = max;

  const d = max - min;
  if (max === 0) {
    s = 0;
  } else {
    s = d / max;
  }

  if (max === min) {
    h = 0;
  } else {
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g: h = (b - r) / d + 2;
        break;
      case b: h = (r - g) / d + 4;
        break;
    }
    h! /= 6;
  }
  const roundedResult = { h: h! * 360, s, v, a };

  const rr = rawRgb[0] / 255;
  const rg = rawRgb[1] / 255;
  const rb = rawRgb[2] / 255;
  const rawMax = Math.max(rr, rg, rb);
  const rawMin = Math.min(rr, rg, rb);
  const rawD = rawMax - rawMin;
  let rawH: number;
  let rawS: number;
  if (rawMax === 0) {
    rawS = 0;
  } else {
    rawS = rawD / rawMax;
  }
  if (rawMax === rawMin) {
    rawH = 0;
  } else {
    switch (rawMax) {
      case rr: rawH = (rg - rb) / rawD + (rg < rb ? 6 : 0);
        break;
      case rg: rawH = (rb - rr) / rawD + 2;
        break;
      case rb: rawH = (rr - rg) / rawD + 4;
        break;
    }
    rawH! /= 6;
  }
  const rawResult = { h: rawH! * 360, s: rawS, v: rawMax, a };

  return rawResult;
}