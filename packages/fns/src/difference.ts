import { colorBlend } from './_colorHelper'

export function differenceBase(cb: number, cs: number) {
  return Math.abs(cb - cs)
}

export default colorBlend.bind(null, differenceBase)
