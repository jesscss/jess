import { colorBlend } from '../util/colorHelper'

export function averageBase(cb: number, cs: number) {
  return (cb + cs) / 2
}

export default colorBlend.bind(null, averageBase)
