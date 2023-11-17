import { colorBlend } from './_colorHelper'

export function softlightBase(cb: number, cs: number) {
  let d = 1
  let e = cb
  if (cs > 0.5) {
    e = 1
    d = (cb > 0.25)
      ? Math.sqrt(cb)
      : ((16 * cb - 12) * cb + 4) * cb
  }
  return cb - (1 - 2 * cs) * e * (d - cb)
}

export default colorBlend.bind(null, softlightBase)
