import { toHSV } from './util/to-hsv'
import { type Color, Dimension } from '@jesscss/core'

export default function hsvhue(color: Color) {
  return new Dimension([toHSV(color).h])
}