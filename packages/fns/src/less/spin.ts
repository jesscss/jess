import {
  type Context,
  type Color,
  type Dimension
} from '@jesscss/core'
import { getHsla } from '../util/get-hsla'
import { toHSL } from '../util/to-hsl'

export default function spin(this: Context, color: Color, amount: Dimension) {
  const hsl = toHSL(color)
  const hue = (hsl.h + amount.number) % 360

  hsl.h = hue < 0 ? 360 + hue : hue

  return getHsla.call(this, color, hsl)
}