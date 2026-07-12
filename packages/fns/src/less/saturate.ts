import {
  type Context,
  type Color,
  type Dimension,
  type Node
} from '@jesscss/core'
import { adjustHSL } from '../util/get-hsla'

export default function saturate(this: Context, color: Color, amount: Dimension, method?: Node) {
  return adjustHSL.call(this, 's', '+', color, amount, method)
}