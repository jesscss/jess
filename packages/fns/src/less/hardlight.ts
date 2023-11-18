import { colorBlend } from './util/colorHelper'
import { overlayBase } from './overlay'

export function hardLightBase(cb: number, cs: number) {
  return overlayBase(cs, cb)
}

export default colorBlend.bind(null, hardLightBase)