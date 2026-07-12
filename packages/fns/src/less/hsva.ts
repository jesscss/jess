import { getNumber, type ColorValue } from '../util/number'
import { type, assert, number } from 'superstruct'
import rgba from './rgba'
import { type ExtendedFn } from '../util'

const Struct = type({
  h: number(),
  s: number(),
  v: number(),
  a: number()
})

const hsva: ExtendedFn = function hsva(h: ColorValue, s: ColorValue, v: ColorValue, a: ColorValue) {
  h = ((getNumber(h) % 360) / 360) * 360
  s = getNumber(s)
  v = getNumber(v)
  a = getNumber(a)

  assert({ h, s, v, a }, Struct)

  const i = Math.floor((h / 60) % 6)
  const f = (h / 60) - i

  const vs = [
    v,
    v * (1 - s),
    v * (1 - f * s),
    v * (1 - (1 - f) * s)
  ]

  const perm = [
    [0, 3, 1],
    [2, 0, 1],
    [1, 0, 3],
    [1, 2, 0],
    [3, 1, 0],
    [0, 1, 2]
  ]

  return rgba.call(
    this,
    vs[perm[i]![0]!]! * 255,
    vs[perm[i]![1]!]! * 255,
    vs[perm[i]![2]!]! * 255,
    a
  )
}

export default hsva