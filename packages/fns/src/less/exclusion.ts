import { colorBlend } from '../util/colorHelper'

export function exclusionBase(cb: number, cs: number) {
  return cb + cs - 2 * cb * cs
}

export default colorBlend.bind(null, exclusionBase)
