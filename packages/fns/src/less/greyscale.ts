import {
  type Color,
  type Context,
  Dimension
} from '@jesscss/core'
import desaturate from './desaturate'

export default function greyscale(this: Context, color: Color) {
  return desaturate.call(this, color, new Dimension([100]))
}