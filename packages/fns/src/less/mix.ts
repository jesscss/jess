import {
  Color,
  Dimension
} from '@jesscss/core'
import { toHSL } from './util/to-hsl'

//
// Copyright (c) 2006-2009 Hampton Catlin, Natalie Weizenbaum, and Chris Eppstein
// http://sass-lang.com
//
export default function mix(color1: Color, color2: Color, weight?: Dimension) {
  if (!weight) {
    weight = new Dimension([50])
  }
  const p = weight.number / 100.0
  const w = p * 2 - 1
  const a = toHSL(color1).a - toHSL(color2).a

  const w1 = (((w * a === -1) ? w : (w + a) / (1 + w * a)) + 1) / 2.0
  const w2 = 1 - w1

  const rgba = [
    color1.rgb[0] * w1 + color2.rgb[0] * w2,
    color1.rgb[1] * w1 + color2.rgb[1] * w2,
    color1.rgb[2] * w1 + color2.rgb[2] * w2,
    color1.alpha * p + color2.alpha * (1 - p)
  ]

  return new Color(rgba)
}