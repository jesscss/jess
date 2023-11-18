import { toHSV } from './util/to-hsv'
import { type Color, Dimension } from '@jesscss/core'

export default function hsvvalue(color: Color) {
  return new Dimension([
    toHSV(color).v * 100,
    '%'
  ])
}