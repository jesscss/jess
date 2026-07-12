import {
  Color
} from '@jesscss/core'
import { type ExtendedFn } from '../util'
import { type, assert, number } from 'superstruct'
import { getNumber, type ColorValue } from '../util/number'

const Struct = type({
  r: number(),
  g: number(),
  b: number(),
  a: number()
})

const rgba: ExtendedFn = function rgba(r: ColorValue, g: ColorValue, b: ColorValue, a: ColorValue) {
  const values = [r, g, b, a].map(v => getNumber(v))
  assert({ r, g, b, a }, Struct)
  return new Color(values)
}

rgba.allowOptional = true

export default rgba