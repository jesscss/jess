import { colorBlend } from './util/colorHelper'

export function multiplyBase(cb: number, cs: number) {
  return cb * cs
}

export default colorBlend.bind(null, multiplyBase)
