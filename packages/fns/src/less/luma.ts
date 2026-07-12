import { type Color, Dimension } from '@jesscss/core'
import { getLuma } from '../util/get-luma'

export default function luma(color: Color) {
  return new Dimension([
    getLuma(color) * color.alpha * 100,
    '%'
  ])
}