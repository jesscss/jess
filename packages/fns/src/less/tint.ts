import {
  type Color,
  type Dimension,
  type Context
} from '@jesscss/core'
import mix from './mix'
import rgb from './rgb'

export default function tint(this: Context, color: Color, amount: Dimension) {
  return mix.call(this, rgb.call(this, 255, 255, 255), color, amount)
}