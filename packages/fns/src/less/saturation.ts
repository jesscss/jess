import { toHSL } from '../util/to-hsl'
import { type Color, Dimension } from '@jesscss/core'

export default function saturation(color: Color) {
  return new Dimension([
    toHSL(color).s * 100,
    '%'
  ])
}