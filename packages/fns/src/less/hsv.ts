import { type ColorValue } from './util/number'
import hsva from './hsva'
import { type ExtendedFn } from './util'

const hsv: ExtendedFn = function hsv(h: ColorValue, s: ColorValue, v: ColorValue) {
  return hsva.call(this, h, s, v, 1.0)
}

export default hsv