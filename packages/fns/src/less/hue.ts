import { toHSL } from './util/to-hsl'
import { type Color, Dimension } from '@jesscss/core'

export default function hue(color: Color) {
  return new Dimension([toHSL(color).h])
}