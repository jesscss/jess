import { colorBlend } from '../util/colorHelper'
import { multiplyBase } from './multiply'
import { screenBase } from './screen'

export function overlayBase(cb: number, cs: number) {
  cb *= 2
  return (cb <= 1)
    ? multiplyBase(cb, cs)
    : screenBase(cb - 1, cs)
}

export default colorBlend.bind(null, overlayBase)
