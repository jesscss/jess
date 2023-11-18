
import { getNumber, type ColorValue } from './util/number'
import { type ExtendedFn } from './util'
import hsla from './hsla'

const hsl: ExtendedFn = function hsl(h: ColorValue, s: ColorValue, l: ColorValue) {
  h = getNumber(h)
  s = getNumber(s)
  l = getNumber(l)
  return hsla.call(this, h, s, l, 1)
}

hsl.allowOptional = true

export default hsl