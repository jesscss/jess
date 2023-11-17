import { colorBlend } from './_colorHelper'

export function negationBase(cb: number, cs: number) {
  return 1 - Math.abs(cb + cs - 1)
}

export default colorBlend.bind(null, negationBase)
