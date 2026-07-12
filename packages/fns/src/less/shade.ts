import {
  type Color,
  type Dimension,
  type Context
} from '@jesscss/core'
import mix from './mix'
import rgb from './rgb'

export default function shade(this: Context, color: Color, amount: Dimension) {
  return mix.call(this, rgb.call(this, 0, 0, 0), color, amount)
}