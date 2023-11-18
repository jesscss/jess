import {
  type Context,
  type Color,
  type Dimension,
  type Node
} from '@jesscss/core'
import { adjustHSL } from '../util/get-hsla'

export default function lighten(this: Context, color: Color, amount: Dimension, method?: Node) {
  return adjustHSL.call(this, 'l', '+', color, amount, method)
}