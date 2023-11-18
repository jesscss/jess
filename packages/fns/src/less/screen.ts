import { colorBlend } from '../util/colorHelper'

export function screenBase(cb: number, cs: number) {
  return cb + cs - cb * cs
}

export default colorBlend.bind(null, screenBase)
