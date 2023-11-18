import {
  type Context,
  type Color,
  type Dimension
} from '@jesscss/core'
import { getHsla } from './util/get-hsla'
import { toHSL } from './util/to-hsl'
import { clamp } from './util/number'

export default function fade(this: Context, color: Color, amount: Dimension) {
  const hsl = toHSL(color)

  hsl.a = amount.number / 100
  hsl.a = clamp(hsl.a)
  return getHsla.call(this, color, hsl)
}