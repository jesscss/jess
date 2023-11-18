import { toHSV } from './util/to-hsv'
import { type Color, Dimension } from '@jesscss/core'

export default function hsvsaturation(color: Color) {
  return new Dimension([
    toHSV(color).s * 100,
    '%'
  ])
}