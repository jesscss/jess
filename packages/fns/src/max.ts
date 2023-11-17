import { type ExtendedFn } from './util'
import { Node } from '@jesscss/core'
import { array, instance, assert } from 'superstruct'

const Struct = array(instance(Node))

/**
 * Return the maximum value
 */
const max: ExtendedFn = function max(...values: Node[]) {
  assert(values, Struct)
  values = values.sort((a, b) => {
    let compare = b.compare(a)
    if (compare === undefined) {
      throw new TypeError(`Cannot compare ${a.type} and ${b.type}`)
    }
    return compare
  })
  return values[0]
}

export default max