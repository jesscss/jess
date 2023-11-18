import { Color, ColorFormat } from '@jesscss/core'
import { type ColorValue, clamp, getNumber } from '../util/number'
import { type, assert, number } from 'superstruct'
import { type ExtendedFn } from '../util'

const Struct = type({
  h: number(),
  s: number(),
  l: number(),
  a: number()
})

const hsla: ExtendedFn = function hsla(h: ColorValue, s: ColorValue, l: ColorValue, a: ColorValue) {
  h = (getNumber(h) % 360) / 360
  s = clamp(getNumber(s))
  l = clamp(getNumber(l))
  a = clamp(getNumber(a))

  assert({ h, s, l, a }, Struct)

  const color = new Color(ColorFormat.HSL)
  color.hsla = [h, s, l, a]
  return color
}

hsla.allowOptional = true

export default hsla