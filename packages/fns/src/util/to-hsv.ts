import { type Color } from '@jesscss/core'

// Adapted from http://mjijackson.com/2008/02/rgb-to-hsl-and-rgb-to-hsv-color-model-conversion-algorithms-in-javascript
export function toHSV(color: Color) {
  const r = color.rgb[0] / 255
  const g = color.rgb[1] / 255
  const b = color.rgb[2] / 255
  const a = color.alpha

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h: number
  let s: number
  const v = max

  const d = max - min
  if (max === 0) {
    s = 0
  } else {
    s = d / max
  }

  if (max === min) {
    h = 0
  } else {
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break
      case g: h = (b - r) / d + 2; break
      case b: h = (r - g) / d + 4; break
    }
    h! /= 6
  }
  return { h: h! * 360, s, v, a }
}