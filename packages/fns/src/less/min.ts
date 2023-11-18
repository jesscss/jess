import { type ExtendedFn } from '../util'
import { Node } from '@jesscss/core'
import { array, instance, assert } from 'superstruct'

const Struct = array(instance(Node))

/**
 * Return the minimum value
 */
const min: ExtendedFn = function min(...values: Node[]) {
  assert(values, Struct)
  values = values.sort((a, b) => {
    let compare = a.compare(b)
    if (compare === undefined) {
      throw new TypeError(`Cannot compare ${a.type} and ${b.type}`)
    }
    return compare
  })
  return values[0]
}

export default min